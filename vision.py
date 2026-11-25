"""Simple image matching: a pretrained CNN (MobileNetV3) for shape and texture,
plus a colour histogram, because ImageNet features largely ignore colour."""

import io
import logging
import math
import os
import threading
from pathlib import Path

import certifi
from PIL import Image, ImageOps

BASE_DIR = Path(__file__).resolve().parent
# Change the version whenever the way features are computed changes.
MODEL_NAME = "mobilenet_v3_large-imagenet+rgb64-v1"
MAX_PIXELS = 40_000_000
# CNN cosine similarity mapped linearly onto 0-1 between these values.
CNN_FLOOR, CNN_CEILING = 0.45, 0.92
CNN_WEIGHT = 0.7

log = logging.getLogger(__name__)
_lock = threading.Lock()
_model = None


class VisionError(RuntimeError):
    """The image or the model could not be processed."""


def _load():
    global _model
    with _lock:
        if _model is None:
            os.environ.setdefault("SSL_CERT_FILE", certifi.where())
            import torch
            from torchvision.models import MobileNet_V3_Large_Weights, mobilenet_v3_large

            torch.hub.set_dir(str(BASE_DIR / "instance" / "models"))
            weights = MobileNet_V3_Large_Weights.IMAGENET1K_V2
            # Downloads about 22 MB once, checked against the hash in its file name.
            network = mobilenet_v3_large(weights=weights)
            network.classifier = torch.nn.Identity()  # keep the 960 image features
            _model = (network.eval(), weights.transforms())
    return _model


def _colour_histogram(image):
    """64-bin colour histogram of the object, ignoring a near-white background."""
    pixels = list(image.resize((96, 96)).getdata())
    foreground = [p for p in pixels if min(p) < 232]
    if len(foreground) < len(pixels) * 0.02:
        foreground = pixels
    bins = [0.0] * 64
    for r, g, b in foreground:
        bins[(r // 64) * 16 + (g // 64) * 4 + b // 64] += 1
    return [v / len(foreground) for v in bins]


def features(data):
    """Return {"cnn": [...], "colour": [...]} for the bytes of one image."""
    try:
        image = Image.open(io.BytesIO(data))
        if image.width * image.height > MAX_PIXELS:
            raise VisionError("Image dimensions are too large.")
        image = ImageOps.exif_transpose(image).convert("RGB")
        image.thumbnail((640, 640))
        network, prepare = _load()
        import torch

        with torch.inference_mode():
            vector = network(prepare(image).unsqueeze(0))[0]
        vector = vector / vector.norm().clamp(min=1e-12)
        return {"cnn": [round(v, 6) for v in vector.tolist()], "colour": _colour_histogram(image)}
    except VisionError:
        raise
    except Exception as error:  # bad file, missing weights, no network on first use
        raise VisionError(f"Could not analyse the image ({type(error).__name__}).") from error


def parts(a, b):
    """Return (CNN cosine, colour overlap), both 0-1 for similar images."""
    cosine = sum(x * y for x, y in zip(a["cnn"], b["cnn"]))
    overlap = sum(math.sqrt(x * y) for x, y in zip(a["colour"], b["colour"]))
    return cosine, overlap


def similarity(a, b):
    """0-100 likeness of two feature sets."""
    cosine, overlap = parts(a, b)
    shape = max(0.0, min(1.0, (cosine - CNN_FLOOR) / (CNN_CEILING - CNN_FLOOR)))
    return round(100 * (CNN_WEIGHT * shape + (1 - CNN_WEIGHT) * max(0.0, min(1.0, overlap))))
