import io
import unittest
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

from compare_server import app
from photo_compare import compare, read_photo

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

    @staticmethod
    def tiny_image():
        buffer = io.BytesIO()
        Image.new("RGB", (16,16)).save(buffer, "PNG")
        return buffer.getvalue()
