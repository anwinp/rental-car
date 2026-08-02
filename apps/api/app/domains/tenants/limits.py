"""Plan limits.

`subscription_tier` was written at signup and read by nothing, so every
workspace was effectively unlimited. This gives the tier meaning.

Deliberate choices:

- **Limits are checked at the point of creation, not on a schedule.** A tenant
  that is already over its limit (because a plan was downgraded) keeps working
  and simply cannot add more. Retroactively disabling data someone is mid-rental
  with would be worse than the overage.
- **NULL means unlimited**, so Enterprise needs no special-casing.
- **A missing plan row also means unlimited.** Failing open is right here: a
  configuration gap should not block a paying customer from adding a vehicle.
  Since migration 074 a foreign key makes the gap nearly impossible, but the
  behaviour stays — the caller is a customer creating a record, not an admin
  screen, and a broken catalogue is our problem, not theirs.

Two of the three caps were dead until 074. max_staff was enforced at three call
sites; max_vehicles and max_locations were defined here, displayed in the admin
UI, and checked nowhere — a Starter workspace could add ten thousand vehicles
against a limit of 25. They are now enforced where vehicles and branches are
created, which is what makes the numbers in the plan editor mean anything.
"""
from __future__ import annotations

import uuid

from fastapi import HTTPException, status
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

# resource -> (limit column, table, human name)
_RESOURCES = {
    "staff": ("max_staff", "staff_users", "team members"),
    "vehicles": ("max_vehicles", "vehicles", "vehicles"),
    "locations": ("max_locations", "locations", "branches"),
}


async def get_usage(session: AsyncSession, tenant_id: uuid.UUID | str) -> dict:
    """Current consumption against the tenant's plan, for the UI."""
    row = (
        await session.execute(
            text(
                """
                SELECT t.subscription_tier,
                       COALESCE(p.display_name, t.subscription_tier) AS plan,
                       p.max_staff, p.max_vehicles, p.max_locations,
                       (SELECT count(*) FROM staff_users
                         WHERE tenant_id = :t AND deleted_at IS NULL)      AS staff,
                       (SELECT count(*) FROM vehicles
                         WHERE tenant_id = :t AND deleted_at IS NULL)      AS vehicles,
                       (SELECT count(*) FROM locations
                         WHERE tenant_id = :t AND deleted_at IS NULL)      AS locations
                FROM tenants t
                LEFT JOIN plans p ON p.code = t.subscription_tier
                WHERE t.tenant_id = :t
                """
            ),
            {"t": str(tenant_id)},
        )
    ).mappings().first()
    return dict(row) if row else {}


async def assert_within_limit(
    session: AsyncSession, tenant_id: uuid.UUID | str, resource: str
) -> None:
    """Raise 402 if adding one more of `resource` would exceed the plan.

    402 Payment Required rather than 403: this is not a permissions problem, it
    is a commercial one, and the distinction matters to whoever reads the log.
    """
    if resource not in _RESOURCES:
        return
    limit_col, table, human = _RESOURCES[resource]

    row = (
        await session.execute(
            text(
                f"""
                SELECT p.{limit_col} AS cap,
                       COALESCE(p.display_name, t.subscription_tier) AS plan,
                       (SELECT count(*) FROM {table}
                         WHERE tenant_id = :t AND deleted_at IS NULL) AS used
                FROM tenants t
                LEFT JOIN plans p ON p.code = t.subscription_tier
                WHERE t.tenant_id = :t
                """  # noqa: S608 — column and table come from the fixed map above
            ),
            {"t": str(tenant_id)},
        )
    ).mappings().first()

    if not row or row["cap"] is None:
        return  # unlimited, or no plan configured — see module docstring

    used = row["used"] or 0
    if resource == "staff":
        # Outstanding invitations hold seats; otherwise a tenant could invite
        # far past its cap and only discover the problem at acceptance.
        pending = (
            await session.execute(
                text(
                    "SELECT count(*) FROM staff_invitations "
                    "WHERE tenant_id = :t AND accepted_at IS NULL "
                    "  AND revoked_at IS NULL AND expires_at > now()"
                ),
                {"t": str(tenant_id)},
            )
        ).scalar() or 0
        used += pending

    if used >= row["cap"]:
        raise HTTPException(
            status_code=status.HTTP_402_PAYMENT_REQUIRED,
            detail=(
                f"Your {row['plan']} plan includes {row['cap']} {human}. "
                f"Upgrade to add more."
            ),
        )
