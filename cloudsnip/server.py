"""The local HTTP API and static UI."""

from __future__ import annotations

import hmac
import os
import secrets
import shutil
import subprocess
import sys
import threading
import time
from pathlib import Path

from flask import Flask, Response, abort, jsonify, request, send_file

from . import __version__, downloader
from .audio import FORMATS, PEAK_RATE, FFmpeg
from .config import STATIC_DIR
from .sessions import NAMING, Manager, NotFound

AUDIO_TYPES = {
    ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".mp4": "audio/mp4", ".aac": "audio/aac",
    ".ogg": "audio/ogg", ".opus": "audio/ogg", ".oga": "audio/ogg", ".webm": "audio/webm",
    ".wav": "audio/wav", ".flac": "audio/flac", ".aif": "audio/aiff", ".aiff": "audio/aiff",
}

_PICK_FOLDER_TK = r"""
import sys
sys.stdout.reconfigure(encoding="utf-8")
import tkinter as tk
from tkinter import filedialog
root = tk.Tk()
root.withdraw()
root.attributes("-topmost", True)
path = filedialog.askdirectory(initialdir=sys.argv[1] or None, title="Choose where to save the playlist", mustexist=False)
print(path or "", end="")
"""


def _pick_folder(initial: str) -> str | None:
    """Show a native folder chooser. Returns None when no chooser is available."""
    initial = initial if initial and os.path.isdir(initial) else str(Path.home())
    if sys.platform.startswith("linux"):
        if shutil.which("zenity"):
            proc = subprocess.run(["zenity", "--file-selection", "--directory", f"--filename={initial}/"],
                                  capture_output=True, text=True, encoding="utf-8")
            return proc.stdout.strip()
        if shutil.which("kdialog"):
            proc = subprocess.run(["kdialog", "--getexistingdirectory", initial],
                                  capture_output=True, text=True, encoding="utf-8")
            return proc.stdout.strip()
    try:
        proc = subprocess.run([sys.executable, "-c", _PICK_FOLDER_TK, initial],
                              capture_output=True, text=True, encoding="utf-8", timeout=900)
    except (OSError, subprocess.SubprocessError):
        return None
    if proc.returncode != 0:
        return None
    return os.path.normpath(proc.stdout) if proc.stdout else ""


def _open_folder(path: str) -> None:
    if os.name == "nt":
        os.startfile(path)  # noqa: S606 - opening a local folder in Explorer
    elif sys.platform == "darwin":
        subprocess.Popen(["open", path])
    else:
        subprocess.Popen(["xdg-open", path], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def create_app(manager: Manager, ff: FFmpeg) -> Flask:
    app = Flask(__name__, static_folder=str(STATIC_DIR), static_url_path="/static")
    app.config["SEND_FILE_MAX_AGE_DEFAULT"] = 0
    app.config["ALLOWED_HOSTS"] = set()
    token = secrets.token_urlsafe(24)

    @app.before_request
    def guard():
        # Only answer requests addressed to this machine (blocks DNS-rebinding),
        # and require the per-launch token for anything that reads or changes data.
        if (request.host or "").lower() not in app.config["ALLOWED_HOSTS"]:
            abort(403)
        if request.path.startswith(("/api/", "/media/")):
            given = request.headers.get("X-Token") or request.args.get("t") or ""
            if not hmac.compare_digest(given.encode(), token.encode()):
                return jsonify(error="Forbidden"), 403
        return None

    @app.errorhandler(NotFound)
    def not_found(exc):
        return jsonify(error=str(exc)), 404

    @app.errorhandler(ValueError)
    def bad_request(exc):
        return jsonify(error=str(exc)), 400

    @app.errorhandler(Exception)
    def failed(exc):
        if hasattr(exc, "code") and hasattr(exc, "get_response"):  # werkzeug HTTP errors
            return exc
        app.logger.exception("Request failed")
        return jsonify(error=str(exc) or type(exc).__name__), 500

    def body() -> dict:
        data = request.get_json(silent=True)
        return data if isinstance(data, dict) else {}

    # ---------------------------------------------------------------- pages

    @app.get("/")
    def index():
        html = (STATIC_DIR / "index.html").read_text("utf-8")
        html = html.replace("__TOKEN__", token).replace("__VERSION__", __version__)
        resp = Response(html, mimetype="text/html")
        resp.headers["Cache-Control"] = "no-store"
        return resp

    # ---------------------------------------------------------------- app state

    @app.get("/api/state")
    def state():
        return jsonify(
            version=__version__,
            settings=manager.public_settings(),
            formats=[{"id": k, "label": v["label"], "ext": v["ext"], "cover": v["cover"],
                      "available": not v.get("needs_mp3") or ff.has_mp3} for k, v in FORMATS.items()],
            naming=[{"id": k, "label": v[0]} for k, v in NAMING.items()],
            peak_rate=PEAK_RATE,
            ffmpeg=ff.version,
            ytdlp=downloader.yt_dlp_version(),
            workspace=str(manager.ws),
        )

    @app.put("/api/settings")
    def settings():
        return jsonify(manager.update_settings(body()))

    # ---------------------------------------------------------------- playlists

    @app.get("/api/sessions")
    def sessions():
        return jsonify(manager.list_sessions())

    @app.post("/api/playlists")
    def open_playlist():
        pid = manager.open_url(str(body().get("url") or ""))
        return jsonify(id=pid)

    @app.get("/api/playlists/<pid>")
    def playlist(pid):
        return jsonify(manager.snapshot(pid))

    @app.delete("/api/playlists/<pid>")
    def delete_playlist(pid):
        manager.delete(pid)
        return jsonify(ok=True)

    @app.post("/api/playlists/<pid>/refresh")
    def refresh(pid):
        manager.refresh(pid)
        return jsonify(ok=True)

    @app.post("/api/playlists/<pid>/retry")
    def retry_all(pid):
        manager.retry(pid)
        return jsonify(ok=True)

    @app.post("/api/playlists/<pid>/include")
    def include_all(pid):
        manager.set_all_included(pid, bool(body().get("included")))
        return jsonify(ok=True)

    @app.put("/api/playlists/<pid>/tracks/<tid>")
    def update_track(pid, tid):
        return jsonify(manager.update_track(pid, tid, body()))

    @app.post("/api/playlists/<pid>/tracks/<tid>/retry")
    def retry_track(pid, tid):
        manager.retry(pid, tid)
        return jsonify(manager.track_snapshot(pid, tid))

    @app.post("/api/playlists/<pid>/export")
    def export(pid):
        data = body()
        manager.start_export(pid, str(data.get("format") or ""), str(data.get("folder") or ""),
                             str(data.get("naming") or ""), bool(data.get("cover", True)))
        return jsonify(manager.snapshot(pid))

    # ---------------------------------------------------------------- media

    @app.get("/media/<pid>/<tid>/<kind>")
    def media(pid, tid, kind):
        if kind not in ("audio", "preview", "peaks", "cover"):
            abort(404)
        path = manager.media_path(pid, tid, kind)
        if path is None or not path.is_file():
            abort(404)
        if kind == "peaks":
            mimetype = "application/octet-stream"
        elif kind == "cover":
            mimetype = "image/jpeg"
        else:
            mimetype = AUDIO_TYPES.get(path.suffix.lower(), "application/octet-stream")
        return send_file(path, mimetype=mimetype, conditional=True, max_age=0)

    # ---------------------------------------------------------------- desktop helpers

    @app.post("/api/pick-folder")
    def pick_folder():
        path = _pick_folder(str(body().get("initial") or ""))
        if path is None:
            return jsonify(error="No folder picker is available here; type the folder path instead."), 501
        return jsonify(path=path)

    @app.post("/api/open-folder")
    def open_folder():
        path = str(body().get("path") or "")
        if not path or not os.path.isdir(path):
            raise ValueError("That folder doesn't exist (yet).")
        _open_folder(path)
        return jsonify(ok=True)

    @app.post("/api/shutdown")
    def shutdown():
        def stop():
            time.sleep(0.3)
            manager.stop()
            print("\nCloudSnip was closed from the browser. Bye!", flush=True)
            os._exit(0)

        threading.Thread(target=stop, daemon=True).start()
        return jsonify(ok=True)

    return app
