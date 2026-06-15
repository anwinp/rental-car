#!/usr/bin/env python3
"""CI gate: rejects Alembic --sql output with locking violations. Exit 0=ok, 1=fail.

Usage:
    alembic upgrade --sql head | python scripts/check_lock_safety.py

Blocks migrations that would take ACCESS EXCLUSIVE (or Share) locks on tables
known to be large in production (> 10,000 rows). Agents must use the
expand-contract pattern for zero-downtime schema changes.
"""
from __future__ import annotations

import re
import sys

# Tables known to be large in production (maintained manually).
# Any ALTER/INDEX on these tables requires CONCURRENTLY or expand-contract.
LARGE_TABLES = {
    "reservations",
    "rental_agreements",
    "vehicles",
    "customers",
    "payments",
    "damage_claims",
    "audit_events",
    "telematics_events",
    "notification_log",
    "vehicle_blocks",
    "vehicle_status_log",
    "reservation_versions",
    "rate_codes",
    "rate_schedule_items",
}

VIOLATIONS: list[str] = []


def _table(m: re.Match[str]) -> str:
    """Extract and lowercase the table name from a regex match group 1."""
    return m.group(1).lower()


def check_set_not_null(line: str, lineno: int) -> None:
    """Rejects direct SET NOT NULL on large tables.

    Rationale: SET NOT NULL acquires ACCESS EXCLUSIVE and scans the full table.
    Use expand-contract: ADD CHECK (col IS NOT NULL) NOT VALID → VALIDATE → SET NOT NULL.
    """
    m = re.search(
        r"alter\s+table\s+(?:public\.)?(\w+)\s+alter\s+column\s+\w+\s+set\s+not\s+null",
        line,
        re.IGNORECASE,
    )
    if m and _table(m) in LARGE_TABLES:
        VIOLATIONS.append(
            f"Line {lineno}: SET NOT NULL on '{_table(m)}' without VALIDATE CONSTRAINT. "
            "Use expand-contract: ADD CHECK NOT VALID -> VALIDATE -> SET NOT NULL."
        )


def check_create_index(line: str, lineno: int) -> None:
    """Rejects CREATE INDEX without CONCURRENTLY.

    Rationale: non-concurrent index creation takes ShareLock, blocks concurrent writes.
    Always use CREATE INDEX CONCURRENTLY in migrations.
    """
    if re.search(
        r"\bcreate\s+(?:unique\s+)?index\s+(?!concurrently\b)",
        line,
        re.IGNORECASE,
    ):
        # Skip the CREATE TABLE ... PRIMARY KEY inline index
        if "create table" not in line.lower():
            VIOLATIONS.append(
                f"Line {lineno}: CREATE INDEX without CONCURRENTLY — "
                "use CREATE INDEX CONCURRENTLY."
            )


def check_drop_column(line: str, lineno: int) -> None:
    """Rejects DROP COLUMN on large tables.

    Rationale: DROP COLUMN acquires ACCESS EXCLUSIVE on large tables.
    Use expand-contract: stop using the column, deploy, then drop in a later migration.
    """
    m = re.search(
        r"alter\s+table\s+(?:public\.)?(\w+)\s+drop\s+column",
        line,
        re.IGNORECASE,
    )
    if m and _table(m) in LARGE_TABLES:
        VIOLATIONS.append(
            f"Line {lineno}: DROP COLUMN on '{_table(m)}' — "
            "use expand-contract pattern."
        )


def check_full_table_rewrite(line: str, lineno: int) -> None:
    """Rejects ALTER COLUMN TYPE on large tables.

    Rationale: type changes may force a full table rewrite with ACCESS EXCLUSIVE.
    Use expand-contract: add new column, backfill, cut over app, then drop old column.
    """
    m = re.search(
        r"alter\s+table\s+(?:public\.)?(\w+)\s+alter\s+column\s+\w+\s+type\s+",
        line,
        re.IGNORECASE,
    )
    if m and _table(m) in LARGE_TABLES:
        VIOLATIONS.append(
            f"Line {lineno}: ALTER COLUMN TYPE on '{_table(m)}' — "
            "use expand-contract: add column, backfill, drop old."
        )


def check_volatile_default(line: str, lineno: int) -> None:
    """Rejects ADD COLUMN with a volatile DEFAULT on large tables.

    Rationale: volatile defaults (e.g., uuid_generate_v4()) rewrite the whole table.
    Use ADD COLUMN DEFAULT NULL, then backfill, then set NOT NULL separately.
    """
    m = re.search(
        r"alter\s+table\s+(?:public\.)?(\w+)\s+add\s+column\s+\w+\s+\w+.*\bdefault\s+(?!null\b|'|\d)",
        line,
        re.IGNORECASE,
    )
    if m and _table(m) in LARGE_TABLES:
        VIOLATIONS.append(
            f"Line {lineno}: ADD COLUMN with volatile DEFAULT on '{_table(m)}' — "
            "use ADD COLUMN DEFAULT NULL then backfill."
        )


def main() -> int:
    sql = sys.stdin.read()
    for lineno, raw_line in enumerate(sql.splitlines(), start=1):
        line = raw_line.strip()
        if not line or line.startswith("--"):
            continue
        check_set_not_null(line, lineno)
        check_create_index(line, lineno)
        check_drop_column(line, lineno)
        check_full_table_rewrite(line, lineno)
        check_volatile_default(line, lineno)

    if VIOLATIONS:
        for v in VIOLATIONS:
            print(f"ERROR: {v}", file=sys.stderr)
        print(
            f"\n{len(VIOLATIONS)} violation(s). Migration rejected.",
            file=sys.stderr,
        )
        return 1

    print("check_lock_safety.py: OK — no locking violations detected")
    return 0


if __name__ == "__main__":
    sys.exit(main())
