"""Validating and re-encoding a tenant-uploaded brand image.

A logo is rendered on every anonymous visit to a storefront, unauthenticated,
from a public URL — the widest exposure any tenant-supplied file gets in this
product. Three things this file refuses to trust from the upload:

**The declared content type.** A browser's `Content-Type` header is whatever
the browser decided to send; it is not evidence of what the bytes actually are.
The file is decoded with Pillow and rejected if it will not decode.

**SVG.** Deliberately excluded, not merely unsupported. An SVG can carry
`<script>` and event-handler attributes, and this asset is later loaded on
every anonymous storefront visit and (once the counter reads a theme) inside
the counter app — an SVG logo is a stored-XSS primitive with a very wide blast
radius. Raster only.

**Anything embedded in the file besides pixels.** EXIF GPS tags, ICC profiles,
XMP metadata, PNG ancillary chunks — none of it is needed to show a logo, and
carrying it forward is carrying forward whatever a phone or an old export left
in there. The output is always freshly constructed from decoded pixel data and
saved with nothing extra attached.
"""
from __future__ import annotations

import io

from PIL import Image, UnidentifiedImageError

_MAX_UPLOAD_BYTES = 5 * 1024 * 1024
_MAX_SOURCE_DIMENSION = 4000


class InvalidImage(ValueError):
    """The upload is not a usable image, with a reason worth showing."""


def _load(data: bytes) -> Image.Image:
    if len(data) > _MAX_UPLOAD_BYTES:
        raise InvalidImage("That file is larger than 5 MB.")
    try:
        img = Image.open(io.BytesIO(data))
        img.load()  # forces a full decode; a truncated file raises here
    except (UnidentifiedImageError, OSError) as exc:
        raise InvalidImage("That does not look like an image file.") from exc

    if img.format not in ("PNG", "JPEG", "WEBP"):
        raise InvalidImage(
            f"{img.format or 'This format'} is not supported. Use PNG, JPEG or WebP."
        )
    if img.width > _MAX_SOURCE_DIMENSION or img.height > _MAX_SOURCE_DIMENSION:
        raise InvalidImage("That image is larger than 4000×4000 — resize it first.")
    if img.width < 4 or img.height < 4:
        raise InvalidImage("That image is too small to be a logo.")
    return img


def _clean_copy(img: Image.Image, *, max_dimension: int) -> Image.Image:
    """A fresh image built from decoded pixels — no inherited metadata.

    Building a new Image and pasting pixel data into it, rather than mutating
    the original in place, is what guarantees nothing riding along in the
    source file's chunks survives into the copy.
    """
    mode = "RGBA" if img.mode in ("RGBA", "LA", "P") and _has_alpha(img) else "RGB"
    src = img.convert(mode)
    src.thumbnail((max_dimension, max_dimension), Image.LANCZOS)
    clean = Image.new(mode, src.size)
    clean.paste(src, (0, 0))
    return clean


def _has_alpha(img: Image.Image) -> bool:
    if img.mode in ("RGBA", "LA"):
        return True
    if img.mode == "P":
        return "transparency" in img.info
    return False


def process_logo(data: bytes) -> bytes:
    """Validated, re-encoded, ready to store. Raises InvalidImage otherwise.

    480px is generous for a logo shown at header height on a booking site —
    large enough for retina displays, small enough that a tenant's upload
    cannot itself become the storefront's biggest asset.
    """
    clean = _clean_copy(_load(data), max_dimension=480)
    out = io.BytesIO()
    clean.save(out, format="PNG", optimize=True)
    return out.getvalue()


def process_favicon(data: bytes) -> bytes:
    """Validated, re-encoded, capped to favicon size.

    Not forced square — a tenant's logo is not necessarily square, and cropping
    it to fit a favicon convention would be silently mutilating their mark.
    Browsers render non-square favicons fine; 256px is comfortably above every
    size a browser tab or bookmark actually requests.
    """
    clean = _clean_copy(_load(data), max_dimension=256)
    out = io.BytesIO()
    clean.save(out, format="PNG", optimize=True)
    return out.getvalue()
