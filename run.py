#!/usr/bin/env python3
"""
CloudSnip launcher: the only command you need.

    Windows:  py run.py          (or double-click CloudSnip.bat)
    Linux:    python3 run.py     (or ./cloudsnip.sh)

The first run creates a private virtual environment in ./.venv and installs the
dependencies into it (yt-dlp, Flask and a bundled ffmpeg). Later runs start
straight away. Every few days it also updates yt-dlp, because SoundCloud changes
occasionally break older versions.

Options:  --port N   --no-browser   --update (force a yt-dlp update now)
"""

from __future__ import annotations

import hashlib
import os
import subprocess
import sys
import time
from pathlib import Path

MIN_PYTHON = (3, 10)
ROOT = Path(__file__).resolve().parent
VENV = ROOT / ".venv"
REQUIREMENTS = ROOT / "requirements.txt"
STAMP = VENV / ".cloudsnip-installed"
UPDATE_EVERY = 3 * 24 * 3600


def say(msg: str) -> None:
    print(f"[cloudsnip] {msg}", flush=True)


def die(msg: str) -> None:
    print(f"\n[cloudsnip] ERROR: {msg}\n", file=sys.stderr, flush=True)
    sys.exit(1)


def venv_python() -> Path:
    return VENV / ("Scripts/python.exe" if os.name == "nt" else "bin/python")


def ensure_venv() -> Path:
    py = venv_python()
    if py.exists():
        return py
    say("First run: creating a private Python environment in .venv ...")
    import venv

    try:
        venv.EnvBuilder(with_pip=True, clear=True).create(VENV)
    except Exception as exc:  # noqa: BLE001
        hint = ""
        if sys.platform.startswith("linux"):
            v = f"{sys.version_info.major}.{sys.version_info.minor}"
            hint = (f"\n  On Debian/Ubuntu/Mint install venv support first:  sudo apt install python3-venv  "
                    f"(or python{v}-venv)\n  On Fedora:  sudo dnf install python3-pip")
        die(f"Could not create the virtual environment: {exc}{hint}")
    if not py.exists():
        die("The virtual environment was created without Python. Delete the .venv folder and try again.")
    return py


def pip(py: Path, *args: str) -> int:
    return subprocess.call([str(py), "-m", "pip", "--disable-pip-version-check", "--no-input", *args])


def ensure_requirements(py: Path, force_update: bool) -> None:
    digest = hashlib.sha256(REQUIREMENTS.read_bytes()).hexdigest()
    try:
        stored_digest, stored_time = STAMP.read_text().split()
        stored_time = float(stored_time)
    except (OSError, ValueError):
        stored_digest, stored_time = "", 0.0

    if stored_digest != digest:
        say("Installing dependencies (one time only, about 40 MB) ...")
        if pip(py, "install", "--upgrade", "-r", str(REQUIREMENTS)) != 0:
            die("Installing dependencies failed. Check your internet connection and run this again.")
    elif force_update or time.time() - stored_time > UPDATE_EVERY:
        say("Checking for yt-dlp updates ...")
        if pip(py, "install", "-q", "--upgrade", "yt-dlp") != 0:
            say("Could not update yt-dlp right now (offline?). Continuing with the installed version.")
    else:
        return
    STAMP.write_text(f"{digest} {time.time()}")


def main() -> None:
    if sys.version_info < MIN_PYTHON:
        die(f"CloudSnip needs Python {MIN_PYTHON[0]}.{MIN_PYTHON[1]} or newer (you have {sys.version.split()[0]}). "
            "Get it from https://www.python.org/downloads/")
    args = sys.argv[1:]
    force_update = "--update" in args
    args = [a for a in args if a != "--update"]

    py = ensure_venv()
    ensure_requirements(py, force_update)

    proc = subprocess.Popen([str(py), "-m", "cloudsnip", *args], cwd=str(ROOT))
    while True:
        try:
            sys.exit(proc.wait())
        except KeyboardInterrupt:
            continue  # Ctrl+C reaches the app too; wait for it to shut down cleanly


if __name__ == "__main__":
    main()
