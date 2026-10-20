"""Start CloudSnip: `python -m cloudsnip` (run.py does this for you inside its virtualenv)."""

from __future__ import annotations

import argparse
import logging
import mimetypes
import os
import socket
import sys
import threading
import webbrowser

from . import APP_NAME, __version__


def _port_free(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        if os.name == "nt":
            # Without this Windows lets a second server silently share the port.
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_EXCLUSIVEADDRUSE, 1)
        try:
            sock.bind(("127.0.0.1", port))
        except OSError:
            return False
    return True


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="cloudsnip", description=f"{APP_NAME}: download, trim and save SoundCloud playlists.")
    parser.add_argument("--port", type=int, default=8765, help="preferred local port (default 8765)")
    parser.add_argument("--no-browser", action="store_true", help="don't open the browser automatically")
    args = parser.parse_args(argv)

    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(errors="replace")
        except (AttributeError, ValueError):
            pass
    # Some Windows registries map .js to text/plain, which browsers refuse to execute.
    mimetypes.add_type("application/javascript", ".js")
    mimetypes.add_type("text/css", ".css")
    mimetypes.add_type("image/svg+xml", ".svg")
    logging.getLogger("werkzeug").setLevel(logging.ERROR)

    from werkzeug.serving import make_server

    from .audio import FFmpeg, FFmpegError, find_ffmpeg
    from .config import workspace_dir
    from .server import create_app
    from .sessions import Manager

    try:
        ff = FFmpeg(find_ffmpeg())
    except FFmpegError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1

    manager = Manager(workspace_dir(), ff)
    app = create_app(manager, ff)

    port = next((p for p in range(args.port, args.port + 20) if _port_free(p)), 0)
    server = make_server("127.0.0.1", port, app, threaded=True)
    port = server.server_port
    app.config["ALLOWED_HOSTS"] = {f"127.0.0.1:{port}", f"localhost:{port}"}
    url = f"http://127.0.0.1:{port}/"

    print(f"\n  {APP_NAME} {__version__} is running at {url}")
    print(f"  ffmpeg: {ff.version}{'' if ff.has_mp3 else '  (no MP3 encoder)'}")
    print(f"  workspace: {manager.ws}")
    print("  Keep this window open while you use it. Press Ctrl+C to quit.\n", flush=True)

    if not args.no_browser:
        threading.Timer(0.7, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping...", flush=True)
    finally:
        manager.stop()
        server.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
