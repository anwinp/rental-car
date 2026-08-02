"""stop an empty session variable from breaking every audited write

Revision ID: 080_audit_nullif
Revises: 079_signup_plan
Create Date: 2026-08-02

audit.log_changes read five session variables and cast four of them with a bare
::UUID, ::user_role and ::INET. An unset variable reads as NULL and casts
cleanly; an EMPTY STRING does not — `SELECT ''::uuid` is an error.

That error is raised inside a trigger, so it takes the whole statement with it.
Any INSERT, UPDATE or DELETE on customers, damage_claims, payments, rate_codes,
rental_agreements, reservations or vehicles fails outright whenever
app.current_tenant_id happens to be '' rather than unset.

Which is not hypothetical. The purge endpoint deliberately sets that variable to
'' — it has to, because `tenants` is under RLS and an empty setting is the only
state in which the estate is visible. Purging any workspace that had reached
the audited tables therefore died on the first one holding rows, and had done
since the trigger was written. It was found only because a probe workspace
created today happened to have default rate codes provisioned into it.

The reason this had lain quiet is that '' and NULL are the same thing to every
other reader in the system: the RLS policies all use
NULLIF(current_setting(...), '')::uuid, precisely so the two are
interchangeable. Only the audit trigger disagreed, and only on the write path.

NULLIF everywhere, so absent means absent however it was expressed. The
alternative — auditing every caller to make sure none ever writes an empty
string — is the kind of invariant that holds until somebody adds a caller.

Phase: contract — replaces a function in place. No table is touched, and the
old and new definitions accept exactly the same inputs; the new one simply
stops raising on one of them.
Lock risk: none
Reversible: yes, though downgrading restores a function that crashes on ''
"""
from __future__ import annotations

from alembic import op

revision: str = '080_audit_nullif'
down_revision: str | None = '079_signup_plan'
branch_labels = None
depends_on = None


_BODY = """
        DECLARE
          _old_data  JSONB;
          _new_data  JSONB;
          _changed   TEXT[];
        BEGIN
          IF TG_OP = 'INSERT' THEN
            _new_data := row_to_json(NEW)::JSONB;
            _old_data := NULL;
            _changed  := ARRAY(SELECT jsonb_object_keys(_new_data));

          ELSIF TG_OP = 'UPDATE' THEN
            _old_data := row_to_json(OLD)::JSONB;
            _new_data := row_to_json(NEW)::JSONB;
            SELECT array_agg(k)
              INTO _changed
              FROM jsonb_object_keys(_new_data) AS k
             WHERE _new_data->k IS DISTINCT FROM _old_data->k;

          ELSIF TG_OP = 'DELETE' THEN
            _old_data := row_to_json(OLD)::JSONB;
            _new_data := NULL;
            _changed  := NULL;
          END IF;

          INSERT INTO audit.audit_events (
            tenant_id,
            action,
            resource_type,
            resource_id,
            actor_user_id,
            actor_role,
            actor_ip,
            actor_session,
            old_data,
            new_data,
            changed_fields,
            request_id,
            app_version
          ) VALUES (
            %(tenant)s,
            TG_OP::audit_action,
            TG_TABLE_NAME,
            COALESCE(
              (row_to_json(COALESCE(NEW, OLD)) ->> TG_ARGV[0]),
              'unknown'
            ),
            %(user)s,
            %(role)s,
            %(ip)s,
            current_setting('app.session_id',        true),
            _old_data,
            _new_data,
            _changed,
            current_setting('app.request_id',        true),
            current_setting('app.app_version',       true)
          );

          RETURN COALESCE(NEW, OLD);
        END;
"""

_SAFE = {
    "tenant": "NULLIF(current_setting('app.current_tenant_id', true), '')::UUID",
    "user": "NULLIF(current_setting('app.current_user_id',   true), '')::UUID",
    "role": "NULLIF(current_setting('app.current_role',      true), '')::user_role",
    "ip": "NULLIF(current_setting('app.client_ip',         true), '')::INET",
}
_RAW = {
    "tenant": "current_setting('app.current_tenant_id', true)::UUID",
    "user": "current_setting('app.current_user_id',   true)::UUID",
    "role": "current_setting('app.current_role',      true)::user_role",
    "ip": "current_setting('app.client_ip',         true)::INET",
}


def _fn(casts: dict) -> str:
    return (
        "CREATE OR REPLACE FUNCTION audit.log_changes() RETURNS trigger "
        "LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'audit', 'public' "
        "AS $fn$" + (_BODY % casts) + "$fn$"
    )


def upgrade() -> None:
    op.execute(_fn(_SAFE))


def downgrade() -> None:
    op.execute(_fn(_RAW))
