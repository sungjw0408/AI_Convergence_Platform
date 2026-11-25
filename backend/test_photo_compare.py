import io
import unittest
from pathlib import Path
from unittest.mock import patch

import cv2
import numpy as np
from PIL import Image

from compare_server import app, inference_lock
from photo_compare import compare, read_photo
from photo_evaluation import fixtures, target_hit

ASSETS = Path(__file__).resolve().parents[1] / "frontend" / "assets"


def sample(name):
    with (ASSETS / name).open("rb") as source:
        return read_photo(source)


class ComparisonTests(unittest.TestCase):
    def test_uploaded_pair_highlights_projector_side(self):
        with (ASSETS / "proof-before.webp").open("rb") as a, (ASSETS / "proof-after.webp").open("rb") as b:
            response = app.test_client().post("/api/photo-comparison", data={"before": a, "after": b})
        self.assertEqual(response.status_code, 200)
        result = response.get_json()
        self.assertEqual(result["status"], "changes")
        self.assertTrue(any(x <= 0.80 <= x+w and y <= 0.62 <= y+h for x,y,w,h in result["regions"]))

    def test_different_item_requests_retake(self):
        result = compare(sample("proof-before.webp"), sample("drill.webp"))
        self.assertEqual(result["status"], "retake")

    def test_identical_shifted_and_lightly_dimmed(self):
        a = sample("proof-before.webp")
        shifted = cv2.warpAffine(a, np.float32([[1,0,9],[0,1,-6]]), (a.shape[1],a.shape[0]), borderMode=cv2.BORDER_REFLECT)
        dimmed = np.clip(a.astype(float)*0.92+16,0,255).astype(np.uint8)
        for photo in (a, shifted, dimmed):
            self.assertEqual(compare(a, photo)["status"], "clear")

    def test_new_mark_on_another_item(self):
        a = sample("drill.webp")
        h, w = a.shape[:2]
        b = a.copy()
        cv2.line(b,(int(w*.42),int(h*.45)),(int(w*.53),int(h*.54)),(235,15,30),4)
        result = compare(a,b)
        self.assertTrue(any(x <= 0.48 <= x+rw and y <= 0.50 <= y+rh for x,y,rw,rh in result["regions"]))

    def test_invalid_file_and_missing_pair(self):
        client = app.test_client()
        self.assertEqual(client.post("/api/photo-comparison").status_code, 400)
        for content in (b"invalid", self.tiny_image()):
            with (ASSETS / "proof-before.webp").open("rb") as photo:
                response = client.post("/api/photo-comparison", data={"before": photo, "after": (io.BytesIO(content), "x.png")})
                self.assertEqual(response.status_code, 422)

    def test_bad_quality_stops_before_model(self):
        a = sample("proof-before.webp")
        for key, _, before, after, *_ in fixtures():
            if key not in {"blur", "dark", "bright"}:
                continue
            with self.subTest(key=key), patch("photo_compare.load_model") as model:
                result = compare(before, after)
                self.assertEqual(result["status"], "retake")
                self.assertEqual(result["reason"], key)
                self.assertEqual(result["failedPhoto"], "after")
                self.assertEqual(result["stages"], [{"name": "quality", "status": "blocked"}])
                model.assert_not_called()
        result = compare(np.zeros_like(a), a)
        self.assertEqual(result["failedPhoto"], "before")

    def test_isolated_comparison_skips_registration(self):
        a = sample("proof-before.webp")
        with patch("photo_compare.align") as alignment:
            result = compare(a, a, model_only=True)
            self.assertEqual(result["status"], "clear")
            self.assertEqual(result["stages"][1]["status"], "skipped")
            alignment.assert_not_called()
        self.assertEqual(compare(a, a[:-1], model_only=True)["reason"], "size")

    def test_evaluation_rejects_busy_and_releases_lock_on_error(self):
        client = app.test_client()
        with inference_lock:
            self.assertEqual(client.post("/api/photo-evaluation").status_code, 409)
        with patch("compare_server.run_evaluation", side_effect=ValueError("test")):
            self.assertEqual(client.post("/api/photo-evaluation").status_code, 500)
        self.assertFalse(inference_lock.locked())

    def test_evaluation_target_hit_uses_target_position(self):
        self.assertTrue(target_hit({"regions": [[.3, .3, .2, .2]]}, [.4, .4]))
        self.assertFalse(target_hit({"regions": [[.3, .3, .2, .2]]}, [.8, .8]))

    def test_unsupported_method_is_rejected(self):
        with (ASSETS / "proof-before.webp").open("rb") as a, (ASSETS / "proof-after.webp").open("rb") as b:
            result = app.test_client().post("/api/photo-comparison", data={"before": a, "after": b, "method": "unknown"})
        self.assertEqual(result.status_code, 400)

    @staticmethod
    def tiny_image():
        buffer = io.BytesIO()
        Image.new("RGB", (16,16)).save(buffer, "PNG")
        return buffer.getvalue()
