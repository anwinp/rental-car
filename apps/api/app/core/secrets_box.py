"""Encryption for secrets an operator types into the console.

Credentials that arrive through a form have to live somewhere, and a database
column is the wrong place for them in plaintext: database backups travel, get
copied to laptops, and are restored into staging by people who would never be
given production API keys. Encrypting here means a dump of `platform_*` is not
a set of working credentials on its own — the key lives in the process
environment, not in the data.

Design notes worth keeping:

* **AES-256-GCM**, which authenticates as well as encrypts. A tampered
  ciphertext fails to decrypt rather than yielding attacker-chosen plaintext.

* **A fresh 96-bit nonce per encryption.** GCM is catastrophically broken by
  nonce reuse under the same key — two messages sharing a nonce leak their
  XOR and, worse, the authentication key. Never derive one from a counter or
  a timestamp here.

* **The name is authenticated as associated data.** A ciphertext written for
  `stripe_webhook_secret` cannot be moved into the `stripe_secret_key` row and
  decrypted, so a write primitive against one column does not become a way to
  swap credentials between fields.

* **Fail closed.** With no key configured, encrypt() raises rather than storing
  plaintext. A system that silently degrades to storing API keys in the clear
  is worse than one that refuses to store them at all, because nobody finds
  out until the dump leaks.

* **Key rotation** is versioned into the payload (`v1:`), so a second key can
  be introduced later without guessing which rows are which.
"""
from __future__ import annotations

import base64
import os
import secrets

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

_ENV_VAR = "PLATFORM_SECRETS_KEY"
_VERSION = "v1"
_NONCE_BYTES = 12


class SecretsNotConfigured(RuntimeError):
    """Raised when a secret must be stored and no encryption key exists."""


def _key() -> bytes:
    raw = os.getenv(_ENV_VAR, "").strip()
    if not raw:
        raise SecretsNotConfigured(
            f"{_ENV_VAR} is not set, so credentials cannot be stored safely. "
            "Generate one with: python -c \"import base64,os; "
            "print(base64.urlsafe_b64encode(os.urandom(32)).decode())\""
        )
    try:
        key = base64.urlsafe_b64decode(raw)
    except Exception as exc:  # noqa: BLE001
        raise SecretsNotConfigured(f"{_ENV_VAR} is not valid base64.") from exc
    if len(key) != 32:
        raise SecretsNotConfigured(
            f"{_ENV_VAR} must decode to 32 bytes for AES-256; got {len(key)}."
        )
    return key


def is_configured() -> bool:
    """Whether secrets can be stored at all. Used to explain, not to bypass."""
    try:
        _key()
        return True
    except SecretsNotConfigured:
        return False


def encrypt(plaintext: str, *, name: str) -> str:
    """Encrypt a secret. `name` binds the ciphertext to the field it belongs in."""
    if not plaintext:
        raise ValueError("Nothing to encrypt.")
    nonce = secrets.token_bytes(_NONCE_BYTES)
    blob = AESGCM(_key()).encrypt(nonce, plaintext.encode(), name.encode())
    return f"{_VERSION}:{base64.b64encode(nonce + blob).decode()}"


def decrypt(payload: str, *, name: str) -> str:
    """Decrypt a secret written under the same `name`.

    Only ever called server-side, on the path that actually talks to the
    provider. Nothing that decrypts should be within reach of a response body.
    """
    version, _, body = payload.partition(":")
    if version != _VERSION:
        raise ValueError(f"Unknown secret format: {version!r}")
    raw = base64.b64decode(body)
    nonce, blob = raw[:_NONCE_BYTES], raw[_NONCE_BYTES:]
    return AESGCM(_key()).decrypt(nonce, blob, name.encode()).decode()


def hint(plaintext: str) -> str:
    """The most that may ever be shown back: the last four characters.

    Enough for a human to confirm they pasted the right key, useless to anyone
    who did not already have it. Short values are hidden entirely rather than
    partly revealed — four of six characters is not redaction.
    """
    tail = plaintext.strip()
    return f"…{tail[-4:]}" if len(tail) >= 12 else "…"
