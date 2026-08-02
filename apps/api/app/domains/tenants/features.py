"""Which capabilities a workspace's plan includes.

The vocabulary lives here, in code; which plan has what lives in the database.
That split is deliberate. A free-text feature key stored against a plan is a
typo waiting to silently grant nothing — the console would show a ticked box, no
route would ever match the key, and the customer would be paying for a feature
that is enabled everywhere except in the one place that checks.

So the registry below is the only source of valid keys, the admin surface offers
exactly these, and a key in the database with no entry here is reported rather
than ignored.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass

from fastapi import Depends, HTTPException, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession


@dataclass(frozen=True)
class Feature:
    key: str
    label: str
    # Shown to an operator deciding which tier should include it, and to a
    # tenant being told what they are missing. Written for the second reader.
    blurb: str
    # Whether anything is actually behind the gate.
    #
    # Exists because three capabilities were on the price list while gating
    # nothing at all: corporate_accounts had a router with a health check and
    # no routes, telematics had no code, api_access gated nothing. The gating
    # mechanism worked perfectly, which is exactly why nobody noticed.
    #
    # Declared here, checked two ways: tests/plan_enforcement_lint.py fails the
    # build if this disagrees with whether a route is really gated, and
    # set_plan_features refuses to tick a feature that is not built. A promise
    # that cannot be kept should be impossible to make, not merely discouraged.
    implemented: bool = True
    # How the capability is enforced. "router" means a require_feature gate on
    # a mounted router, which the lint can see. "creation" means the gate is on
    # creating the thing that uses it — the partner API authenticates machines
    # by API key, and require_feature resolves a human, so the check lives on
    # key issuance: no capability, no key, nothing to call the API with.
    gate: str = "router"


FEATURES: tuple[Feature, ...] = (
    Feature("ota_channels", "Channel manager",
            "List vehicles on Expedia, Booking.com and other travel sites."),
    Feature("corporate_accounts", "Corporate accounts",
            "Negotiated rates, billing accounts and booker permissions."),
    Feature("advanced_reporting", "Advanced reporting",
            "Utilisation, revenue and fleet analytics beyond the dashboard."),
    Feature("agent_assistant", "AI assistant",
            "The assistant that answers questions about the business."),
    Feature("telematics", "Telematics",
            "Live vehicle location, mileage and fuel from connected hardware.",
            implemented=False),
    Feature("api_access", "API access",
            "Programmatic access for integrations built in-house.",
            gate="creation"),
)

FEATURE_KEYS: frozenset[str] = frozenset(f.key for f in FEATURES)
# The subset a plan may actually include. Anything else is a roadmap entry.
SELLABLE_KEYS: frozenset[str] = frozenset(f.key for f in FEATURES if f.implemented)


async def features_for_tenant(
    session: AsyncSession, tenant_id: uuid.UUID | str
) -> set[str]:
    """The feature keys this workspace's plan includes.

    A workspace whose plan has no rows gets nothing, which is correct: the
    absence of a grant is the absence of a feature. That is the opposite of how
    the caps behave — a missing plan row there means unlimited — and the
    difference is deliberate. Failing open on a cap inconveniences nobody;
    failing open on a feature gives away the thing being sold.
    """
    rows = (
        await session.execute(
            text(
                "SELECT f.feature_key FROM plan_features f "
                "  JOIN tenants t ON t.subscription_tier = f.plan_code "
                " WHERE t.tenant_id = :t"
            ),
            {"t": str(tenant_id)},
        )
    ).all()
    # Keys the registry no longer knows are dropped rather than returned. A
    # renamed feature must not keep granting access under its old name.
    return {r[0] for r in rows if r[0] in FEATURE_KEYS}


async def assert_feature(
    session: AsyncSession, tenant_id: uuid.UUID | str, key: str
) -> None:
    """Raise 402 if the workspace's plan does not include `key`."""
    if key not in FEATURE_KEYS:
        # A gate naming a feature that does not exist would otherwise fail open
        # in exactly the case it was written to prevent.
        raise RuntimeError(f"Unknown feature key in a gate: {key!r}")

    if key in await features_for_tenant(session, tenant_id):
        return

    feature = next(f for f in FEATURES if f.key == key)
    plan = (
        await session.execute(
            text(
                "SELECT COALESCE(p.display_name, t.subscription_tier) "
                "  FROM tenants t LEFT JOIN plans p ON p.code = t.subscription_tier "
                " WHERE t.tenant_id = :t"
            ),
            {"t": str(tenant_id)},
        )
    ).scalar() or "current"

    raise HTTPException(
        # 402 for the same reason the caps use it: a commercial answer, not a
        # permissions one. A 403 would send an administrator hunting through
        # role assignments for a problem that is not there.
        status_code=status.HTTP_402_PAYMENT_REQUIRED,
        detail=f"{feature.label} is not included in your {plan} plan.",
    )


def require_feature(key: str):
    """Router-level gate: `dependencies=[Depends(require_feature("ota_channels"))]`.

    Applied to a whole router rather than sprinkled through handlers, so the
    gate is visible in the route table during review and a new endpoint added
    to a gated surface is covered the day it is written.
    """
    if key not in FEATURE_KEYS:
        raise RuntimeError(f"Unknown feature key in a gate: {key!r}")

    from app.core.database import get_session
    from app.core.security import UserClaims, get_current_user

    async def _gate(
        session: AsyncSession = Depends(get_session),
        claims: UserClaims = Depends(get_current_user),
    ) -> None:
        await assert_feature(session, claims.tenant_id, key)

    return _gate
