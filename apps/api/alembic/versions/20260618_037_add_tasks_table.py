"""add tasks and task_comments tables

Revision ID: 037_add_tasks_table
Revises: 036_vehicle_promo_fields
Create Date: 2026-06-18

Phase: expand
Lock risk: low (new tables)
Reversible: yes
"""
from __future__ import annotations

from alembic import op

revision: str = '037_add_tasks_table'
down_revision: str | None = '036_vehicle_promo_fields'
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    op.execute("""
        CREATE TABLE tasks (
            task_id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            tenant_id        UUID NOT NULL,
            task_type        TEXT NOT NULL,
            title            TEXT NOT NULL,
            notes            TEXT,
            status           TEXT NOT NULL DEFAULT 'TODO',
            priority         TEXT NOT NULL DEFAULT 'MEDIUM',
            due_datetime     TIMESTAMPTZ,
            assignee_id      UUID,
            reservation_id   UUID,
            vehicle_id       UUID,
            location_id      UUID,
            created_by       UUID NOT NULL,
            blocked_reason   TEXT,
            reminded_at      TIMESTAMPTZ,
            created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            deleted_at       TIMESTAMPTZ,
            CONSTRAINT tasks_status_check CHECK (status IN ('TODO','IN_PROGRESS','BLOCKED','DONE')),
            CONSTRAINT tasks_priority_check CHECK (priority IN ('HIGH','MEDIUM','LOW')),
            CONSTRAINT tasks_type_check CHECK (task_type IN (
                'PICKUP_PREP','RETURN_INSPECTION','CUSTOMER_DROPOFF','DOC_COLLECTION',
                'HANDOVER','MAINTENANCE','TURNAROUND','RECALL_HOLD','INSPECTION',
                'HOLD','STAGING','CHARGING','GENERAL'
            ))
        )
    """)

    op.execute("""
        CREATE INDEX idx_tasks_tenant_status_due ON tasks(tenant_id, status, due_datetime)
    """)

    op.execute("""
        CREATE INDEX idx_tasks_assignee ON tasks(tenant_id, assignee_id) WHERE deleted_at IS NULL
    """)

    op.execute("""
        CREATE INDEX idx_tasks_reservation ON tasks(reservation_id) WHERE deleted_at IS NULL
    """)

    op.execute("""
        CREATE UNIQUE INDEX uq_tasks_type_reservation ON tasks(task_type, reservation_id)
        WHERE deleted_at IS NULL AND reservation_id IS NOT NULL
    """)

    op.execute("""
        CREATE TABLE task_comments (
            comment_id  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
            task_id     UUID NOT NULL,
            tenant_id   UUID NOT NULL,
            author_id   UUID NOT NULL,
            body        TEXT NOT NULL,
            created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)

    op.execute("""
        CREATE INDEX idx_task_comments_task ON task_comments(task_id)
    """)

    op.execute("""
        UPDATE staff_roles
        SET permissions_json = permissions_json || '{"tasks":["read","create","update","delete"]}'::JSONB
        WHERE role_key IN ('COUNTER_AGENT','SENIOR_AGENT','BRANCH_MANAGER','REGIONAL_MANAGER','FLEET_MANAGER','MAINTENANCE_TECH')
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_task_comments_task")
    op.execute("DROP TABLE IF EXISTS task_comments")
    op.execute("DROP INDEX IF EXISTS uq_tasks_type_reservation")
    op.execute("DROP INDEX IF EXISTS idx_tasks_reservation")
    op.execute("DROP INDEX IF EXISTS idx_tasks_assignee")
    op.execute("DROP INDEX IF EXISTS idx_tasks_tenant_status_due")
    op.execute("DROP TABLE IF EXISTS tasks")
