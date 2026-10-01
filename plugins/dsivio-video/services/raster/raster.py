"""Short-lived, local raster executor. Paths are supplied only by the trusted adapter."""
import json
import math
import sys
import cv2
import numpy as np

cv2.setNumThreads(1)
cv2.ocl.setUseOpenCL(False)
INTERPOLATION = {"nearest": cv2.INTER_NEAREST, "linear": cv2.INTER_LINEAR,
                 "cubic": cv2.INTER_CUBIC, "area": cv2.INTER_AREA, "lanczos": cv2.INTER_LANCZOS4}
LUMA = np.array([0.0722, 0.7152, 0.2126], dtype=np.float32)


def fail(code, message):
    raise ValueError(f"{code}: {message}")


def byte(value):
    return np.clip(np.rint(value), 0, 255).astype(np.uint8)


def decode(path):
    image = cv2.imread(path, cv2.IMREAD_UNCHANGED)
    if image is None or image.size == 0:
        fail("RASTER_DECODE_FAILED", f"Cannot decode image {path}")
    if image.dtype != np.uint8:
        fail("RASTER_DECODE_FAILED", "Raster input must have 8-bit channels")
    if image.ndim not in (2, 3) or (image.ndim == 3 and image.shape[2] not in (1, 3, 4)):
        fail("RASTER_DECODE_FAILED", "Unsupported image channel layout")
    return image


def channels(image):
    if image.ndim == 2 or image.shape[2] == 1:
        return cv2.cvtColor(image, cv2.COLOR_GRAY2BGR), None, True
    return image[:, :, :3], image[:, :, 3] if image.shape[2] == 4 else None, False


def combine(rgb, alpha, gray=False):
    if alpha is not None:
        return np.dstack((rgb, alpha))
    return cv2.cvtColor(rgb, cv2.COLOR_BGR2GRAY) if gray else rgb


def bgra(image):
    rgb, alpha, _ = channels(image)
    return np.dstack((rgb, np.full(rgb.shape[:2], 255, np.uint8) if alpha is None else alpha))


def parse_color(value):
    parts = [int(value[i:i+2], 16) for i in range(1, len(value), 2)]
    if len(parts) == 3:
        parts.append(255)
    return np.array([parts[2], parts[1], parts[0], parts[3]], dtype=np.uint8)


def half_up(value):
    return math.floor(value + 0.5)


def fit(image, width, height, mode, interpolation):
    ih, iw = image.shape[:2]
    if mode == "stretch":
        return cv2.resize(image, (width, height), interpolation=INTERPOLATION[interpolation]), 0, 0
    scale = min(width / iw, height / ih) if mode == "contain" else max(width / iw, height / ih)
    rw, rh = max(1, half_up(iw * scale)), max(1, half_up(ih * scale))
    resized = cv2.resize(image, (rw, rh), interpolation=INTERPOLATION[interpolation])
    if mode == "cover":
        x, y = (rw - width) // 2, (rh - height) // 2
        return resized[y:y+height, x:x+width], 0, 0
    return resized, (width-rw)//2, (height-rh)//2


def saturation(rgb, factor):
    luminance = np.sum(rgb * LUMA, axis=2, keepdims=True)
    return luminance + (rgb - luminance) * factor


def flatten(image, background):
    rgb, alpha, gray = channels(image)
    if alpha is None:
        return image
    a = alpha[:, :, None].astype(np.float32) / 255
    return byte(rgb.astype(np.float32) * a + parse_color(background)[:3] * (1-a))


def transform(job):
    image = decode(job["source"])
    encoding = {"format": "png"}
    for step in job["orderedSteps"]:
        kind = step["kind"]
        if kind == "encode":
            encoding = step
            continue
        if kind == "crop":
            h, w = image.shape[:2]
            x, y, cw, ch = [step[key] for key in ("x", "y", "width", "height")]
            if step["unit"] == "fraction":
                x, y, cw, ch = round(x*w), round(y*h), round(cw*w), round(ch*h)
            if cw < 1 or ch < 1 or x < 0 or y < 0 or x+cw > w or y+ch > h:
                fail("RASTER_CROP_RANGE", f"Crop ({x},{y},{cw},{ch}) exceeds current {w}x{h} image")
            image = image[y:y+ch, x:x+cw].copy()
        elif kind == "resize":
            rw, rh = step["width"], step["height"]
            pixels, x, y = fit(image, rw, rh, step["fit"], step["interpolation"])
            if step["fit"] != "contain" or pixels.shape[:2] == (rh, rw):
                image = pixels
            else:
                rgb, alpha, gray = channels(image)
                background = parse_color(step.get("background", "#00000000" if alpha is not None else "#000000"))
                if alpha is not None or ("background" in step and background[3] != 255):
                    canvas = np.empty((rh, rw, 4), np.uint8); canvas[:] = background
                    pixels = bgra(pixels)
                elif gray and background[0] == background[1] == background[2]:
                    canvas = np.full((rh, rw), cv2.cvtColor(background[:3].reshape(1, 1, 3), cv2.COLOR_BGR2GRAY)[0, 0], np.uint8)
                else:
                    canvas = np.empty((rh, rw, 3), np.uint8); canvas[:] = background[:3]
                    if gray:
                        pixels = cv2.cvtColor(pixels, cv2.COLOR_GRAY2BGR)
                canvas[y:y+pixels.shape[0], x:x+pixels.shape[1]] = pixels
                image = canvas
        elif kind == "rotate":
            image = cv2.rotate(image, {90: cv2.ROTATE_90_CLOCKWISE, 180: cv2.ROTATE_180, 270: cv2.ROTATE_90_COUNTERCLOCKWISE}[step["degrees"]])
        elif kind == "flip":
            image = cv2.flip(image, {"horizontal": 1, "vertical": 0, "both": -1}[step["axis"]])
        elif kind == "alpha":
            if step["mode"] == "flatten":
                image = flatten(image, step["background"])
        else:
            rgb, alpha, gray = channels(image)
            original = rgb.astype(np.float32)
            if kind == "denoise":
                if min(image.shape[:2]) < 32:
                    continue
                ycc = cv2.cvtColor(rgb, cv2.COLOR_BGR2YCrCb)
                parts = [cv2.fastNlMeansDenoising(ycc[:, :, i], None, step["luma"] if i == 0 else step["chroma"], step["templateWindow"], step["searchWindow"]) for i in range(3)]
                denoised = cv2.cvtColor(np.dstack(parts), cv2.COLOR_YCrCb2BGR).astype(np.float32)
                result = saturation(denoised, step["saturationRecovery"])
            elif kind == "color":
                result = original * (2 ** step["exposureStops"])
                result = (result - 127.5) * step["contrast"] + 127.5
                result = saturation(result, step["saturation"])
                result += np.array([-32*step["temperature"], 32*step["tint"], 32*step["temperature"]], dtype=np.float32)
                result = np.power(np.clip(result, 0, 255) / 255, 1 / step["gamma"]) * 255
                gray = gray and step["temperature"] == 0 and step["tint"] == 0
            elif kind == "blur":
                result = cv2.GaussianBlur(original, (0, 0), step["sigma"])
            elif kind == "sharpen":
                detail = original - cv2.GaussianBlur(original, (0, 0), step["radius"])
                detail[np.max(np.abs(detail), axis=2) < step["threshold"]] = 0
                result = original + step["amount"] * detail
            else:
                fail("RASTER_INVALID", f"Unknown operation {kind}")
            image = combine(byte(result), alpha, gray)
    fmt = encoding["format"]
    params = []
    if fmt == "jpeg":
        if image.ndim == 3 and image.shape[2] == 4:
            if "background" not in encoding:
                fail("RASTER_JPEG_BACKGROUND", "JPEG with alpha requires explicit background")
            image = flatten(image, encoding["background"])
        params = [cv2.IMWRITE_JPEG_QUALITY, encoding.get("quality", 95)]
    elif fmt == "webp":
        params = [cv2.IMWRITE_WEBP_QUALITY, encoding.get("quality", 95)]
    return image, fmt, params


def compose(job):
    width, height = job["canvasPixels"]
    background = parse_color(job["backdrop"]).astype(np.float64) / 255
    # Store straight color and alpha in floating point across layers; quantize only once.
    canvas = np.empty((height, width, 4), np.float64); canvas[:] = background
    for layer in job["layerStack"]:
        rect = layer["rect"]
        x, y, w, h = [half_up(rect[key]) for key in ("xPx", "yPx", "widthPx", "heightPx")]
        if w < 1 or h < 1:
            fail("RASTER_FRAME_RANGE", "Rounded layer frame must be at least one pixel")
        if x >= width or y >= height or x+w <= 0 or y+h <= 0 or layer["opacity"] == 0:
            continue
        pixels, ox, oy = fit(bgra(decode(layer["source"])), w, h, layer["fit"], layer["interpolation"])
        x += ox; y += oy
        ph, pw = pixels.shape[:2]
        left, top, right, bottom = max(0, x), max(0, y), min(width, x+pw), min(height, y+ph)
        if left >= right or top >= bottom:
            continue
        src = pixels[top-y:bottom-y, left-x:right-x].astype(np.float64) / 255
        dst = canvas[top:bottom, left:right]
        sa = src[:, :, 3:4] * layer["opacity"]
        da = dst[:, :, 3:4]
        out_a = sa + da * (1-sa)
        premul = src[:, :, :3] * sa + dst[:, :, :3] * da * (1-sa)
        dst[:, :, :3] = np.divide(premul, out_a, out=np.zeros_like(premul), where=out_a > 0)
        dst[:, :, 3:4] = out_a
    return byte(canvas*255), "png", []


def main():
    if len(sys.argv) == 2 and sys.argv[1] == "--self-test":
        print(json.dumps({"serviceVersion": "1.0.0", "opencv": cv2.__version__, "numpy": np.__version__, "python": list(sys.version_info[:3])}))
        return
    if len(sys.argv) != 3:
        fail("RASTER_INVALID", "Usage: raster.py request.json output-file")
    with open(sys.argv[1], encoding="utf-8") as stream:
        job = json.load(stream)
    if job["action"] == "edit":
        image, fmt, params = transform(job)
    elif job["action"] == "compose":
        image, fmt, params = compose(job)
    else:
        fail("RASTER_INVALID", "Unknown raster action")
    ok, encoded = cv2.imencode("." + ("jpg" if fmt == "jpeg" else fmt), image, params)
    if not ok:
        fail("RASTER_ENCODE_FAILED", f"Cannot encode {fmt}")
    with open(sys.argv[2], "xb") as stream:
        stream.write(encoded.tobytes())


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"RASTER_FAILED: {error}", file=sys.stderr)
        sys.exit(1)
