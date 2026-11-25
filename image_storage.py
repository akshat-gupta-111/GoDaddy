"""Store item photos on Cloudinary. The returned id goes in items.image_id."""

import io
import os
import uuid
from pathlib import Path
from urllib.parse import urlsplit

from dotenv import load_dotenv

# Must run before importing cloudinary, which reads CLOUDINARY_URL on import.
load_dotenv(Path(__file__).resolve().parent / ".env")

import cloudinary  # noqa: E402
import cloudinary.exceptions  # noqa: E402
import cloudinary.uploader  # noqa: E402
import cloudinary.utils  # noqa: E402

FOLDER = "lost_and_found"
MAX_BYTES = 5 * 1024 * 1024
TIMEOUT_SECONDS = 30

# Re-read the environment in case cloudinary was imported before .env was loaded.
cloudinary.reset_config()


class InvalidImage(ValueError):
    """The file is not an acceptable image. Safe to show to the user."""


class StorageError(RuntimeError):
    """Cloudinary is not configured or the request failed.

    After a failed upload, image_id is set: the file may still have been stored,
    so retry with that id or pass it to delete_image().
    """

    image_id = None


def _require_config():
    url = os.environ.get("CLOUDINARY_URL")
    if not url:
        raise StorageError("CLOUDINARY_URL is not set. Add it to .env.")
    # Other CLOUDINARY_* variables override the URL inside the SDK.
    expected = urlsplit(url)
    active = cloudinary.config()
    if (active.cloud_name, active.api_key, active.api_secret) != (
        expected.netloc.rpartition("@")[2],
        expected.username,
        expected.password,
    ):
        raise StorageError(
            "Cloudinary settings differ from CLOUDINARY_URL. "
            "Remove other CLOUDINARY_* variables."
        )


def new_image_id():
    return f"{FOLDER}/{uuid.uuid4().hex}"


def _is_supported(data):
    return (
        data.startswith(b"\xff\xd8\xff")  # JPEG
        or data.startswith(b"\x89PNG\r\n\x1a\n")
        or (data[:4] == b"RIFF" and data[8:12] == b"WEBP")
    )


def upload_image(file, image_id=None):
    """Upload a binary file object (such as request.files["image"]). Return its id.

    Pass image_id only to retry a failed upload without creating a second copy.
    """
    _require_config()
    data = file.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise InvalidImage("Image must be 5 MB or smaller.")
    if not _is_supported(data):
        raise InvalidImage("Image must be a JPEG, PNG or WebP file.")
    image_id = image_id or new_image_id()

    try:
        result = cloudinary.uploader.upload(
            io.BytesIO(data),
            public_id=image_id,
            resource_type="image",
            allowed_formats=["jpg", "png", "webp"],
            # Resizing on upload also drops photo metadata such as GPS location.
            transformation=[{"width": 1600, "height": 1600, "crop": "limit"}],
            timeout=TIMEOUT_SECONDS,
        )
    except cloudinary.exceptions.Error as error:
        if isinstance(error, cloudinary.exceptions.BadRequest) and "invalid image" in str(error).lower():
            raise InvalidImage("The image file is damaged or unreadable.") from error
        failure = StorageError("Image upload failed.")
        failure.image_id = image_id
        raise failure from error
    return result["public_id"]


def image_url(image_id):
    """Return the HTTPS address of an image, or None if there is no image."""
    if not image_id:
        return None
    _require_config()
    url, _ = cloudinary.utils.cloudinary_url(image_id, secure=True)
    return url


def delete_image(image_id):
    """Delete an image and its cached copies. Return True if it was deleted."""
    if not image_id:
        return False
    _require_config()
    try:
        result = cloudinary.uploader.destroy(image_id, invalidate=True, timeout=TIMEOUT_SECONDS)
    except cloudinary.exceptions.Error as error:
        raise StorageError("Image deletion failed.") from error
    return result.get("result") == "ok"
