"""Tests for the cut maths, naming helpers and the ffmpeg pipeline.

Run with:  python -m unittest discover -s tests -v
(the ffmpeg tests need the dependencies from requirements.txt)
"""

import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

from cloudsnip.sessions import Manager, normalize_url
from cloudsnip.util import keeps_from_cuts, normalize_cuts, safe_filename


class CutMath(unittest.TestCase):
    def test_sorts_merges_and_clamps(self):
        cuts = normalize_cuts([[50, 60], [10, 20], [19.9998, 25], [-5, 1], [95, 200]], 100)
        self.assertEqual(cuts, [[0.0, 1.0], [10.0, 25.0], [50.0, 60.0], [95.0, 100.0]])

    def test_reversed_and_tiny_ranges(self):
        self.assertEqual(normalize_cuts([[30, 20], [40, 40.0005]], 100), [[20.0, 30.0]])

    def test_snaps_to_edges(self):
        self.assertEqual(normalize_cuts([[0.001, 5], [99.999, 99.9995], [90, 99.9985]], 100), [[0.0, 5.0], [90.0, 100.0]])

    def test_rejects_garbage(self):
        for bad in ("nope", [[1]], [["a", "b"]], [None]):
            with self.assertRaises(ValueError):
                normalize_cuts(bad, 100)

    def test_keeps(self):
        self.assertEqual(keeps_from_cuts([], 100), [(0.0, 100)])
        self.assertEqual(keeps_from_cuts([[0, 10], [50, 60]], 100), [(10, 50), (60, 100)])
        self.assertEqual(keeps_from_cuts([[20, 100]], 100), [(0.0, 20)])


class Naming(unittest.TestCase):
    def test_safe_filename(self):
        self.assertEqual(safe_filename('AC/DC: "Live" <2024>?*'), "AC-DC - 'Live' 2024")
        self.assertEqual(safe_filename("CON"), "_CON")
        self.assertEqual(safe_filename("  ... "), "untitled")
        self.assertEqual(safe_filename("trailing dots..."), "trailing dots")
        self.assertEqual(len(safe_filename("x" * 400)), 150)

    def test_display_name_avoids_repeating_artist(self):
        t = {"artist": "Some Band", "title": "Some Band - Song", "index": 1}
        self.assertEqual(Manager._display_name(t), "Some Band - Song")
        t = {"artist": "Some Band", "title": "Song", "index": 1}
        self.assertEqual(Manager._display_name(t, "{n} - {artist} - {title}", "07"), "07 - Some Band - Song")
        t = {"artist": "", "title": "", "index": 3}
        self.assertEqual(Manager._display_name(t, "{n} - {title}", "03"), "03 - Track 3")

    def test_normalize_url(self):
        self.assertEqual(
            normalize_url(" m.soundcloud.com/artist/sets/name/?si=abc&utm_source=clipboard&utm_medium=text "),
            "https://soundcloud.com/artist/sets/name")
        self.assertEqual(normalize_url("https://soundcloud.com/a/sets/b/s-SECRET"), "https://soundcloud.com/a/sets/b/s-SECRET")
        for bad in ("", "   ", "not a link"):
            with self.assertRaises(ValueError):
                normalize_url(bad)


class FFmpegPipeline(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        try:
            from cloudsnip.audio import FFmpeg, find_ffmpeg
            cls.ff = FFmpeg(find_ffmpeg())
        except Exception as exc:  # noqa: BLE001
            raise unittest.SkipTest(f"ffmpeg unavailable: {exc}")
        cls.tmp = Path(tempfile.mkdtemp(prefix="cloudsnip-test-"))
        cls.src = cls.tmp / "tone.m4a"
        subprocess.run([cls.ff.exe, "-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:duration=10:sample_rate=44100",
                        "-ac", "2", "-c:a", "aac", "-b:a", "192k", str(cls.src)], check=True)
        cls.cover = cls.tmp / "cover.jpg"
        subprocess.run([cls.ff.exe, "-v", "error", "-f", "lavfi", "-i", "color=c=teal:s=64x64", "-frames:v", "1", str(cls.cover)],
                       check=True)

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.tmp, ignore_errors=True)

    def test_analyze(self):
        wave = self.tmp / "tone.wave"
        duration = self.ff.analyze(self.src, wave)
        self.assertAlmostEqual(duration, 10.0, delta=0.05)
        data = wave.read_bytes()
        self.assertAlmostEqual(len(data) / 2, 1000, delta=5)  # 100 (peak, rms) pairs per second
        peak, rms = data[1000], data[1001]  # ffmpeg's sine source is at 1/8 of full scale
        self.assertGreater(peak, 10)
        self.assertAlmostEqual(rms / peak, 0.707, delta=0.1)  # RMS of a sine wave

    def test_export_every_format_with_cuts(self):
        from cloudsnip.audio import FORMATS
        cuts = normalize_cuts([[2, 4], [6, 7]], 10.0)
        keeps = keeps_from_cuts(cuts, 10.0)
        for fmt, spec in FORMATS.items():
            if spec.get("needs_mp3") and not self.ff.has_mp3:
                continue
            with self.subTest(fmt=fmt):
                out = self.tmp / f"out-{fmt}.{spec['ext']}"
                self.ff.export(self.src, out, fmt, keeps, 10.0, {"title": "Tone", "artist": "Test"}, self.cover)
                self.assertTrue(out.is_file())
                self.assertFalse(out.with_name(out.name + ".part").exists())
                duration = self.ff.analyze(out, self.tmp / f"out-{fmt}.wave")
                self.assertAlmostEqual(duration, 7.0, delta=0.06)

    def test_export_without_cuts(self):
        out = self.tmp / "plain.flac"
        self.ff.export(self.src, out, "flac", keeps_from_cuts([], 10.0), 10.0, {}, None)
        self.assertAlmostEqual(self.ff.analyze(out, self.tmp / "plain.wave"), 10.0, delta=0.05)


if __name__ == "__main__":
    unittest.main()
