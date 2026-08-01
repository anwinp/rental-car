"""RLS on the tenants registry

Revision ID: 062_tenants_rls
Revises: 061_token_epoch
Create Date: 2026-08-01

`tenants` was the last table carrying a tenant identifier with no policy on it,
and app_user holds full DML. A signed-in tenant could therefore read every other
workspace's registry row — legal name, contact email, subscription tier, status
— and, worse, rewrite its own: `UPDATE tenants SET subscription_tier='ENTERPRISE'`
lifts every plan limit, and `SET status='ACTIVE'` reactivates a workspace
suspended for non-payment.

The complication is that this table is read before any tenant context exists.
Four separate flows depend on that:

  - slug -> tenant_id resolution, which runs before a session is established
  - registration, which INSERTs the row that the context would refer to
  - email verification, which activates a tenant on a token alone
  - login's tenant-standing check, which happens before credentials

So a flat `tenant_id = current_tenant` policy would break sign-in for everyone
and registration entirely. The policy below instead says: when no tenant is
bound, permit (those are the pre-session flows above); when one is bound, permit
only that tenant's own row.

What this does and does not buy:

  - It DOES stop an authenticated request from reading or altering another
    workspace's registry row, which is the reachable attack — every request that
    carries a session has a tenant bound by the time it touches this table.
  - It does NOT protect the unbound paths themselves. Those are guarded by what
    they are: parameterised lookups by slug or token, not arbitrary queries. An
    injection flaw on one of them would still see the whole table.

The platform console lists the estate and so must run unbound; list_tenants now
clears the GUC first, matching what its create and delete paths already do.

Phase: contract
Lock risk: low
Reversible: yes
"""
from __future__ import annotations

from alembic import op

revision: str = '062_tenants_rls'
down_revision: str | None = '061_token_epoch'
branch_labels = None
depends_on = None

_CURRENT = "NULLIF(current_setting('app.current_tenant_id', true), '')::uuid"
# True when no tenant has been adopted on this connection.
_UNBOUND = f"({_CURRENT} IS NULL)"


def upgrade() -> None:
    op.execute("ALTER TABLE tenants ENABLE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE tenants FORCE ROW LEVEL SECURITY")
    op.execute("DROP POLICY IF EXISTS tenant_self ON tenants")

    op.execute(
        f"CREATE POLICY tenant_self ON tenants "
        f"USING ({_UNBOUND} OR tenant_id = {_CURRENT}) "
        f"WITH CHECK ({_UNBOUND} OR tenant_id = {_CURRENT})"
    )


def downgrade() -> None:
    op.execute("DROP POLICY IF EXISTS tenant_self ON tenants")
    op.execute("ALTER TABLE tenants NO FORCE ROW LEVEL SECURITY")
    op.execute("ALTER TABLE tenants DISABLE ROW LEVEL SECURITY")
