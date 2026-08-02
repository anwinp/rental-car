"""find every account an email owns, so password reset can work generically

Revision ID: 070_reset_targets
Revises: 069_snapshot_extras
Create Date: 2026-08-02

Password reset took the tenant from the REQUEST BODY. That is how the caller
came to choose which workspace's account they were resetting — combined with an
unauthenticated endpoint that returns a tenant_id for any slug, it was a
targeted account-takeover primitive rather than a recovery flow.

Taking the tenant from the host instead fixes the vulnerability but breaks the
general case: someone who forgets their password and lands on the platform host,
or who holds accounts in more than one workspace, has no tenant to derive.

staff_users is under strict tenant_isolation RLS, so an unbound session sees
nothing at all and the lookup cannot be done in application code. This adds a
narrowly-scoped SECURITY DEFINER lookup — the same shape as
resolve_extra_names in 069.

DISCLOSURE: this returns rows across tenants, so it is only safe because of how
it is used. Its results never reach an HTTP response. They are used to address
an email, and that email goes only to the address that was typed in — so the
recipient learns which workspaces THEIR OWN address belongs to and nothing
else. The endpoint's response is byte-identical whether or not any account
exists, so enumeration stays closed.

Deliberately excludes cancelled workspaces and deactivated or soft-deleted
users: a reset link that lands on an account which cannot then sign in is worse
than no link, because it looks like the recovery worked.

Phase: expand
Lock risk: none
Reversible: yes
"""
from __future__ import annotations

from alembic import op

revision: str = '070_reset_targets'
down_revision: str | None = '069_snapshot_extras'
branch_labels = None
depends_on = None


FN = """
CREATE OR REPLACE FUNCTION public.find_password_reset_targets(p_email text)
RETURNS TABLE (
    user_id      uuid,
    tenant_id    uuid,
    slug         text,
    display_name text,
    email        text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $fn$
    SELECT s.user_id,
           s.tenant_id,
           t.slug,
           COALESCE(t.trading_name, t.legal_name, t.slug) AS display_name,
           s.email
      FROM staff_users s
      JOIN tenants t ON t.tenant_id = s.tenant_id
     WHERE lower(s.email) = lower(p_email)
       AND s.is_active
       AND s.deleted_at IS NULL
       AND t.deleted_at IS NULL
       AND t.status NOT IN ('CANCELLED', 'DELETED')
     ORDER BY t.slug;
$fn$;
"""


def upgrade() -> None:
    op.execute(FN)
    op.execute(
        "GRANT EXECUTE ON FUNCTION public.find_password_reset_targets(text) TO app_user"
    )


def downgrade() -> None:
    op.execute("DROP FUNCTION IF EXISTS public.find_password_reset_targets(text)")
