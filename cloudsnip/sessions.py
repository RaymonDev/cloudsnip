"""Playlist sessions: their state on disk, the download queue and the export job."""

from __future__ import annotations

import copy
import hashlib
import json
import os
import queue
import re
import shutil
import threading
import time
import traceback
from pathlib import Path
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from . import downloader
from .audio import FORMATS, FFmpeg
from .config import default_export_dir
from .util import cut_total, keeps_from_cuts, normalize_cuts, safe_filename

ACTIVE = ("queued", "fetching", "downloading", "analyzing")
NAMING = {
    "num_artist_title": ("01 - Artist - Title", "{n} - {artist} - {title}"),
    "artist_title": ("Artist - Title", "{artist} - {title}"),
    "num_title": ("01 - Title", "{n} - {title}"),
    "title": ("Title", "{title}"),
}
DEFAULT_SETTINGS = {
    "oauth_token": "",
    "parallel_downloads": 3,
    "export_dir": "",
    "format": "wav",
    "naming": "num_artist_title",
    "embed_cover": True,
}
_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
_TRACKING_PARAMS = {"si", "ref", "p", "c", "in", "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"}


class NotFound(LookupError):
    pass


def normalize_url(raw: str) -> str:
    url = (raw or "").strip()
    if not url:
        raise ValueError("Paste a SoundCloud link first.")
    if not re.match(r"^https?://", url, re.I):
        url = "https://" + url
    parts = urlsplit(url)
    host = parts.netloc.lower()
    if not host or "." not in host:
        raise ValueError("That doesn't look like a link.")
    if host in ("m.soundcloud.com", "www.soundcloud.com"):
        host = "soundcloud.com"
    query = urlencode([(k, v) for k, v in parse_qsl(parts.query) if k.lower() not in _TRACKING_PARAMS])
    return urlunsplit(("https", host, parts.path.rstrip("/") or "/", query, ""))


def _write_json(path: Path, data) -> None:
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1), "utf-8")
    for attempt in range(10):
        try:
            os.replace(tmp, path)
            return
        except PermissionError:  # Windows: a virus scanner or indexer briefly holds the file
            if attempt == 9:
                raise
            time.sleep(0.1)


class Workers:
    """A resizable pool of daemon threads running queued jobs in order."""

    def __init__(self, size: int):
        self._jobs: queue.Queue = queue.Queue()
        self._lock = threading.Lock()
        self._alive = 0
        self._target = 0
        self.resize(size)

    def resize(self, size: int) -> None:
        with self._lock:
            self._target = size
            while self._alive < self._target:
                self._alive += 1
                threading.Thread(target=self._run, daemon=True, name="cloudsnip-download").start()

    def submit(self, fn, *args) -> None:
        self._jobs.put((fn, args))

    def _run(self) -> None:
        while True:
            with self._lock:
                if self._alive > self._target:
                    self._alive -= 1
                    return
            try:
                fn, args = self._jobs.get(timeout=1)
            except queue.Empty:
                continue
            try:
                fn(*args)
            except Exception:  # noqa: BLE001 - a crashing job must never kill the worker
                traceback.print_exc()


class Manager:
    def __init__(self, workspace: Path, ff: FFmpeg):
        self.ws = workspace
        self.sessions_dir = workspace / "sessions"
        self.sessions_dir.mkdir(parents=True, exist_ok=True)
        self.ff = ff
        self.lock = threading.RLock()
        self.sessions: dict[str, dict] = {}
        self.cancelled: set[str] = set()
        self.stopping = False
        self._derived_lock = threading.Lock()  # guards on-demand waveform / preview generation
        self.settings = self._load_settings()
        self.workers = Workers(self.settings["parallel_downloads"])

    # ------------------------------------------------------------------ settings

    def _settings_path(self) -> Path:
        return self.ws / "settings.json"

    def _load_settings(self) -> dict:
        settings = dict(DEFAULT_SETTINGS)
        try:
            stored = json.loads(self._settings_path().read_text("utf-8"))
            settings.update({k: v for k, v in stored.items() if k in DEFAULT_SETTINGS})
        except (OSError, ValueError):
            pass
        settings["parallel_downloads"] = max(1, min(8, int(settings["parallel_downloads"] or 3)))
        if settings["format"] not in FORMATS:
            settings["format"] = "wav"
        if settings["naming"] not in NAMING:
            settings["naming"] = "num_artist_title"
        return settings

    def _save_settings(self) -> None:
        _write_json(self._settings_path(), self.settings)

    def export_root(self) -> Path:
        return Path(self.settings["export_dir"]).expanduser() if self.settings["export_dir"] else default_export_dir()

    def public_settings(self) -> dict:
        with self.lock:
            out = {k: v for k, v in self.settings.items() if k != "oauth_token"}
            out["has_token"] = bool(self.settings["oauth_token"])
            out["export_dir"] = str(self.export_root())
            return out

    def update_settings(self, data: dict) -> dict:
        with self.lock:
            if "oauth_token" in data:
                self.settings["oauth_token"] = str(data["oauth_token"] or "").strip()
            if "parallel_downloads" in data:
                try:
                    n = int(data["parallel_downloads"])
                except (TypeError, ValueError):
                    raise ValueError("Parallel downloads must be a number") from None
                self.settings["parallel_downloads"] = max(1, min(8, n))
                self.workers.resize(self.settings["parallel_downloads"])
            if "export_dir" in data:
                folder = str(data["export_dir"] or "").strip()
                if folder and not Path(os.path.expanduser(folder)).is_absolute():
                    raise ValueError("The default folder must be a full path")
                self.settings["export_dir"] = folder
            self._save_settings()
        return self.public_settings()

    # ------------------------------------------------------------------ persistence

    def _dir(self, pid: str) -> Path:
        if not _ID.match(pid):
            raise NotFound("Unknown playlist")
        return self.sessions_dir / pid

    def tracks_dir(self, pid: str) -> Path:
        return self._dir(pid) / "tracks"

    def _save(self, pid: str) -> None:
        with self.lock:
            s = self.sessions.get(pid)
            if s is None or pid in self.cancelled:
                return
            s["updated"] = time.time()
            _write_json(self._dir(pid) / "session.json", s)

    def _get(self, pid: str) -> dict:
        """Return the live session dict (loading it from disk if needed). Caller holds the lock."""
        s = self.sessions.get(pid)
        if s is not None:
            return s
        path = self._dir(pid) / "session.json"
        try:
            s = json.loads(path.read_text("utf-8"))
        except (OSError, ValueError):
            raise NotFound("Unknown playlist") from None
        self.sessions[pid] = s
        self._resume(pid)
        return s

    def _track(self, pid: str, tid: str) -> dict:
        for t in self._get(pid)["tracks"]:
            if t["id"] == tid:
                return t
        raise NotFound("Unknown track")

    def _resume(self, pid: str) -> None:
        """Restart whatever was in progress when the app last stopped."""
        s = self.sessions[pid]
        tdir = self.tracks_dir(pid)
        for t in s["tracks"]:
            missing = t["status"] == "ready" and not (t.get("file") and (tdir / t["file"]).is_file())
            if t["status"] in ACTIVE or missing:
                t["status"] = "queued"
                t["progress"] = 0.0
                self.workers.submit(self._download_job, pid, t["id"])
        if s.get("export") and s["export"].get("status") == "running":
            s["export"]["status"] = "interrupted"
        if s["status"] in ("resolving", "error") or not s["tracks"]:
            s["status"] = "resolving"
            threading.Thread(target=self._resolve, args=(pid,), daemon=True).start()

    def list_sessions(self) -> list[dict]:
        out = []
        for d in self.sessions_dir.iterdir():
            if not d.is_dir() or d.name in self.cancelled:
                continue
            with self.lock:
                s = self.sessions.get(d.name)
                if s is None:
                    try:
                        s = json.loads((d / "session.json").read_text("utf-8"))
                    except (OSError, ValueError):
                        continue
                tracks = s.get("tracks", [])
                out.append({
                    "id": s["id"],
                    "title": s.get("title") or s.get("url"),
                    "url": s.get("url"),
                    "status": s.get("status"),
                    "tracks": len(tracks),
                    "ready": sum(1 for t in tracks if t["status"] == "ready"),
                    "edited": sum(1 for t in tracks if t.get("cuts")),
                    "updated": s.get("updated", 0),
                })
        out.sort(key=lambda x: x["updated"], reverse=True)
        return out

    def snapshot(self, pid: str) -> dict:
        with self.lock:
            s = copy.deepcopy(self._get(pid))
            s["suggested_folder"] = (s.get("export") or {}).get("folder") or str(
                self.export_root() / safe_filename(s.get("title") or "Playlist"))
            return s

    def track_snapshot(self, pid: str, tid: str) -> dict:
        with self.lock:
            return copy.deepcopy(self._track(pid, tid))

    # ------------------------------------------------------------------ sessions

    def open_url(self, raw_url: str) -> str:
        url = normalize_url(raw_url)
        pid = hashlib.sha1(url.encode("utf-8")).hexdigest()[:12]
        with self.lock:
            if pid in self.cancelled:
                raise ValueError("That playlist is still being deleted, try again in a moment.")
            try:
                self._get(pid)
                return pid
            except NotFound:
                pass
            now = time.time()
            self.sessions[pid] = {
                "id": pid, "url": url, "title": "", "uploader": "", "status": "resolving", "error": None,
                "created": now, "updated": now, "tracks": [], "export": None,
            }
            self.tracks_dir(pid).mkdir(parents=True, exist_ok=True)
            self._save(pid)
        threading.Thread(target=self._resolve, args=(pid,), daemon=True).start()
        return pid

    def refresh(self, pid: str) -> None:
        with self.lock:
            s = self._get(pid)
            if s["status"] == "resolving":
                return
            s["status"] = "resolving"
            s["error"] = None
            self._save(pid)
        threading.Thread(target=self._resolve, args=(pid,), daemon=True).start()

    def _resolve(self, pid: str) -> None:
        with self.lock:
            s = self.sessions.get(pid)
            if s is None:
                return
            url, token = s["url"], self.settings["oauth_token"]
        try:
            title, uploader, entries = downloader.list_tracks(url, self.ff.exe, token)
            if not entries:
                raise RuntimeError("No tracks found at that link. Is the playlist public (or did you paste its private share link)?")
        except Exception as exc:  # noqa: BLE001
            with self.lock:
                s = self.sessions.get(pid)
                if s is not None:
                    s["status"] = "ready" if s["tracks"] else "error"
                    s["error"] = downloader.clean_error(exc)
                    self._save(pid)
            return

        with self.lock:
            s = self.sessions.get(pid)
            if s is None or pid in self.cancelled:
                return
            by_sid = {t["sid"]: t for t in s["tracks"] if t.get("sid")}
            by_url = {t["url"]: t for t in s["tracks"]}
            used_keys = {t["id"] for t in s["tracks"]}
            placed: set[int] = set()
            ordered, fresh = [], []
            for entry in entries:
                t = (by_sid.get(entry["id"]) if entry["id"] else None) or by_url.get(entry["url"])
                if t is None or id(t) in placed:
                    t = self._new_track(entry, used_keys)
                    fresh.append(t)
                placed.add(id(t))
                ordered.append(t)
            ordered += [t for t in s["tracks"] if id(t) not in placed]
            for i, t in enumerate(ordered, 1):
                t["index"] = i
            s.update(tracks=ordered, title=title, uploader=uploader, status="ready", error=None)
            self._save(pid)
            for t in fresh:
                self.workers.submit(self._download_job, pid, t["id"])

    @staticmethod
    def _new_track(entry: dict, used_keys: set) -> dict:
        sid = re.sub(r"[^A-Za-z0-9_-]", "", entry["id"])[:40]
        base = sid or hashlib.sha1(entry["url"].encode("utf-8")).hexdigest()[:12]
        key, n = base, 2
        while key in used_keys:
            key, n = f"{base}-{n}", n + 1
        used_keys.add(key)
        return {
            "id": key, "sid": entry["id"], "index": 0, "url": entry["url"], "permalink": entry["url"],
            "title": entry["title"], "artist": entry["artist"], "meta_locked": False,
            "status": "queued", "progress": 0.0, "error": None, "warning": None,
            "duration": None, "file": None, "quality": None, "cover": False,
            "cuts": [], "included": True,
        }

    def delete(self, pid: str) -> None:
        folder = self._dir(pid)
        with self.lock:
            self.cancelled.add(pid)
            self.sessions.pop(pid, None)
        try:
            for _ in range(40):  # give running downloads a moment to notice and release files
                shutil.rmtree(folder, ignore_errors=True)
                if not folder.exists():
                    break
                time.sleep(0.25)
        finally:
            with self.lock:
                self.cancelled.discard(pid)
        if folder.exists():
            raise RuntimeError("Some files are still in use; close other programs using them and try again.")

    # ------------------------------------------------------------------ downloads

    def retry(self, pid: str, tid: str | None = None) -> None:
        with self.lock:
            s = self._get(pid)
            for t in s["tracks"]:
                if (tid is None or t["id"] == tid) and t["status"] == "error":
                    t.update(status="queued", progress=0.0, error=None)
                    self.workers.submit(self._download_job, pid, t["id"])
            self._save(pid)

    def _download_job(self, pid: str, tid: str) -> None:
        with self.lock:
            if self.stopping or pid in self.cancelled or pid not in self.sessions:
                return
            try:
                t = self._track(pid, tid)
            except NotFound:
                return
            if t["status"] != "queued":
                return
            t.update(status="fetching", progress=0.0, error=None, warning=None)
            url, token = t["url"], self.settings["oauth_token"]
        tdir = self.tracks_dir(pid)

        def cancelled() -> bool:
            return self.stopping or pid in self.cancelled or pid not in self.sessions

        def on_info(info: dict) -> None:
            with self.lock:
                if not t.get("meta_locked"):
                    t["title"] = info.get("title") or t["title"]
                    t["artist"] = info.get("artist") or info.get("uploader") or t["artist"]
                t["permalink"] = info.get("webpage_url") or t["permalink"]
                t["expected_duration"] = info.get("duration")
                t["status"] = "downloading"

        def on_progress(frac) -> None:
            if frac is not None:
                t["progress"] = round(frac, 3)

        try:
            result = downloader.download_track(url, tdir, tid, self.ff.exe, token, on_info, on_progress, cancelled)
            with self.lock:
                t.update(status="analyzing", progress=1.0, file=result.audio.name,
                         quality=downloader.describe_quality(result.info))
            duration = self.ff.analyze(result.audio, tdir / f"{tid}.wave")
            has_cover = False
            if result.thumbnail:
                try:
                    self.ff.make_cover(result.thumbnail, tdir / f"{tid}.cover.jpg")
                    result.thumbnail.unlink()
                    has_cover = True
                except Exception:  # noqa: BLE001 - artwork is optional
                    pass
            stale_preview = tdir / f"{tid}.preview.flac"
            if stale_preview.exists():
                stale_preview.unlink()
            with self.lock:
                expected = t.get("expected_duration") or 0
                warning = None
                if expected and duration <= 35 and expected - duration > 5:
                    warning = ("Only a 30-second preview was available (Go+ track). Add your SoundCloud "
                               "OAuth token in Settings and retry to get the full track.")
                t.update(status="ready", duration=round(duration, 4), cover=has_cover, warning=warning,
                         cuts=normalize_cuts(t.get("cuts") or [], duration))
                self._save(pid)
            print(f"  ✓ {t['title'] or tid}  [{t['quality']}]", flush=True)
        except downloader.Cancelled:
            with self.lock:
                if t["status"] in ACTIVE:
                    t.update(status="queued", progress=0.0)
        except Exception as exc:  # noqa: BLE001
            with self.lock:
                t.update(status="error", error=downloader.clean_error(exc), progress=0.0)
                self._save(pid)
            print(f"  ✗ {t['title'] or tid}: {t['error']}", flush=True)

    # ------------------------------------------------------------------ editing

    def update_track(self, pid: str, tid: str, data: dict) -> dict:
        with self.lock:
            t = self._track(pid, tid)
            if "cuts" in data:
                if t["status"] != "ready" or not t["duration"]:
                    raise ValueError("This track isn't downloaded yet.")
                cuts = normalize_cuts(data["cuts"], t["duration"])
                if t["duration"] - cut_total(cuts) < 0.1:
                    raise ValueError("You can't cut away the whole track.")
                t["cuts"] = cuts
            for field in ("title", "artist"):
                if field in data:
                    t[field] = str(data[field] or "").strip()[:300]
                    t["meta_locked"] = True
            if "included" in data:
                t["included"] = bool(data["included"])
            self._save(pid)
            return copy.deepcopy(t)

    def set_all_included(self, pid: str, included: bool) -> None:
        with self.lock:
            for t in self._get(pid)["tracks"]:
                t["included"] = bool(included)
            self._save(pid)

    def media_path(self, pid: str, tid: str, kind: str) -> Path | None:
        with self.lock:
            t = self._track(pid, tid)
            ready, name = t["status"] == "ready", t.get("file")
        tdir = self.tracks_dir(pid)
        if kind == "cover":
            path = tdir / f"{tid}.cover.jpg"
            return path if path.is_file() else None
        if not ready or not name:
            return None
        if kind == "audio":
            return tdir / name
        if kind == "peaks":
            path = tdir / f"{tid}.wave"
            with self._derived_lock:
                if not path.is_file():  # sessions from older versions, or a deleted cache file
                    self.ff.analyze(tdir / name, path)
            return path
        if kind == "preview":
            path = tdir / f"{tid}.preview.flac"
            with self._derived_lock:
                if not path.is_file():
                    self.ff.make_preview(tdir / name, path)
            return path
        return None

    # ------------------------------------------------------------------ export

    def start_export(self, pid: str, fmt: str, folder: str, naming: str, cover: bool) -> None:
        if fmt not in FORMATS:
            raise ValueError("Unknown format")
        if FORMATS[fmt].get("needs_mp3") and not self.ff.has_mp3:
            raise ValueError("Your ffmpeg has no MP3 encoder, pick WAV or FLAC instead.")
        if naming not in NAMING:
            raise ValueError("Unknown naming scheme")
        folder = os.path.expandvars(os.path.expanduser((folder or "").strip()))
        if not folder:
            raise ValueError("Choose a folder to save the playlist to.")
        out = Path(folder)
        if not out.is_absolute():
            raise ValueError("Please enter a full folder path.")
        with self.lock:
            s = self._get(pid)
            if (s.get("export") or {}).get("status") == "running":
                raise ValueError("This playlist is already being saved.")
            total = sum(1 for t in s["tracks"] if t["included"])
            if not total:
                raise ValueError("No tracks are ticked for saving.")
            s["export"] = {
                "status": "running", "format": fmt, "folder": str(out), "naming": naming, "cover": bool(cover),
                "done": 0, "total": total, "files": 0, "current": "", "errors": [],
                "started": time.time(), "finished": None,
            }
            self.settings.update(format=fmt, naming=naming, embed_cover=bool(cover))
            self._save_settings()
            self._save(pid)
        threading.Thread(target=self._export_job, args=(pid,), daemon=True, name="cloudsnip-export").start()

    @staticmethod
    def _display_name(t: dict, template: str = "{artist} - {title}", n: str = "") -> str:
        artist = (t["artist"] or "").strip() or "Unknown artist"
        title = (t["title"] or "").strip() or f"Track {t['index']}"
        if "{artist}" in template and title.lower().startswith(artist.lower()):
            # SoundCloud titles are often already "Artist - Title"; don't repeat the artist.
            template = template.replace("{artist} - ", "")
        return template.format(n=n, artist=artist, title=title)

    def _export_job(self, pid: str) -> None:
        with self.lock:
            s = self.sessions.get(pid)
            if s is None:
                return
            ex = s["export"]
            chosen = copy.deepcopy([t for t in s["tracks"] if t["included"]])
            album = s.get("title") or "Playlist"
        spec = FORMATS[ex["format"]]
        out = Path(ex["folder"])
        tdir = self.tracks_dir(pid)
        # Number only the tracks that can actually be saved, so the files are 01, 02, 03...
        tracks = [t for t in chosen if t["status"] == "ready" and t.get("file")]
        saving = {t["id"] for t in tracks}
        with self.lock:
            for t in chosen:
                if t["id"] not in saving:
                    ex["errors"].append({"title": t["title"] or f"Track {t['index']}",
                                         "error": "download failed" if t["status"] == "error" else "not downloaded yet"})
                    ex["done"] += 1
        width = max(2, len(str(len(tracks))))
        used: set[str] = set()
        playlist_lines = ["#EXTM3U"]
        try:
            out.mkdir(parents=True, exist_ok=True)
        except OSError as exc:
            with self.lock:
                ex.update(status="done", finished=time.time(), done=ex["total"],
                          errors=[{"title": "Folder", "error": f"Can't create {out}: {exc.strerror or exc}"}])
                self._save(pid)
            return

        print(f"  Saving {len(tracks)} tracks to {out}", flush=True)
        for n, t in enumerate(tracks, 1):
            label = t["title"] or f"Track {t['index']}"
            if self.stopping or pid in self.cancelled:
                break
            with self.lock:
                ex["current"] = label
            try:
                name = base = safe_filename(self._display_name(t, NAMING[ex["naming"]][1], str(n).zfill(width)))
                k = 2
                while name.lower() in used:
                    name, k = f"{base} ({k})", k + 1
                used.add(name.lower())
                dst = out / f"{name}.{spec['ext']}"
                keeps = keeps_from_cuts(t["cuts"], t["duration"])
                cover = tdir / f"{t['id']}.cover.jpg" if ex["cover"] and t.get("cover") else None
                meta = {"title": t["title"] or label, "artist": t["artist"], "album": album,
                        "track": f"{n}/{len(tracks)}"}
                self.ff.export(tdir / t["file"], dst, ex["format"], keeps, t["duration"], meta, cover)
                length = round(sum(b - a for a, b in keeps))
                playlist_lines += [f"#EXTINF:{length},{self._display_name(t)}", dst.name]
                with self.lock:
                    ex["files"] += 1
            except Exception as exc:  # noqa: BLE001
                with self.lock:
                    ex["errors"].append({"title": label, "error": str(exc)[:300]})
            finally:
                with self.lock:
                    ex["done"] += 1

        if len(playlist_lines) > 1:
            try:
                (out / f"{safe_filename(album)}.m3u8").write_text("\n".join(playlist_lines) + "\n", "utf-8")
            except OSError:
                pass
        with self.lock:
            ex.update(status="done" if not self.stopping else "interrupted", current="", finished=time.time())
            self._save(pid)
        print(f"  Saved {ex['files']}/{ex['total']} tracks to {out}", flush=True)

    # ------------------------------------------------------------------ shutdown

    def stop(self) -> None:
        self.stopping = True
        with self.lock:
            for pid, s in list(self.sessions.items()):
                for t in s["tracks"]:
                    if t["status"] in ACTIVE:
                        t.update(status="queued", progress=0.0)
                if (s.get("export") or {}).get("status") == "running":
                    s["export"]["status"] = "interrupted"
                try:
                    self._save(pid)
                except OSError:
                    pass
