"""Filesystem locations used by CloudSnip."""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

PACKAGE_DIR = Path(__file__).resolve().parent
ROOT = PACKAGE_DIR.parent
STATIC_DIR = PACKAGE_DIR / "static"


def workspace_dir() -> Path:
    """Where downloads, waveforms and session state live (never your exported files)."""
    env = os.environ.get("CLOUDSNIP_WORKSPACE")
    path = Path(env).expanduser() if env else ROOT / "workspace"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _music_dir() -> Path:
    home = Path.home()
    if sys.platform.startswith("linux") and shutil.which("xdg-user-dir"):
        try:
            out = subprocess.run(["xdg-user-dir", "MUSIC"], capture_output=True, text=True, timeout=5)
            candidate = Path(out.stdout.strip())
            if out.returncode == 0 and candidate.is_dir() and candidate != home:
                return candidate
        except (OSError, subprocess.SubprocessError):
            pass
    music = home / "Music"
    return music if music.is_dir() else home


def default_export_dir() -> Path:
    return _music_dir() / "CloudSnip"
