"""per-user credential epoch so a password change really ends every session

Revision ID: 061_token_epoch
Revises: 060_partition_audit_rls
Create Date: 2026-08-01

Password reset revoked only the ACCESS token JTIs held in user_sessions:{uid}.
Refresh JTIs were never in that index and refresh:{jti} keys were never deleted,
so a stolen refresh token kept minting valid access tokens for the remaining 30
days. change_password revoked nothing whatsoever. Reproduced against the local
stack: after a completed reset the old access token 401s, and the old refresh
token still returns 200 and hands back a fresh session.

Revoking individual JTIs cannot fix this on its own, because the set of live
refresh tokens for a user is not knowable — rotation mints new ones and the old
index only ever held access JTIs.

A monotonic per-user counter sidesteps the bookkeeping entirely. Every token
carries the epoch it was minted under; raising the column invalidates every
token in existence for that user in one write, whatever kind it is and however
it was obtained. This is the standard fix and it is durable, which matters:
a Redis-only version would reset to zero on a restart and silently re-validate
every token it was meant to kill.

Phase: expand
Lock risk: low — adding a NOT NULL column with a constant default is metadata-
  only on PG11+
Reversible: yes
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision: str = '061_token_epoch'
down_revision: str | None = '060_partition_audit_rls'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "staff_users",
        sa.Column(
            "token_epoch",
            sa.Integer(),
            nullable=False,
            server_default="0",
            comment="Bumped on password change/reset and on refresh-token reuse. "
                    "Tokens minted under a lower epoch are rejected.",
        ),
    )
    # Customers authenticate through the same token machinery.
    op.add_column(
        "customers",
        sa.Column(
            "token_epoch",
            sa.Integer(),
            nullable=False,
            server_default="0",
            comment="See staff_users.token_epoch.",
        ),
    )


def downgrade() -> None:
    op.drop_column("customers", "token_epoch")
    op.drop_column("staff_users", "token_epoch")
