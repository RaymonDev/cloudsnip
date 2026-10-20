"""Small pure helpers: cut-list maths and safe file names."""

from __future__ import annotations

import math
import re
import unicodedata

# Edges closer than this to the start/end of a track snap onto it.
_SNAP = 0.002
# Gaps smaller than this between two cuts are merged away.
_MERGE = 0.0005

_RESERVED = {"CON", "PRN", "AUX", "NUL", *(f"COM{i}" for i in range(1, 10)), *(f"LPT{i}" for i in range(1, 10))}
_REPLACEMENTS = {"/": "-", "\\": "-", "|": "-", ":": " -", '"': "'", "<": "", ">": "", "?": "", "*": ""}


def normalize_cuts(cuts, duration: float) -> list[list[float]]:
    """Validate a list of [start, end] ranges to remove; return them sorted and merged."""
    if not isinstance(cuts, (list, tuple)):
        raise ValueError("cuts must be a list of [start, end] pairs")
    ranges = []
    for item in cuts:
        try:
            a, b = float(item[0]), float(item[1])
        except (TypeError, ValueError, IndexError):
            raise ValueError("cuts must be a list of [start, end] pairs") from None
        if not (math.isfinite(a) and math.isfinite(b)):
            continue
        a, b = min(a, b), max(a, b)
        a, b = max(0.0, a), min(duration, b)
        if a < _SNAP:
            a = 0.0
        if b > duration - _SNAP:
            b = duration
        if b - a >= 0.001:
            ranges.append([a, b])
    ranges.sort()
    merged: list[list[float]] = []
    for a, b in ranges:
        if merged and a <= merged[-1][1] + _MERGE:
            merged[-1][1] = max(merged[-1][1], b)
        else:
            merged.append([a, b])
    return [[round(a, 4), round(b, 4)] for a, b in merged]


def keeps_from_cuts(cuts, duration: float) -> list[tuple[float, float]]:
    """Invert a normalized cut list into the (start, end) segments that remain."""
    keeps, pos = [], 0.0
    for a, b in cuts:
        if a - pos > _MERGE:
            keeps.append((pos, a))
        pos = max(pos, b)
    if duration - pos > _MERGE:
        keeps.append((pos, duration))
    return keeps


def cut_total(cuts) -> float:
    return sum(b - a for a, b in cuts)


def safe_filename(name: str, fallback: str = "untitled", max_len: int = 150) -> str:
    """Make a string safe to use as a file name on Windows, Linux and macOS."""
    name = unicodedata.normalize("NFC", name or "")
    name = "".join(_REPLACEMENTS.get(ch, ch) for ch in name)
    name = re.sub(r"[\x00-\x1f\x7f]", "", name)
    name = re.sub(r"\s+", " ", name).strip().rstrip(". ")
    if not name:
        name = fallback
    if name.split(".")[0].upper() in _RESERVED:
        name = "_" + name
    if len(name) > max_len:
        name = name[:max_len].rstrip(". ")
    return name
