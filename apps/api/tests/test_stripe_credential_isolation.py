"""Demonstrate the cross-tenant charge bug, and that it is fixed.

The old client set `stripe.api_key` in its constructor. This interleaves two
concurrent requests the way an event loop actually would — resolve tenant A's
credentials, await, resolve tenant B's, await, then have A perform its charge —
and checks which key each request would have transacted with.

Written as a demonstration rather than an assertion of internals because the
claim being made is about money: "tenant A's charge goes out on tenant B's
account" is worth being able to see happen, not just assert about.

Run directly, or under pytest.
"""
from __future__ import annotations

import asyncio
import sys

import stripe

from app.integrations.stripe_merchant import StripeMerchantApi

GREEN, RED, RESET = "\033[32m", "\033[31m", "\033[0m"

KEY_A = "sk_test_TENANT_A"
KEY_B = "sk_test_TENANT_B"


# ── the old shape ────────────────────────────────────────────────────────────

class LegacyClient:
    """What `StripeClient.__init__` used to do."""

    def __init__(self, api_key: str) -> None:
        stripe.api_key = api_key          # process-global

    def key_at_call_time(self) -> str | None:
        return stripe.api_key


async def legacy_request(api_key: str, hold: asyncio.Event) -> str | None:
    client = LegacyClient(api_key)        # credentials resolved
    await hold.wait()                     # ...the request yields, as it must
    return client.key_at_call_time()      # the charge goes out here


# ── the current shape ────────────────────────────────────────────────────────

async def current_request(api_key: str, hold: asyncio.Event) -> str | None:
    api = StripeMerchantApi(api_key=api_key)
    await hold.wait()
    return api._stripe._requestor.api_key   # noqa: SLF001 — the point is the key


# ── the interleaving ─────────────────────────────────────────────────────────

async def interleave(request) -> tuple[str | None, str | None]:
    """Start A, start B, then let both proceed — the ordinary concurrent case."""
    hold = asyncio.Event()
    task_a = asyncio.create_task(request(KEY_A, hold))
    task_b = asyncio.create_task(request(KEY_B, hold))
    await asyncio.sleep(0)                # both have resolved credentials
    hold.set()
    return await task_a, await task_b


async def main() -> int:
    stripe.api_key = None

    legacy_a, legacy_b = await interleave(legacy_request)
    current_a, current_b = await interleave(current_request)

    print("  Two concurrent requests, tenant A and tenant B.\n")
    print(f"  old client   A charges with {legacy_a}   (should be {KEY_A})")
    print(f"               B charges with {legacy_b}   (should be {KEY_B})")
    print(f"  current      A charges with {current_a}   (should be {KEY_A})")
    print(f"               B charges with {current_b}   (should be {KEY_B})\n")

    legacy_leaked = legacy_a != KEY_A
    current_ok = current_a == KEY_A and current_b == KEY_B

    if not legacy_leaked:
        # If the old shape does not leak here, this test is not exercising the
        # bug it claims to, and its passing means nothing.
        print(f"{RED}  INCONCLUSIVE: the legacy shape did not leak — "
              f"this test is not demonstrating anything.{RESET}")
        return 1

    print(f"  old client leaked: tenant A would have charged tenant B's account.")

    if not current_ok:
        print(f"{RED}  FAIL: credentials are still not isolated per request.{RESET}")
        return 1

    print(f"{GREEN}  ok: each request charges its own account.{RESET}")
    return 0


def test_stripe_credentials_are_isolated_per_request():
    assert asyncio.run(main()) == 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
