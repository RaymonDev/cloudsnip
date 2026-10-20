"""Everything that runs ffmpeg: locating it, analysing tracks and rendering exports."""

from __future__ import annotations

import math
import os
import shutil
import subprocess
import sys
import tempfile
from array import array
from operator import mul
from pathlib import Path

PEAK_RATE = 100        # waveform points per second sent to the browser (each is a peak + rms byte)
_DECODE_RATE = 8000    # sample rate used only for drawing the waveform
FADE = 0.006           # seconds of fade at every cut point, so joins never click

_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)

# Every export keeps the source's sample rate and channel layout.
FORMATS = {
    "wav": {
        "label": "WAV · 24-bit (lossless)",
        "ext": "wav",
        "args": ["-c:a", "pcm_s24le", "-rf64", "auto", "-f", "wav"],
        "cover": False,
    },
    "wav16": {
        "label": "WAV · 16-bit (CD)",
        "ext": "wav",
        "args": ["-c:a", "pcm_s16le", "-rf64", "auto", "-f", "wav"],
        "post": "aresample=osf=s16:dither_method=triangular",
        "cover": False,
    },
    "flac": {
        "label": "FLAC (lossless, smaller)",
        "ext": "flac",
        "args": ["-c:a", "flac", "-compression_level", "8", "-f", "flac"],
        "cover": True,
    },
    "mp3": {
        "label": "MP3 · 320 kbps",
        "ext": "mp3",
        "args": ["-c:a", "libmp3lame", "-b:a", "320k", "-id3v2_version", "3", "-f", "mp3"],
        "cover": True,
        "needs_mp3": True,
    },
}


class FFmpegError(RuntimeError):
    pass


def find_ffmpeg() -> str:
    """Prefer an explicit override, then the copy bundled via imageio-ffmpeg, then PATH."""
    env = os.environ.get("CLOUDSNIP_FFMPEG")
    if env:
        return env
    try:
        import imageio_ffmpeg

        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:  # noqa: BLE001 - any failure just means "not bundled"
        pass
    found = shutil.which("ffmpeg")
    if found:
        return found
    raise FFmpegError(
        "ffmpeg was not found. Run CloudSnip through run.py (it installs a bundled copy), "
        "or install ffmpeg and make sure it is on your PATH."
    )


def _last_line(raw: bytes, fallback: str) -> str:
    lines = [ln.strip() for ln in raw.decode("utf-8", "replace").splitlines() if ln.strip()]
    return lines[-1] if lines else fallback


def _peaks_into(out: bytearray, raw: bytes, bucket: int) -> None:
    """Append (peak, rms) byte pairs, one pair per `bucket` samples."""
    samples = array("h")
    samples.frombytes(raw)
    if sys.byteorder == "big":
        samples.byteswap()
    for i in range(0, len(samples), bucket):
        seg = samples[i:i + bucket]
        peak = max(max(seg), -min(seg))
        rms = math.sqrt(sum(map(mul, seg, seg)) / len(seg))
        out.append(min(255, peak >> 7))
        out.append(min(255, int(rms) >> 7))


class FFmpeg:
    def __init__(self, exe: str):
        self.exe = exe
        self.version = self._probe(["-version"]).split("\n", 1)[0].strip()
        self.has_mp3 = "libmp3lame" in self._probe(["-hide_banner", "-encoders"])

    def _probe(self, args: list[str]) -> str:
        try:
            proc = subprocess.run([self.exe, *args], capture_output=True, timeout=30, creationflags=_NO_WINDOW)
        except OSError as exc:
            raise FFmpegError(f"Could not run ffmpeg at {self.exe}: {exc}") from exc
        return proc.stdout.decode("utf-8", "replace")

    def _run(self, args: list[str]) -> None:
        proc = subprocess.run(
            [self.exe, "-hide_banner", "-nostdin", "-v", "error", *args],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            creationflags=_NO_WINDOW,
        )
        if proc.returncode != 0:
            raise FFmpegError(_last_line(proc.stderr, f"ffmpeg exited with code {proc.returncode}"))

    def analyze(self, src: Path, peaks_out: Path) -> float:
        """Write the waveform (peak + rms byte per 1/PEAK_RATE s) and return the exact decoded duration."""
        bucket = _DECODE_RATE // PEAK_RATE
        stride = bucket * 2
        args = [
            self.exe, "-hide_banner", "-nostdin", "-v", "error", "-i", str(src),
            "-map", "0:a:0", "-ac", "1", "-ar", str(_DECODE_RATE), "-f", "s16le", "-acodec", "pcm_s16le", "pipe:1",
        ]
        peaks = bytearray()
        samples = 0
        pending = b""
        with tempfile.TemporaryFile() as err:
            proc = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=err, creationflags=_NO_WINDOW)
            try:
                while True:
                    chunk = proc.stdout.read(stride * 2048)
                    if not chunk:
                        break
                    data = pending + chunk
                    usable = len(data) - len(data) % stride
                    pending = data[usable:]
                    if usable:
                        samples += usable // 2
                        _peaks_into(peaks, data[:usable], bucket)
                even = len(pending) - len(pending) % 2
                if even:
                    samples += even // 2
                    _peaks_into(peaks, pending[:even], bucket)
            finally:
                proc.stdout.close()
                code = proc.wait()
            if code != 0:
                err.seek(0)
                raise FFmpegError(_last_line(err.read(), "Could not decode the downloaded audio"))
        if not samples:
            raise FFmpegError("The downloaded file contains no audio")
        tmp = peaks_out.with_name(peaks_out.name + ".tmp")
        tmp.write_bytes(bytes(peaks))
        os.replace(tmp, peaks_out)
        return samples / _DECODE_RATE

    def make_cover(self, src: Path, dst: Path) -> None:
        """Convert artwork of any format to a JPEG no wider than 1000 px."""
        tmp = dst.with_name(dst.name + ".tmp")
        self._run(["-y", "-i", str(src), "-vf", "scale='min(1000,iw)':-2", "-frames:v", "1", "-q:v", "2",
                   "-f", "image2", "-c:v", "mjpeg", str(tmp)])
        os.replace(tmp, dst)

    def make_preview(self, src: Path, dst: Path) -> None:
        """Lossless FLAC copy for browsers that can't play the original codec."""
        tmp = dst.with_name(dst.name + ".tmp")
        self._run(["-y", "-i", str(src), "-map", "0:a:0", "-c:a", "flac", "-compression_level", "0", "-f", "flac", str(tmp)])
        os.replace(tmp, dst)

    def export(self, src: Path, dst: Path, fmt: str, keeps, duration: float, meta: dict, cover: Path | None = None) -> None:
        """Render `src` to `dst`, keeping only the `keeps` segments, with tags and optional cover art."""
        spec = FORMATS[fmt]
        if spec.get("needs_mp3") and not self.has_mp3:
            raise FFmpegError("This ffmpeg build has no MP3 encoder (libmp3lame)")
        if not keeps:
            raise FFmpegError("Nothing left to export after the cuts")
        use_cover = bool(cover and spec["cover"] and cover.exists())
        args = ["-y", "-i", str(src)]
        if use_cover:
            args += ["-i", str(cover)]

        post = spec.get("post")
        trimmed = len(keeps) > 1 or keeps[0][0] > 0.0005 or keeps[0][1] < duration - 0.0005
        if trimmed:
            parts = []
            n = len(keeps)
            if n > 1:
                parts.append("[0:a:0]asplit=%d%s" % (n, "".join(f"[in{i}]" for i in range(n))))
            for i, (start, end) in enumerate(keeps):
                source = f"[in{i}]" if n > 1 else "[0:a:0]"
                chain = f"{source}atrim=start={start:.6f}:end={end:.6f},asetpts=PTS-STARTPTS"
                fade = min(FADE, (end - start) / 4)
                if start > 0.0005:
                    chain += f",afade=t=in:st=0:d={fade:.6f}"
                if end < duration - 0.0005:
                    chain += f",afade=t=out:st={max(0.0, end - start - fade):.6f}:d={fade:.6f}"
                parts.append(chain + f"[k{i}]")
            label = "[k0]"
            if n > 1:
                parts.append("".join(f"[k{i}]" for i in range(n)) + f"concat=n={n}:v=0:a=1[joined]")
                label = "[joined]"
            if post:
                parts.append(f"{label}{post}[out]")
                label = "[out]"
            args += ["-filter_complex", ";".join(parts), "-map", label]
        else:
            args += ["-map", "0:a:0"]
            if post:
                args += ["-af", post]

        if use_cover:
            args += ["-map", "1:v:0", "-c:v", "copy", "-disposition:v:0", "attached_pic",
                     "-metadata:s:v", "title=Album cover", "-metadata:s:v", "comment=Cover (front)"]
        args += ["-map_metadata", "-1", "-map_chapters", "-1"]
        for key, value in meta.items():
            if value:
                args += ["-metadata", f"{key}={value}"]
        tmp = dst.with_name(dst.name + ".part")
        args += [*spec["args"], str(tmp)]
        try:
            self._run(args)
            os.replace(tmp, dst)
        finally:
            if tmp.exists():
                tmp.unlink()
