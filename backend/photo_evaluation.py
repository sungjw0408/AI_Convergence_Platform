"""Small, reproducible smoke set. This is NOT an independent accuracy benchmark."""
from io import BytesIO
from pathlib import Path
import base64
from datetime import datetime, timezone

import cv2
import numpy as np
from PIL import Image

from photo_compare import compare, read_photo

ASSETS = Path(__file__).resolve().parents[1] / "frontend" / "assets"


def sample(name):
    with (ASSETS / name).open("rb") as stream:
        return read_photo(stream)


def preview(photo):
    image = Image.fromarray(photo)
    image.thumbnail((320, 320))
    buffer = BytesIO()
    image.save(buffer, "JPEG", quality=85)
    return "data:image/jpeg;base64," + base64.b64encode(buffer.getvalue()).decode()


def fixtures():
    a, drill = sample("proof-before.webp"), sample("drill.webp")
    h, w = a.shape[:2]
    mark = drill.copy()
    dh, dw = drill.shape[:2]
    cv2.line(mark, (int(dw*.42), int(dh*.45)), (int(dw*.53), int(dh*.54)), (235, 15, 30), 4)
    return [
        ("same", "동일 사진", a, a, "clear", None, True),
        ("demo", "기존 빔프로젝터 시연 사진", a, sample("proof-after.webp"), "changes", [.80, .62], True),
        ("mark", "드릴에 합성한 색상 자국", drill, mark, "changes", [.48, .50], True),
        ("shift", "손상 없음 · 위치만 이동", a, cv2.warpAffine(a, np.float32([[1, 0, 9], [0, 1, -6]]), (w, h), borderMode=cv2.BORDER_REFLECT), "clear", None, False),
        ("light", "손상 없음 · 약한 밝기 변화", a, np.clip(a.astype(float)*.92+16, 0, 255).astype(np.uint8), "clear", None, False),
        ("blur", "심한 흐림", a, cv2.GaussianBlur(a, (45, 45), 12), "retake", None, False),
        ("dark", "심한 노출 부족", a, (a.astype(float)*.025).astype(np.uint8), "retake", None, False),
        ("bright", "심한 과다 노출", a, np.clip(a.astype(float)*.025+248, 0, 255).astype(np.uint8), "retake", None, False),
        ("other", "서로 다른 물품", a, drill, "retake", None, False),
    ]


def target_hit(result, target):
    return any(x <= target[0] <= x+w and y <= target[1] <= y+h for x, y, w, h in result["regions"])


def run_evaluation():
    cases = []
    for key, name, before, after, expected, target, aligned in fixtures():
        model = compare(before, after)
        pixel = compare(before, after, method="pixel")
        isolated = compare(before, after, model_only=True) if aligned else None
        for result in (model, pixel, isolated):
            if result is not None:
                result["targetHit"] = target_hit(result, target) if target else None
                result["passed"] = result["status"] == expected and (not target or result["targetHit"])
        cases.append({"id": key, "name": name, "before": preview(before), "after": preview(after),
                      "expected": expected, "target": target, "model": model, "pixel": pixel, "isolated": isolated})
    return {"generatedAt": datetime.now(timezone.utc).isoformat(), "cases": cases,
            "dataset": "기존 시연 사진 + 인공 변형 9건. 개발 중 확인한 자료로 독립 성능평가가 아닙니다.",
            "limitations": "합성 색상 자국은 실제 균열·찍힘과 다릅니다. 같은 물품의 다른 면, 가림, 반사, 곡면, 실제 손상 사진은 별도 검증이 필요합니다."}
