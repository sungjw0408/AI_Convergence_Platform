"""Local image-pair inspection. All region coordinates refer to the return photo."""
from functools import lru_cache
from pathlib import Path
from time import perf_counter

import cv2
import lpips
import numpy as np
from PIL import Image, ImageOps, UnidentifiedImageError
import torch

MODEL = "LPIPS v0.1 · SqueezeNet"
torch.hub.set_dir(str(Path(__file__).resolve().parent / ".model-cache"))
torch.set_num_threads(min(4, torch.get_num_threads()))


@lru_cache(maxsize=1)
def load_model():
    return lpips.LPIPS(net="squeeze", version="0.1", spatial=True, verbose=False).eval()


def read_photo(stream):
    try:
        with Image.open(stream) as image:
            if image.format not in {"JPEG", "PNG", "WEBP"}:
                raise ValueError("JPG, PNG 또는 WebP 사진을 선택해 주세요.")
            if image.width * image.height > 20_000_000 or min(image.size) < 96:
                raise ValueError("짧은 변이 96픽셀 이상인 2천만 화소 이하 사진을 선택해 주세요.")
            image.thumbnail((704, 704), Image.Resampling.LANCZOS)
            if min(image.size) < 64:
                raise ValueError("가로세로 비율이 너무 커요. 물품을 중심으로 사진을 잘라 주세요.")
            return np.array(ImageOps.exif_transpose(image).convert("RGB"))
    except (UnidentifiedImageError, OSError, Image.DecompressionBombError) as error:
        raise ValueError("사진을 읽을 수 없어요. 파일 형식을 확인해 주세요.") from error


def align(before, after):
    height, width = after.shape[:2]
    if np.array_equal(before, after):
        return before, np.ones((height, width), dtype=bool)
    detector = cv2.SIFT_create(nfeatures=1800)
    points_a, features_a = detector.detectAndCompute(cv2.cvtColor(before, cv2.COLOR_RGB2GRAY), None)
    points_b, features_b = detector.detectAndCompute(cv2.cvtColor(after, cv2.COLOR_RGB2GRAY), None)
    if features_a is None or features_b is None or len(features_b) < 2:
        return None
    pairs = cv2.BFMatcher().knnMatch(features_a, features_b, k=2)
    matches = [pair[0] for pair in pairs if len(pair) == 2 and pair[0].distance < 0.74 * pair[1].distance]
    if len(matches) < 10:
        return None
    src = np.float32([points_a[m.queryIdx].pt for m in matches])
    dst = np.float32([points_b[m.trainIdx].pt for m in matches])
    matrix, inliers = cv2.estimateAffinePartial2D(src, dst, method=cv2.RANSAC, ransacReprojThreshold=3)
    if matrix is None or inliers.sum() < 10 or inliers.mean() < 0.45:
        return None
    matched_area = cv2.contourArea(cv2.convexHull(dst[inliers.ravel().astype(bool)]))
    if matched_area < width * height * 0.04:
        return None
    valid = cv2.warpAffine(np.ones(before.shape[:2], np.uint8), matrix, (width, height))
    valid = cv2.erode(valid, np.ones((17, 17), np.uint8), borderType=cv2.BORDER_CONSTANT, borderValue=0)
    if valid.mean() < 0.65:
        return None
    warped = cv2.warpAffine(before, matrix, (width, height))
    valid = valid.astype(bool)
    warped[~valid] = after[~valid]
    return warped, valid


def to_tensor(rgb):
    return torch.from_numpy(rgb).permute(2, 0, 1).unsqueeze(0).float().div(127.5).sub(1)


def quality(photo):
    """Conservative, scene-dependent screening; not proof of visibility or focus."""
    gray = cv2.cvtColor(photo, cv2.COLOR_RGB2GRAY)
    # Ignore the outside border when computing these rough frame-level metrics.
    h, w = gray.shape
    center = gray[h//10:h-h//10, w//10:w-w//10]
    sharpness = float(cv2.Laplacian(center, cv2.CV_64F).var())
    dark = float((center < 18).mean())
    bright = float((center > 242).mean())
    reason = "dark" if dark > 0.85 else "bright" if bright > 0.85 else "blur" if sharpness < 12 else "ok"
    return {"sharpness": round(sharpness, 2), "darkFraction": round(dark, 3),
            "brightFraction": round(bright, 3), "reason": reason}


def pixel_regions(reference, after, valid):
    """Simple registered pixel-difference baseline, using the same exposure correction."""
    distance = np.max(cv2.absdiff(reference, after), axis=2)
    mask = np.uint8((distance > 35) & valid)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    h, w = mask.shape
    _, _, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    return [[int(x)/w, int(y)/h, int(rw)/w, int(rh)/h]
            for x, y, rw, rh, area in sorted(stats[1:], key=lambda row: row[4], reverse=True)
            if area >= max(24, h*w*0.0003)][:6]


@torch.inference_mode()
def compare(before, after, method="lpips", model_only=False):
    started = perf_counter()
    result = {"model": MODEL if method == "lpips" else "OpenCV · 픽셀 차이", "status": "retake", "regions": [],
              "stages": [], "mode": "model-only" if model_only else "pipeline"}
    def finish(reason=None):
        result["reason"] = reason
        result["durationMs"] = round((perf_counter() - started) * 1000)
        return result

    if model_only:
        if before.shape != after.shape:
            return finish("size")
        reference, valid = before, np.ones(after.shape[:2], dtype=bool)
        result["stages"].append({"name": "quality", "status": "skipped"})
        result["stages"].append({"name": "alignment", "status": "skipped"})
    else:
        checks = {"before": quality(before), "after": quality(after)}
        result["quality"] = checks
        failed = next((key for key, check in checks.items() if check["reason"] != "ok"), None)
        result["stages"].append({"name": "quality", "status": "blocked" if failed else "passed"})
        if failed:
            result["failedPhoto"] = failed
            return finish(checks[failed]["reason"])
        aligned = align(before, after)
        result["stages"].append({"name": "alignment", "status": "passed" if aligned else "blocked"})
        if aligned is None:
            return finish("alignment")
        reference, valid = aligned
    # Match modest global exposure changes before scoring local appearance.
    lo_a, hi_a = np.percentile(cv2.cvtColor(reference, cv2.COLOR_RGB2GRAY)[valid], (10, 90))
    lo_b, hi_b = np.percentile(cv2.cvtColor(after, cv2.COLOR_RGB2GRAY)[valid], (10, 90))
    gain = np.clip((hi_b - lo_b) / max(1, hi_a - lo_a), 0.8, 1.25) if hi_a > lo_a and not model_only else 1
    offset = np.clip(lo_b - gain * lo_a, -30, 30) if not model_only else 0
    reference = np.rint(np.clip(reference.astype(np.float32) * gain + offset, 0, 255)).astype(np.uint8)
    reference[~valid] = after[~valid]
    if method == "pixel":
        result["regions"] = pixel_regions(reference, after, valid)
        result["status"] = "changes" if result["regions"] else "clear"
        result["stages"].append({"name": "comparison", "status": "passed"})
        return finish()
    distance = load_model()(to_tensor(reference), to_tensor(after))[0, 0].numpy()
    # LPIPS is a distance, not a probability. Suppress near-uniform drift and
    # require a local contrast above the background level in this particular pair.
    values = distance[valid]
    median = np.median(values)
    if median > 0.15:
        result["stages"].append({"name": "comparison", "status": "blocked"})
        return finish("appearance")
    cutoff = max(0.10, median + 6 * np.median(np.abs(values - median)))
    change = np.uint8((distance > cutoff) & valid)
    if change.sum() > 0.35 * valid.sum():
        result["stages"].append({"name": "comparison", "status": "blocked"})
        return finish("appearance")
    height, width = distance.shape
    _, labels, stats, _ = cv2.connectedComponentsWithStats(change, connectivity=8)
    regions = []
    for label, (x, y, w, h, area) in enumerate(stats[1:], start=1):
        if area < max(24, height * width * 0.0003):
            continue
        peak = float(distance[labels == label].max())
        if peak < 0.16:
            continue
        regions.append((peak, [int(x)/width, int(y)/height, int(w)/width, int(h)/height]))
    regions.sort(key=lambda pair: pair[0], reverse=True)
    boxes = [box for _, box in regions[:6]]
    result.update(status="changes" if boxes else "clear", regions=boxes)
    result["stages"].append({"name": "comparison", "status": "passed"})
    return finish()
