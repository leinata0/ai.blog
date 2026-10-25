import importlib.util
from io import BytesIO
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from PIL import Image

SCRIPT = Path(__file__).resolve().parents[1] / "optimize_public_images.py"
SPEC = importlib.util.spec_from_file_location("optimize_public_images", SCRIPT)
optimizer = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(optimizer)


class PublicImageOptimizerTests(unittest.TestCase):
    def test_no_upscale_preserves_alpha_aspect_and_immutable_output(self):
        source = Image.new("RGBA", (800, 400), (170, 100, 20, 0))
        source.putpixel((300, 100), (100, 40, 20, 127))
        payload = BytesIO()
        source.save(payload, "PNG")
        with TemporaryDirectory() as directory:
            output = Path(directory)
            first = optimizer.encode_variants(payload.getvalue(), output)
            second = optimizer.encode_variants(payload.getvalue(), output)
            self.assertEqual(first, second)
            self.assertEqual([item["width"] for item in first["variants"]], [480, 800])
            for item in first["variants"]:
                path = output / Path(item["url"]).name
                with Image.open(path) as decoded:
                    self.assertEqual(decoded.size, (item["width"], item["height"]))
                    self.assertEqual(decoded.mode, "RGBA")
                    self.assertEqual(decoded.getpixel((0, 0))[3], 0)
                self.assertEqual(path.stat().st_size, item["bytes"])
            with Image.open(output / Path(first["variants"][-1]["url"]).name) as decoded:
                self.assertEqual(decoded.getpixel((300, 100))[3], 127)

    def test_exif_orientation_is_applied_before_dimensions_are_recorded(self):
        image = Image.new("RGB", (600, 300), "red")
        exif = Image.Exif()
        exif[274] = 6
        payload = BytesIO()
        image.save(payload, "JPEG", exif=exif)
        with TemporaryDirectory() as directory:
            record = optimizer.encode_variants(payload.getvalue(), Path(directory))
            self.assertEqual((record["width"], record["height"]), (300, 600))
            self.assertEqual(record["variants"][0]["height"], 600)

    def test_url_collection_ignores_untrusted_hosts_and_does_not_guess_paths(self):
        urls = optimizer.collect_cover_urls({"items": [
            {"cover_image": "/uploads/actual.png"},
            {"cover_image": "https://img.563118077.xyz/actual.png"},
            {"cover_image": "https://img.563118077.xyz.attacker.invalid/a.png"},
            {"cover_image": "http://127.0.0.1/private.png"},
        ]})
        self.assertEqual(urls, {"https://www.563118077.xyz/uploads/actual.png", "https://img.563118077.xyz/actual.png"})

    def test_redirect_is_rejected_before_following_an_untrusted_target(self):
        with self.assertRaises(ValueError):
            optimizer.TrustedRedirects().redirect_request(None, None, 302, "Found", {}, "http://127.0.0.1/private.png")

    def test_committed_manifest_contains_only_existing_exact_assets(self):
        root = SCRIPT.parents[1]
        manifest = json.loads((root / "frontend/src/data/image-variants.json").read_text(encoding="utf-8"))
        self.assertEqual(manifest["version"], 1)
        self.assertGreater(len(manifest["images"]), 0)
        for original, record in manifest["images"].items():
            optimizer.canonical_url(original)
            previous_width = 0
            for variant in record["variants"]:
                self.assertGreater(variant["width"], previous_width)
                self.assertLessEqual(variant["width"], record["width"])
                previous_width = variant["width"]
                self.assertTrue(variant["url"].startswith("/performance-images/"))
                path = root / "frontend/public" / variant["url"].lstrip("/")
                self.assertEqual(path.stat().st_size, variant["bytes"])
                with Image.open(path) as image:
                    self.assertEqual(image.format, "WEBP")
                    self.assertEqual(image.size, (variant["width"], variant["height"]))


if __name__ == "__main__":
    unittest.main()
