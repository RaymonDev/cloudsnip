"""Thin wrapper around yt-dlp: list a playlist's tracks and download one track."""

from __future__ import annotations

import glob
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Optional
from urllib.parse import urlsplit

import yt_dlp

_ANSI = re.compile(r"\x1b\[[0-9;]*m")
_TEMP_SUFFIXES = (".part", ".ytdl", ".temp", ".tmp")
_PLAYLIST_TYPES = ("playlist", "multi_video")


class Cancelled(Exception):
    """A download was stopped on purpose (app closing or playlist deleted)."""


class _Logger:
    def __init__(self):
        self.errors: list[str] = []
        self.warnings: list[str] = []

    def debug(self, msg):
        pass

    def info(self, msg):
        pass

    def warning(self, msg):
        self.warnings.append(msg)

    def error(self, msg):
        self.errors.append(msg)


@dataclass
class Downloaded:
    audio: Path
    thumbnail: Optional[Path]
    info: dict


def yt_dlp_version() -> str:
    return yt_dlp.version.__version__


def clean_error(exc) -> str:
    msg = _ANSI.sub("", str(exc)).strip()
    msg = re.sub(r"^ERROR:\s*", "", msg)
    msg = re.sub(r"^\[[^\]]+\]\s*(\S+:\s+)?", "", msg)
    if "DRM" in msg:
        return "SoundCloud only streams this track with DRM copy protection, so it can't be downloaded."
    return msg[:300] or type(exc).__name__


def _base_opts(ffmpeg: str, token: str) -> dict:
    opts = {
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "logger": _Logger(),
        "ffmpeg_location": ffmpeg,
        "retries": 10,
        "fragment_retries": 10,
        "extractor_retries": 3,
        "socket_timeout": 30,
    }
    if token:
        # yt-dlp's SoundCloud extractor accepts an OAuth token this way (needed for Go+ quality).
        opts["username"] = "oauth"
        opts["password"] = token
    return opts


def _entry(info: dict) -> dict:
    return {
        "url": info.get("webpage_url") or info.get("url") or "",
        "id": str(info.get("id") or ""),
        "title": info.get("title") or "",
        "artist": info.get("artist") or info.get("uploader") or "",
    }


def _is_playlist(entry: dict) -> bool:
    if entry.get("_type") in _PLAYLIST_TYPES:
        return True
    if (entry.get("ie_key") or "").lower() in ("soundcloudset", "soundcloudplaylist"):
        return True
    return "/sets/" in urlsplit(entry.get("url") or "").path


def _flatten(ydl, info: dict, depth: int) -> list[dict]:
    if info.get("_type") not in _PLAYLIST_TYPES and "entries" not in info:
        return [_entry(info)]
    tracks = []
    for entry in info.get("entries") or []:
        if not entry:
            continue
        if _is_playlist(entry):
            # e.g. a user's "sets" page: expand each playlist one level deep.
            if depth < 1 and entry.get("url"):
                tracks.extend(_flatten(ydl, ydl.extract_info(entry["url"], download=False), depth + 1))
            continue
        tracks.append(_entry(entry))
    return [t for t in tracks if t["url"]]


def list_tracks(url: str, ffmpeg: str, token: str = "") -> tuple[str, str, list[dict]]:
    """Return (title, uploader, tracks) without downloading anything."""
    opts = _base_opts(ffmpeg, token) | {"extract_flat": "in_playlist", "skip_download": True}
    log = opts["logger"]
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)
            tracks = _flatten(ydl, info, 0)
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(clean_error(log.errors[-1] if log.errors else exc)) from exc
    title = info.get("title") or (tracks[0]["title"] if len(tracks) == 1 else "") or "Untitled playlist"
    return title, info.get("uploader") or "", tracks


def describe_quality(info: dict) -> str:
    """Human readable description of the stream that was picked."""
    ext = (info.get("ext") or "").upper()
    if info.get("format_id") == "download" or (info.get("format_note") or "").lower() == "original":
        return f"Original upload · {ext}" if ext else "Original upload"
    codec = (info.get("acodec") or "").lower()
    if "mp3" in codec:
        name = "MP3"
    elif "aac" in codec or "mp4a" in codec:
        name = "AAC"
    elif "opus" in codec:
        name = "Opus"
    elif "vorbis" in codec:
        name = "Vorbis"
    else:
        name = codec.upper() if codec and codec != "none" else ext or "Audio"
    abr = info.get("abr") or info.get("tbr")
    return f"{name} · {round(abr)} kbps" if abr else name


def download_track(
    url: str,
    dest: Path,
    key: str,
    ffmpeg: str,
    token: str,
    on_info: Callable[[dict], None],
    on_progress: Callable[[Optional[float]], None],
    should_cancel: Callable[[], bool],
) -> Downloaded:
    """Download the best available audio stream for one track, plus its artwork."""
    dest.mkdir(parents=True, exist_ok=True)

    def hook(d):
        if should_cancel():
            raise Cancelled()
        if d.get("status") != "downloading":
            return
        total = d.get("total_bytes") or d.get("total_bytes_estimate")
        if total:
            on_progress(min(1.0, (d.get("downloaded_bytes") or 0) / total))
        elif d.get("fragment_count"):
            on_progress(min(1.0, (d.get("fragment_index") or 0) / d["fragment_count"]))
        else:
            on_progress(None)

    opts = _base_opts(ffmpeg, token) | {
        "format": "bestaudio/best",
        "noplaylist": True,
        "outtmpl": {
            "default": str(dest / f"{key}.src.%(ext)s"),
            "thumbnail": str(dest / f"{key}.thumb.%(ext)s"),
        },
        "writethumbnail": True,
        "overwrites": True,
        "progress_hooks": [hook],
        # Return the metadata even when no stream is downloadable (e.g. DRM), so the
        # track still shows its real title; we raise our own error below instead.
        "ignore_no_formats_error": True,
    }
    log = opts["logger"]
    try:
        with yt_dlp.YoutubeDL(opts) as ydl:
            raw = ydl.extract_info(url, download=False, process=False)
            if raw.get("_type") in _PLAYLIST_TYPES:
                raise RuntimeError("This link is a playlist, not a single track")
            on_info(raw)
            if raw.get("_type") in (None, "video") and not raw.get("formats") and not raw.get("url"):
                reason = log.warnings[-1] if log.warnings else "No downloadable audio stream was found for this track"
                raise RuntimeError(clean_error(reason))
            if should_cancel():
                raise Cancelled()
            info = ydl.process_ie_result(raw, download=True)
    except Cancelled:
        raise
    except Exception as exc:  # noqa: BLE001
        if should_cancel():
            raise Cancelled() from exc
        raise RuntimeError(clean_error(log.errors[-1] if log.errors else exc)) from exc

    audio = None
    for item in info.get("requested_downloads") or []:
        path = item.get("filepath") or item.get("_filename")
        if path and Path(path).is_file():
            audio = Path(path)
            break
    if audio is None:
        candidates = [Path(p) for p in glob.glob(str(dest / f"{glob.escape(key)}.src.*"))
                      if not p.endswith(_TEMP_SUFFIXES)]
        audio = max(candidates, key=lambda p: p.stat().st_mtime) if candidates else None
    if audio is None:
        raise RuntimeError(clean_error(log.warnings[-1]) if log.warnings
                           else "The download finished but no audio file was found")
    thumbs = [Path(p) for p in glob.glob(str(dest / f"{glob.escape(key)}.thumb.*"))
              if not p.endswith(_TEMP_SUFFIXES)]
    return Downloaded(audio, thumbs[0] if thumbs else None, info)
