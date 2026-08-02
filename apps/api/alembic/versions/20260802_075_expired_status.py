"""a workspace whose term has run out has a state of its own

Revision ID: 075_expired_status
Revises: 074_plans
Create Date: 2026-08-02

tenants.trial_ends_at and tenants.subscription_ends_at were written by the
console and read by nothing. The "Extend trial 14 days" button changed a date
that no code path consulted, so an operator extended a trial, saw a success
message, and had altered nothing. A trial never ended.

Enforcement needs somewhere to put the answer. Computing "is this expired?" at
every request from a date comparison would work, but it would be invisible:
the console would show a workspace as ACTIVE while every request treated it as
dead, and support would be debugging a state that exists only in the middle of
a function. So expiry moves a workspace to a status, once, in a nightly sweep.

EXPIRED is deliberately distinct from SUSPENDED. Suspension is a deliberate act
by an operator; expiry is the clock running out, and the two need different
messages, different recovery paths, and different answers to "what did we do to
this customer". Collapsing them would lose that.

The policy this supports is a hard lockout: staff cannot sign in and the
storefront stops. That makes the recovery path load-bearing — a locked-out
customer cannot reach a billing page from inside the product — so
reactivation_token exists to carry them to checkout from an email link, without
a session. A lockout with no way to pay is not a lockout, it is a cancellation.

Phase: expand
Lock risk: low
Reversible: yes
"""
from __future__ import annotations

from alembic import op

revision: str = '075_expired_status'
down_revision: str | None = '074_plans'
branch_labels = None
depends_on = None

_OLD = ("ACTIVE", "SUSPENDED", "CANCELLED", "TRIAL", "PENDING_VERIFICATION")
_NEW = _OLD + ("EXPIRED",)


def _vals(v: tuple[str, ...]) -> str:
    return ", ".join(f"'{x}'" for x in v)


def upgrade() -> None:
    op.execute("ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_status_check")
    op.execute(
        "ALTER TABLE tenants ADD CONSTRAINT tenants_status_check "
        f"CHECK (status IN ({_vals(_NEW)}))"
    )

    op.execute(
        """
        ALTER TABLE tenants
            -- What the status was before the clock ran out, so reactivation
            -- restores the workspace rather than guessing ACTIVE.
            ADD COLUMN IF NOT EXISTS status_before_expiry text,
            ADD COLUMN IF NOT EXISTS expired_at           timestamptz,
            -- Single-use, carried in the expiry email. The only way back in for
            -- somebody who cannot sign in to reach a payment page.
            ADD COLUMN IF NOT EXISTS reactivation_token   text,
            -- Which warnings have gone out, so the nightly sweep does not send
            -- the 7-day notice seven times.
            ADD COLUMN IF NOT EXISTS expiry_warned_at     timestamptz,
            ADD COLUMN IF NOT EXISTS expiry_warn_stage    integer NOT NULL DEFAULT 0
        """
    )
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS ux_tenants_reactivation_token "
        "ON tenants (reactivation_token) WHERE reactivation_token IS NOT NULL"
    )
    # The sweep runs nightly over every workspace; without this it seq-scans.
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_tenants_term_end "
        "ON tenants (trial_ends_at, subscription_ends_at) "
        "WHERE deleted_at IS NULL AND status IN ('ACTIVE','TRIAL')"
    )


def downgrade() -> None:
    # Nothing may sit on a status the restored constraint forbids.
    op.execute(
        "UPDATE tenants SET status = COALESCE(status_before_expiry, 'SUSPENDED') "
        " WHERE status = 'EXPIRED'"
    )
    op.execute("DROP INDEX IF EXISTS ix_tenants_term_end")
    op.execute("DROP INDEX IF EXISTS ux_tenants_reactivation_token")
    op.execute(
        """
        ALTER TABLE tenants
            DROP COLUMN IF EXISTS status_before_expiry,
            DROP COLUMN IF EXISTS expired_at,
            DROP COLUMN IF EXISTS reactivation_token,
            DROP COLUMN IF EXISTS expiry_warned_at,
            DROP COLUMN IF EXISTS expiry_warn_stage
        """
    )
    op.execute("ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_status_check")
    op.execute(
        "ALTER TABLE tenants ADD CONSTRAINT tenants_status_check "
        f"CHECK (status IN ({_vals(_OLD)}))"
    )
