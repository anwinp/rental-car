"""create archive schema mirror tables

Revision ID: 028_archive_tables
Revises: 027_audit_trigger
Create Date: 2024-01-01

Phase: expand
Lock risk: low (new tables in archive schema)
Reversible: yes
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision: str = '028_archive_tables'
down_revision: str | None = '027_audit_trigger'
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE archive.rental_agreements (LIKE public.rental_agreements INCLUDING ALL)
    """)
    op.execute("""
        ALTER TABLE archive.rental_agreements ADD COLUMN archived_at TIMESTAMPTZ NOT NULL DEFAULT now()
    """)

    op.execute("""
        CREATE TABLE archive.reservations (LIKE public.reservations INCLUDING ALL)
    """)
    op.execute("""
        ALTER TABLE archive.reservations ADD COLUMN archived_at TIMESTAMPTZ NOT NULL DEFAULT now()
    """)

    op.execute("""
        CREATE TABLE archive.payments (LIKE public.payments INCLUDING ALL)
    """)
    op.execute("""
        ALTER TABLE archive.payments ADD COLUMN archived_at TIMESTAMPTZ NOT NULL DEFAULT now()
    """)

    op.execute("""
        CREATE TABLE archive.damage_claims (LIKE public.damage_claims INCLUDING ALL)
    """)
    op.execute("""
        ALTER TABLE archive.damage_claims ADD COLUMN archived_at TIMESTAMPTZ NOT NULL DEFAULT now()
    """)

    op.execute("""
        CREATE TABLE archive.customers (LIKE public.customers INCLUDING ALL)
    """)
    op.execute("""
        ALTER TABLE archive.customers ADD COLUMN archived_at TIMESTAMPTZ NOT NULL DEFAULT now()
    """)

    # S3 object registry for Glacier-archived records
    op.execute("""
        CREATE TABLE archive.object_registry (
          registry_id   UUID        PRIMARY KEY DEFAULT uuid_generate_v4(),
          source_table  TEXT        NOT NULL,
          source_id     UUID        NOT NULL,
          tenant_id     UUID        NOT NULL,
          s3_bucket     TEXT        NOT NULL,
          s3_key        TEXT        NOT NULL,
          s3_arn        TEXT        NOT NULL,
          archived_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
          deleted_from_pg_at TIMESTAMPTZ
        )
    """)


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS archive.object_registry CASCADE")
    op.execute("DROP TABLE IF EXISTS archive.customers CASCADE")
    op.execute("DROP TABLE IF EXISTS archive.damage_claims CASCADE")
    op.execute("DROP TABLE IF EXISTS archive.payments CASCADE")
    op.execute("DROP TABLE IF EXISTS archive.reservations CASCADE")
    op.execute("DROP TABLE IF EXISTS archive.rental_agreements CASCADE")
