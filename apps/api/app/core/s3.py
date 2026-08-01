"""S3 client factory.

Supports both real AWS S3 and an S3-compatible backend (MinIO). Two distinct
clients are needed because a presigned URL is only valid for the host it was
signed against:

- ``get_s3_client()``   — server-side operations (put_object, etc). Signs against
  the *internal* endpoint the API container reaches over the docker network.
- ``get_presign_client()`` — generating URLs handed to a browser. Signs against
  the *public* endpoint the browser can actually resolve.

With no endpoint configured, both return a plain AWS client and behaviour is
unchanged.
"""

from __future__ import annotations

import boto3
from botocore.config import Config

from app.core.config import settings

# MinIO requires path-style addressing (bucket in the path, not the hostname)
# and SigV4. AWS accepts both, so this config is only applied when an explicit
# endpoint is set.
_COMPAT_CONFIG = Config(
    s3={"addressing_style": "path"},
    signature_version="s3v4",
)


def _client(endpoint: str | None):
    kwargs: dict = {"region_name": settings.aws_region}
    if endpoint:
        kwargs["endpoint_url"] = endpoint
        kwargs["config"] = _COMPAT_CONFIG
    return boto3.client("s3", **kwargs)


def get_s3_client():
    """Client for server-side S3 calls, reached over the internal network."""
    return _client(settings.s3_endpoint_url or None)


def get_presign_client():
    """Client for signing URLs handed to a browser.

    Falls back to the internal endpoint, then to AWS, so a partial config still
    produces working URLs in dev.
    """
    return _client(settings.s3_public_endpoint or settings.s3_endpoint_url or None)


def supports_sse() -> bool:
    """Whether the backend accepts ``ServerSideEncryption='AES256'``.

    MinIO rejects SSE-S3 unless it is configured with a KMS, so callers must
    omit the parameter when talking to a custom endpoint.
    """
    return not settings.s3_endpoint_url
