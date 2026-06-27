"""add agent_service role to user_role enum

Revision ID: 20260624_042
Revises: 20260618_041
Create Date: 2026-06-24
"""
from alembic import op

revision = "20260624_042"
down_revision = "20260618_041"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ALTER TYPE ADD VALUE cannot run inside a transaction in PostgreSQL.
    # We break out of Alembic's implicit transaction, add the value, then restart.
    op.execute("COMMIT")
    op.execute("ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'AGENT_SERVICE'")
    op.execute("BEGIN")

    op.execute("""
        INSERT INTO public.staff_roles (role_key, display_name, permissions_json)
        VALUES (
            'AGENT_SERVICE',
            'AI Agent Service Account',
            '{"reservations":["read","update"],"pricing":["read"],"fleet":["read"],
              "customers":["read"],"payments":["read"],"checkout":["read"],"damage":["read"]}'
        )
        ON CONFLICT (role_key) DO UPDATE
            SET permissions_json = EXCLUDED.permissions_json
    """)


def downgrade() -> None:
    op.execute("DELETE FROM public.staff_roles WHERE role_key = 'AGENT_SERVICE'")
    # Cannot remove enum values in PostgreSQL without DROP + recreate.
    # AGENT_SERVICE value is harmless if unused — downgrade leaves it in the enum.
