"""create all 15 enum types

Revision ID: 003_enum_types
Revises: 002_schemas_roles
Create Date: 2024-01-01

Phase: expand
Lock risk: low
Reversible: yes
"""
from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision: str = '003_enum_types'
down_revision: str | None = '002_schemas_roles'
branch_labels: str | tuple[str, ...] | None = None
depends_on: str | tuple[str, ...] | None = None


def upgrade() -> None:
    # 1. reservation lifecycle — GAP-004: uses CHECKED_OUT not ACTIVE
    op.execute("""
        CREATE TYPE reservation_status AS ENUM (
          'QUOTE', 'PENDING', 'CONFIRMED', 'MODIFIED',
          'CHECKED_OUT', 'EXTENDED', 'RETURNED', 'CLOSED',
          'CANCELLED', 'NO_SHOW', 'DISPUTED'
        )
    """)

    # 2. vehicle operational state — 13 statuses (GAP-003: CHARGING is NOT here)
    op.execute("""
        CREATE TYPE vehicle_status AS ENUM (
          'STAGING', 'AVAILABLE', 'ON_RENT', 'RETURNING',
          'READY_FOR_INSPECTION', 'CLEANING', 'MAINTENANCE',
          'IN_REPAIR', 'DAMAGE_HOLD', 'ADMIN_HOLD',
          'PENDING_DISPOSAL', 'DISPOSED', 'PENDING_DELIVERY'
        )
    """)

    # 3. vehicle calendar block type — CHARGING is here (GAP-003)
    op.execute("""
        CREATE TYPE vehicle_block_type AS ENUM (
          'RESERVATION', 'TURNAROUND', 'MAINTENANCE', 'RECALL_HOLD',
          'IN_TRANSIT', 'HOLD', 'INSPECTION', 'STAGING', 'CHARGING'
        )
    """)

    # 4. damage severity
    op.execute("""
        CREATE TYPE damage_severity AS ENUM (
          'GRADE_1_COSMETIC', 'GRADE_2_MINOR', 'GRADE_3_MODERATE',
          'GRADE_4_SEVERE', 'GRADE_5_TOTAL_LOSS'
        )
    """)

    # 5. damage claim lifecycle
    op.execute("""
        CREATE TYPE claim_status AS ENUM (
          'OPEN', 'ESTIMATE_SENT', 'CUSTOMER_ACKNOWLEDGED',
          'REPAIR_IN_PROGRESS', 'REPAIR_COMPLETE', 'INVOICED',
          'PAID', 'DISPUTED', 'IN_LITIGATION', 'WRITTEN_OFF'
        )
    """)

    # 6. payment methods
    op.execute("""
        CREATE TYPE payment_method AS ENUM (
          'CREDIT_CARD', 'DEBIT_CARD', 'DIGITAL_WALLET',
          'CASH', 'DIRECT_BILL', 'ACH', 'WIRE', 'FUEL_CARD'
        )
    """)

    # 7. payment transaction status
    op.execute("""
        CREATE TYPE payment_status AS ENUM (
          'PENDING', 'AUTHORIZED', 'CAPTURED', 'REFUNDED',
          'PARTIALLY_REFUNDED', 'VOIDED', 'DECLINED', 'EXPIRED'
        )
    """)

    # 8. staff roles
    op.execute("""
        CREATE TYPE user_role AS ENUM (
          'CUSTOMER', 'CORPORATE_BOOKER', 'COUNTER_AGENT', 'SENIOR_AGENT',
          'BRANCH_MANAGER', 'REGIONAL_MANAGER', 'FLEET_MANAGER',
          'MAINTENANCE_TECH', 'CLAIMS_COORDINATOR', 'FINANCE',
          'SYSTEM_ADMIN', 'SUPER_ADMIN', 'API_PARTNER'
        )
    """)

    # 9. rate types
    op.execute("""
        CREATE TYPE rate_type AS ENUM (
          'RACK', 'CORPORATE', 'GOVERNMENT', 'INSURANCE_REPLACEMENT',
          'PROMOTIONAL', 'OTA_NET', 'WHOLESALE', 'MEMBERSHIP',
          'TOUR_OPERATOR', 'LOYALTY_REDEMPTION', 'WEEKEND_SPECIAL'
        )
    """)

    # 10. fleet / acquisition type
    op.execute("""
        CREATE TYPE fleet_type AS ENUM (
          'OWNED', 'LEASED', 'PROGRAM_CAR', 'COURTESY'
        )
    """)

    # 11. depreciation method
    op.execute("""
        CREATE TYPE depreciation_method AS ENUM (
          'STRAIGHT_LINE', 'UNITS_OF_PRODUCTION', 'MACRS'
        )
    """)

    # 12. fuel type
    op.execute("""
        CREATE TYPE fuel_type AS ENUM (
          'GASOLINE', 'DIESEL', 'HYBRID', 'PHEV', 'BEV', 'HYDROGEN', 'LPG'
        )
    """)

    # 13. transmission type
    op.execute("""
        CREATE TYPE transmission_type AS ENUM (
          'AUTOMATIC', 'MANUAL', 'CVT', 'DCT'
        )
    """)

    # 14. KYC status
    op.execute("""
        CREATE TYPE kyc_status AS ENUM (
          'UNVERIFIED', 'TIER_1_PENDING', 'TIER_1_COMPLETE',
          'TIER_2_PENDING', 'TIER_2_COMPLETE', 'FAILED', 'FLAGGED'
        )
    """)

    # 15. audit action type
    op.execute("""
        CREATE TYPE audit_action AS ENUM (
          'INSERT', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT',
          'EXPORT', 'CONFIG_CHANGE', 'STATE_TRANSITION'
        )
    """)


def downgrade() -> None:
    op.execute("DROP TYPE IF EXISTS audit_action")
    op.execute("DROP TYPE IF EXISTS kyc_status")
    op.execute("DROP TYPE IF EXISTS transmission_type")
    op.execute("DROP TYPE IF EXISTS fuel_type")
    op.execute("DROP TYPE IF EXISTS depreciation_method")
    op.execute("DROP TYPE IF EXISTS fleet_type")
    op.execute("DROP TYPE IF EXISTS rate_type")
    op.execute("DROP TYPE IF EXISTS user_role")
    op.execute("DROP TYPE IF EXISTS payment_status")
    op.execute("DROP TYPE IF EXISTS payment_method")
    op.execute("DROP TYPE IF EXISTS claim_status")
    op.execute("DROP TYPE IF EXISTS damage_severity")
    op.execute("DROP TYPE IF EXISTS vehicle_block_type")
    op.execute("DROP TYPE IF EXISTS vehicle_status")
    op.execute("DROP TYPE IF EXISTS reservation_status")
