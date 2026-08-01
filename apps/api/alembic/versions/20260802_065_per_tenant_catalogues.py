"""give every tenant its own catalogue rows instead of sharing global ones

Revision ID: 065_tenant_catalogues
Revises: 064_invite_verify_rls
Create Date: 2026-08-02

Until now four catalogues held rows with tenant_id IS NULL that every tenant
read in common: 12 vehicle classes, 9 extras, 35 notification templates and 1
tax template. Nobody owned them, so nobody could change them — the WITH CHECK
clause correctly refused to let a tenant edit a global row, which meant a
customer could not rename a vehicle class, price their own GPS unit, or put
their own wording in the confirmation email they send.

Shared rows also created a class of isolation bug that does not otherwise
exist. A policy that admits `tenant_id IS NULL` for reading admits it for
DELETE too, because DELETE is filtered by USING — that is how an unscoped
delete once removed all 35 templates for every tenant at once, and how
`UPDATE ... SET tenant_id = me` could move the global vehicle classes into one
workspace. Both were live defects. Neither is expressible once every row has an
owner.

So: each tenant gets its own copy, and the policies become the same plain
`tenant_id = current_tenant` used everywhere else.

The delicate part is that 1,493 live rows already point at the shared class ids
— 1,124 reservations, 238 rate schedule items, 131 vehicles — plus customer
preferences and location tax templates. Copies get new primary keys, so every
one of those references is repointed at its own tenant's copy in the same
transaction. The correlation is by natural key, which each table already has
scoped per tenant:

    vehicle_classes         (tenant_id, sipp_prefix)
    extras_catalog          (tenant_id, code)
    notification_templates  (tenant_id, event_code, channel)
    tax_templates           (tenant_id, name)

The global rows are kept, not deleted. They are the template new tenants are
built from, and under the new policies they are invisible to tenants — only
clone_catalogues_for_tenant() reads them, as SECURITY DEFINER, because
provisioning runs with a tenant bound and would otherwise not see them.

Phase: expand + contract in one — the copy must land before the policies
  tighten, or provisioning breaks between migrations
Lock risk: moderate — updates 1,493 rows across five tables
Reversible: the policy change is; the data copy is not worth undoing, so
  downgrade restores the permissive policies and leaves the per-tenant rows in
  place (harmless: they are simply owned rows that also work under the old
  policy)
"""
from __future__ import annotations

from alembic import op

revision: str = '065_tenant_catalogues'
down_revision: str | None = '064_invite_verify_rls'
branch_labels = None
depends_on = None

_CURRENT = "NULLIF(current_setting('app.current_tenant_id', true), '')::uuid"

SHARED = ("vehicle_classes", "extras_catalog", "notification_templates", "tax_templates")


CLONE_FN = """
CREATE OR REPLACE FUNCTION public.clone_catalogues_for_tenant(p_tenant uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
BEGIN
    -- SECURITY DEFINER because the caller runs with a tenant bound, and under
    -- the tenant-scoped policies the global template rows are not visible to
    -- it. This function is the only thing that may read them.

    INSERT INTO vehicle_classes (class_id, tenant_id, sipp_prefix, name,
                                 description, sort_order, is_active,
                                 created_at, updated_at)
    SELECT gen_random_uuid(), p_tenant, sipp_prefix, name, description,
           sort_order, is_active, now(), now()
      FROM vehicle_classes WHERE tenant_id IS NULL
    ON CONFLICT DO NOTHING;

    INSERT INTO extras_catalog (extra_id, tenant_id, code, name, extra_type,
                                pricing_type, default_price, tax_treatment,
                                is_active, created_at, updated_at)
    SELECT gen_random_uuid(), p_tenant, code, name, extra_type, pricing_type,
           default_price, tax_treatment, is_active, now(), now()
      FROM extras_catalog WHERE tenant_id IS NULL
    ON CONFLICT DO NOTHING;

    INSERT INTO notification_templates (template_id, tenant_id, event_code,
                                        channel, subject, body_html, body_text,
                                        is_active, created_at, updated_at)
    SELECT gen_random_uuid(), p_tenant, event_code, channel, subject,
           body_html, body_text, is_active, now(), now()
      FROM notification_templates WHERE tenant_id IS NULL
    ON CONFLICT DO NOTHING;

    INSERT INTO tax_templates (template_id, tenant_id, name, is_seed,
                               jurisdictions, created_at, updated_at)
    SELECT gen_random_uuid(), p_tenant, name, is_seed, jurisdictions,
           now(), now()
      FROM tax_templates WHERE tenant_id IS NULL
    ON CONFLICT DO NOTHING;
END;
$fn$;
"""

# Repoint every reference from a global row to the caller's own copy, matched
# on the natural key. Runs once per tenant during backfill.
REPOINT_STATEMENTS = [
    """
UPDATE vehicles v
   SET vehicle_class_id = own.class_id
  FROM vehicle_classes glob, vehicle_classes own
 WHERE v.vehicle_class_id = glob.class_id
   AND glob.tenant_id IS NULL
   AND own.tenant_id = v.tenant_id
   AND own.sipp_prefix = glob.sipp_prefix;
    """,
    """
UPDATE rate_schedule_items r
   SET vehicle_class_id = own.class_id
  FROM vehicle_classes glob, vehicle_classes own
 WHERE r.vehicle_class_id = glob.class_id
   AND glob.tenant_id IS NULL
   AND own.tenant_id = r.tenant_id
   AND own.sipp_prefix = glob.sipp_prefix;
    """,
    """
UPDATE reservations res
   SET vehicle_class_id = own.class_id
  FROM vehicle_classes glob, vehicle_classes own
 WHERE res.vehicle_class_id = glob.class_id
   AND glob.tenant_id IS NULL
   AND own.tenant_id = res.tenant_id
   AND own.sipp_prefix = glob.sipp_prefix;
    """,
    """
UPDATE customers c
   SET preferred_class_id = own.class_id
  FROM vehicle_classes glob, vehicle_classes own
 WHERE c.preferred_class_id = glob.class_id
   AND glob.tenant_id IS NULL
   AND own.tenant_id = c.tenant_id
   AND own.sipp_prefix = glob.sipp_prefix;
    """,
    """
UPDATE locations l
   SET tax_template_id = own.template_id
  FROM tax_templates glob, tax_templates own
 WHERE l.tax_template_id = glob.template_id
   AND glob.tenant_id IS NULL
   AND own.tenant_id = l.tenant_id
   AND own.name = glob.name;
    """,
]


def upgrade() -> None:
    op.execute(CLONE_FN)

    # 1. Every existing tenant gets its own copy of all four catalogues.
    op.execute(
        """
        DO $$
        DECLARE t record;
        BEGIN
            FOR t IN SELECT tenant_id FROM tenants WHERE deleted_at IS NULL
            LOOP
                PERFORM public.clone_catalogues_for_tenant(t.tenant_id);
            END LOOP;
        END $$;
        """
    )

    # 2. Repoint every existing reference onto the owning tenant's copy.
    for stmt in REPOINT_STATEMENTS:
        op.execute(stmt)

    # 3. Now that nothing depends on the shared rows, drop the NULL allowance.
    #    These become ordinary tenant-scoped tables.
    for table in SHARED:
        for name in ("tenant_select", "tenant_insert", "tenant_update",
                     "tenant_delete", "tenant_isolation"):
            op.execute(f"DROP POLICY IF EXISTS {name} ON {table}")
        op.execute(
            f"CREATE POLICY tenant_isolation ON {table} "
            f"USING (tenant_id = {_CURRENT}) "
            f"WITH CHECK (tenant_id = {_CURRENT})"
        )


def downgrade() -> None:
    for table in SHARED:
        op.execute(f"DROP POLICY IF EXISTS tenant_isolation ON {table}")
        op.execute(
            f"CREATE POLICY tenant_select ON {table} FOR SELECT "
            f"USING (tenant_id IS NULL OR tenant_id = {_CURRENT})"
        )
        op.execute(
            f"CREATE POLICY tenant_insert ON {table} FOR INSERT "
            f"WITH CHECK (tenant_id = {_CURRENT})"
        )
        op.execute(
            f"CREATE POLICY tenant_update ON {table} FOR UPDATE "
            f"USING (tenant_id = {_CURRENT}) WITH CHECK (tenant_id = {_CURRENT})"
        )
        op.execute(
            f"CREATE POLICY tenant_delete ON {table} FOR DELETE "
            f"USING (tenant_id = {_CURRENT})"
        )
    op.execute("DROP FUNCTION IF EXISTS public.clone_catalogues_for_tenant(uuid)")
