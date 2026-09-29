"""Safe conversion of phone-only image formats before ML inference.

Ultralytics/OpenCV reliably read JPEG/PNG/TIFF files but do not consistently
decode Apple's HEIC/HEIF files.  The browser sends the original file to the
API; HEIC/HEIF pages are decoded once here, EXIF-oriented correctly, and
stored as JPEG so both YOLO and Pillow see the same ordinary image format.
"""

from __future__ import annotations

from io import BytesIO
from pathlib import Path

from PIL import Image, ImageOps, UnidentifiedImageError

try:
    from pillow_heif import register_heif_opener
except ImportError:  # Lets a developer start the app before installing new deps.
    register_heif_opener = None
else:
    # Register once at import time. Embedded HEIF thumbnails are not used by
    # the grading pipeline, so skip decoding them to keep uploads leaner.
    register_heif_opener(thumbnails=False)


HEIF_EXTENSIONS = frozenset({".heic", ".heif"})
SUPPORTED_IMAGE_EXTENSIONS = frozenset({".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff", *HEIF_EXTENSIONS})


class ImageFormatError(ValueError):
    """The uploaded page cannot safely be decoded into an inference image."""


def is_heif_filename(filename: str) -> bool:
    return Path(filename).suffix.lower() in HEIF_EXTENSIONS


def heif_to_jpeg(raw: bytes) -> bytes:
    """Decode a HEIC/HEIF page and return a correctly-oriented JPEG.

    JPEG deliberately has no alpha channel. If a HEIF image contains one,
    flatten it onto white paper instead of silently rendering transparent
    pixels as black, which would confuse handwriting recognition.
    """
    if register_heif_opener is None:
        raise ImageFormatError(
            "HEIC/HEIF support is not installed on this server. Ask the administrator to install pillow-heif."
        )

    try:
        with Image.open(BytesIO(raw)) as source:
            image = ImageOps.exif_transpose(source)
            image.load()
            if "A" in image.getbands():
                background = Image.new("RGB", image.size, "white")
                background.paste(image.convert("RGB"), mask=image.getchannel("A"))
                image = background
            else:
                image = image.convert("RGB")

            output = BytesIO()
            image.save(output, format="JPEG", quality=95, optimize=True)
            return output.getvalue()
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise ImageFormatError("This HEIC/HEIF file could not be decoded. Please choose the original photo again.") from exc
