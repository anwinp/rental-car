"""Create OTA channel manager tables (ota_channels, ota_leads).

Revision ID: 20260618_041
Revises: 20260618_040
Create Date: 2026-06-18
"""
from alembic import op

revision = "20260618_041"
down_revision = "20260618_040"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
        CREATE TABLE IF NOT EXISTS ota_channels (
            channel_id      UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
            tenant_id       UUID         NOT NULL,
            channel_name    TEXT         NOT NULL,
            api_key         TEXT         NOT NULL DEFAULT '',
            api_secret      TEXT         NOT NULL DEFAULT '',
            property_id     TEXT         NOT NULL DEFAULT '',
            is_active       BOOLEAN      NOT NULL DEFAULT FALSE,
            last_polled_at  TIMESTAMPTZ  NULL,
            webhook_enabled BOOLEAN      NOT NULL DEFAULT FALSE,
            created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            CONSTRAINT ota_channels_name_check CHECK (channel_name IN ('BOOKING_COM', 'EXPEDIA')),
            CONSTRAINT ota_channels_tenant_channel_unique UNIQUE (tenant_id, channel_name)
        )
    """)
    op.execute("""
        CREATE TABLE IF NOT EXISTS ota_leads (
            lead_id                 UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
            tenant_id               UUID         NOT NULL,
            channel_name            TEXT         NOT NULL,
            ota_booking_ref         TEXT         NOT NULL,
            customer_name           TEXT         NOT NULL,
            customer_email          TEXT         NULL,
            customer_phone          TEXT         NULL,
            pickup_date             DATE         NULL,
            return_date             DATE         NULL,
            vehicle_class_requested TEXT         NOT NULL DEFAULT '',
            status                  TEXT         NOT NULL DEFAULT 'PENDING',
            internal_reservation_id UUID         NULL,
            raw_payload             JSONB        NOT NULL DEFAULT '{}',
            received_at             TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            actioned_at             TIMESTAMPTZ  NULL,
            actioned_by             UUID         NULL,
            rejection_reason        TEXT         NULL,
            created_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            updated_at              TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
            CONSTRAINT ota_leads_status_check CHECK (status IN ('PENDING','CONFIRMED','REJECTED','EXPIRED','CANCELLED_BY_OTA')),
            CONSTRAINT ota_leads_booking_ref_unique UNIQUE (tenant_id, channel_name, ota_booking_ref)
        )
    """)
    op.execute("CREATE INDEX IF NOT EXISTS idx_ota_leads_tenant_status ON ota_leads(tenant_id, status)")
    op.execute("CREATE INDEX IF NOT EXISTS idx_ota_channels_active ON ota_channels(tenant_id, is_active) WHERE is_active = TRUE")


def downgrade():
    op.execute("DROP TABLE IF EXISTS ota_leads")
    op.execute("DROP TABLE IF EXISTS ota_channels")
