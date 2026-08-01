"""let a tenant delete its own vehicle classes without corrupting history

Revision ID: 066_catalogue_delete
Revises: 065_tenant_catalogues
Create Date: 2026-08-02

Migration 065 gave every tenant its own catalogue rows. Owning them is not the
same as being able to manage them: all four foreign keys into vehicle_classes
were NO ACTION, so deleting any class that had ever been used failed outright.

    DELETE FROM vehicle_classes WHERE name = 'Mini'
    -> violates foreign key constraint on reservations

A tenant's catalogue is its own inventory. It should be able to retire a class
it does not offer without a database error, and without silently destroying the
booking history that referenced it. Those two requirements pull in opposite
directions, so each reference is handled on its merits rather than with one
blanket rule:

  rate_schedule_items   CASCADE   Pricing for a class is meaningless once the
                                  class is gone. These rows belong to it.

  customers.preferred   SET NULL  A stated preference, not a record of fact.
                                  Losing it costs nothing.

  reservations          SET NULL  A booking is a historical record and must
                                  survive, but it must not keep pointing at a
                                  row that no longer exists. The class NAME is
                                  snapshotted onto the reservation first, so
                                  "what did they book?" is still answerable
                                  after the class is deleted. Without that
                                  snapshot this would quietly erase what every
                                  past rental was for.

  vehicles              RESTRICT  Deliberately still blocked. A vehicle has to
                                  be some class; nulling it would leave cars
                                  that cannot be priced or searched. The API
                                  turns this into a clear instruction to
                                  reassign or deactivate rather than a
                                  constraint error.

extras_catalog has no inbound foreign keys, so it needs nothing here.

Phase: expand (adds a column) + contract (rebuilds constraints)
Lock risk: moderate — ALTER TABLE ... DROP/ADD CONSTRAINT takes a brief
  ACCESS EXCLUSIVE lock per table; the backfill updates 1,124 reservations
Reversible: yes
"""
from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision: str = '066_catalogue_delete'
down_revision: str | None = '065_tenant_catalogues'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Snapshot the class name onto every reservation BEFORE relaxing the
    # constraint, so no history is lost the first time a class is deleted.
    op.add_column(
        "reservations",
        sa.Column(
            "vehicle_class_name",
            sa.Text(),
            nullable=True,
            comment="Class name as booked. Kept so the booking still reads "
                    "correctly after the class is deleted or renamed.",
        ),
    )
    op.execute(
        """
        UPDATE reservations r
           SET vehicle_class_name = vc.name
          FROM vehicle_classes vc
         WHERE vc.class_id = r.vehicle_class_id
           AND r.vehicle_class_name IS NULL
        """
    )

    op.drop_constraint("rate_schedule_items_vehicle_class_id_fkey",
                       "rate_schedule_items", type_="foreignkey")
    op.create_foreign_key(
        "rate_schedule_items_vehicle_class_id_fkey", "rate_schedule_items",
        "vehicle_classes", ["vehicle_class_id"], ["class_id"],
        ondelete="CASCADE",
    )

    op.drop_constraint("customers_preferred_class_id_fkey",
                       "customers", type_="foreignkey")
    op.create_foreign_key(
        "customers_preferred_class_id_fkey", "customers",
        "vehicle_classes", ["preferred_class_id"], ["class_id"],
        ondelete="SET NULL",
    )

    op.drop_constraint("reservations_vehicle_class_id_fkey",
                       "reservations", type_="foreignkey")
    op.create_foreign_key(
        "reservations_vehicle_class_id_fkey", "reservations",
        "vehicle_classes", ["vehicle_class_id"], ["class_id"],
        ondelete="SET NULL",
    )

    # vehicles stays RESTRICT on purpose — see the module docstring.


def downgrade() -> None:
    for name, table, col in (
        ("rate_schedule_items_vehicle_class_id_fkey", "rate_schedule_items",
         "vehicle_class_id"),
        ("customers_preferred_class_id_fkey", "customers", "preferred_class_id"),
        ("reservations_vehicle_class_id_fkey", "reservations", "vehicle_class_id"),
    ):
        op.drop_constraint(name, table, type_="foreignkey")
        op.create_foreign_key(name, table, "vehicle_classes", [col], ["class_id"])

    op.drop_column("reservations", "vehicle_class_name")
