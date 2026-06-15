"""create audit trigger function and install on 7 tables

Revision ID: 027_audit_trigger
Revises: 026_notification_log
Create Date: 2024-01-01

Phase: expand
Lock risk: medium (CREATE TRIGGER acquires ShareRowExclusiveLock on each table briefly)
Reversible: yes
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision: str = '027_audit_trigger'
down_revision: str | None = '026_notification_log'
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    # Complete SECURITY DEFINER function reading all 5 GUC variables
    op.execute("""
        CREATE OR REPLACE FUNCTION audit.log_changes()
        RETURNS TRIGGER
        LANGUAGE plpgsql
        SECURITY DEFINER
        SET search_path = audit, public
        AS $$
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
            current_setting('app.current_tenant_id', true)::UUID,
            TG_OP::audit_action,
            TG_TABLE_NAME,
            COALESCE(
              (row_to_json(COALESCE(NEW, OLD)) ->> TG_ARGV[0]),
              'unknown'
            ),
            current_setting('app.current_user_id',   true)::UUID,
            current_setting('app.current_role',      true)::user_role,
            current_setting('app.client_ip',         true)::INET,
            current_setting('app.session_id',        true),
            _old_data,
            _new_data,
            _changed,
            current_setting('app.request_id',        true),
            current_setting('app.app_version',       true)
          );

          RETURN COALESCE(NEW, OLD);
        END;
        $$
    """)

    # Install triggers on 7 tables
    op.execute("""
        CREATE TRIGGER audit_reservations
          AFTER INSERT OR UPDATE OR DELETE ON public.reservations
          FOR EACH ROW EXECUTE FUNCTION audit.log_changes('reservation_id')
    """)

    op.execute("""
        CREATE TRIGGER audit_rental_agreements
          AFTER INSERT OR UPDATE OR DELETE ON public.rental_agreements
          FOR EACH ROW EXECUTE FUNCTION audit.log_changes('ra_id')
    """)

    op.execute("""
        CREATE TRIGGER audit_payments
          AFTER INSERT OR UPDATE OR DELETE ON public.payments
          FOR EACH ROW EXECUTE FUNCTION audit.log_changes('payment_id')
    """)

    op.execute("""
        CREATE TRIGGER audit_vehicles
          AFTER INSERT OR UPDATE OR DELETE ON public.vehicles
          FOR EACH ROW EXECUTE FUNCTION audit.log_changes('vehicle_id')
    """)

    op.execute("""
        CREATE TRIGGER audit_damage_claims
          AFTER INSERT OR UPDATE OR DELETE ON public.damage_claims
          FOR EACH ROW EXECUTE FUNCTION audit.log_changes('claim_id')
    """)

    op.execute("""
        CREATE TRIGGER audit_customers
          AFTER INSERT OR UPDATE OR DELETE ON public.customers
          FOR EACH ROW EXECUTE FUNCTION audit.log_changes('customer_id')
    """)

    op.execute("""
        CREATE TRIGGER audit_rate_codes
          AFTER INSERT OR UPDATE OR DELETE ON public.rate_codes
          FOR EACH ROW EXECUTE FUNCTION audit.log_changes('rate_code_id')
    """)


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS audit_rate_codes   ON public.rate_codes")
    op.execute("DROP TRIGGER IF EXISTS audit_customers    ON public.customers")
    op.execute("DROP TRIGGER IF EXISTS audit_damage_claims ON public.damage_claims")
    op.execute("DROP TRIGGER IF EXISTS audit_vehicles     ON public.vehicles")
    op.execute("DROP TRIGGER IF EXISTS audit_payments     ON public.payments")
    op.execute("DROP TRIGGER IF EXISTS audit_rental_agreements ON public.rental_agreements")
    op.execute("DROP TRIGGER IF EXISTS audit_reservations ON public.reservations")
    op.execute("DROP FUNCTION IF EXISTS audit.log_changes()")
