"""plans gate capability, not only counts

Revision ID: 076_plan_features
Revises: 075_expired_status
Create Date: 2026-08-02

A plan could say how much and never what. Every workspace on every plan had OTA
channel integration, the agent assistant, corporate accounts and the full
reporting suite — so the difference between Starter and Growth was three
numbers, and nothing in the product could be sold as an upgrade.

A join table rather than a JSON column on `plans`, because the first question
anyone asks when repricing is "which plans include OTA?", and a blob cannot
answer it without reading every row in the application.

Presence means enabled. There is no `enabled` boolean: a row saying `false` and
no row at all would mean the same thing while looking different, and the two
would drift the moment anything wrote one without deleting the other.

The starting allocation follows the recommendation in PLAN_ENFORCEMENT.html and
is only a starting point — the whole point of putting this in a table is that
the split is edited in the console, not in a migration. Nothing here is load
bearing except the mechanism.

Phase: expand
Lock risk: low
Reversible: yes
"""
from __future__ import annotations

from alembic import op

revision: str = '076_plan_features'
down_revision: str | None = '075_expired_status'
branch_labels = None
depends_on = None

# Growth gets the commercial features; Enterprise gets everything. Starter and
# Trial get the core product, which is a complete rental system on its own.
_GRANTS = {
    "GROWTH": ("ota_channels", "corporate_accounts", "advanced_reporting"),
    "ENTERPRISE": (
        "ota_channels", "corporate_accounts", "advanced_reporting",
        "agent_assistant", "telematics", "api_access",
    ),
}


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS plan_features (
            plan_code   text NOT NULL REFERENCES plans(code)
                             ON UPDATE CASCADE ON DELETE CASCADE,
            feature_key text NOT NULL,
            created_at  timestamptz NOT NULL DEFAULT now(),
            PRIMARY KEY (plan_code, feature_key)
        )
        """
    )
    # ON DELETE CASCADE is right here and nowhere else in this schema: a
    # feature grant has no meaning without its plan, and a plan cannot be
    # deleted while any workspace is on it.
    op.execute("GRANT SELECT, INSERT, UPDATE, DELETE ON plan_features TO app_user")

    for code, keys in _GRANTS.items():
        for key in keys:
            op.execute(
                "INSERT INTO plan_features (plan_code, feature_key) "
                f"SELECT '{code}', '{key}' "
                f" WHERE EXISTS (SELECT 1 FROM plans WHERE code = '{code}') "
                "ON CONFLICT DO NOTHING"
            )


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS plan_features")
