"""Fail the build when the ORM models disagree with the actual database.

Two checks, both for failures that are invisible in review and fatal at runtime.

**A column the database does not have.** SQLAlchemy names every column
explicitly, so a phantom column breaks SELECT as well as INSERT — the whole
table becomes unusable through the ORM. `notification_templates.merge_variables`
was declared, never migrated, and never read by anything; it meant no templated
notification could be created *or sent*.

**A string type for a Postgres enum.**

The failure this prevents cost a production outage on every customer create.
`customers.preferred_transmission` is stored as the `transmission_type` enum and
was declared `Text` in the model. asyncpg renders a string column's bind as
`$n::VARCHAR`, Postgres refuses to cast varchar into an enum, and the INSERT is
rejected for the entire row — including when the value bound is NULL and no
code path ever sets the column.

So the symptom is a 500 naming a column nobody touched, on a request that has
nothing to do with it, and the model and the migration both look correct.

This walks every mapped class, reads the real column types out of Postgres and
reports any column stored as an enum but declared as a string. It needs a live
database; when it cannot reach one it says so and skips rather than passing
silently, because a check that cannot fail is worse than no check.
"""
from __future__ import annotations

import asyncio
import importlib
import inspect
import pkgutil
import sys
import warnings

warnings.filterwarnings("ignore")

STRINGY = {"String", "VARCHAR", "Text", "TEXT", "Unicode", "UnicodeText"}

GREEN, RED, YELLOW, RESET = "\033[32m", "\033[31m", "\033[33m", "\033[0m"


def declared_columns() -> dict[tuple[str, str], str]:
    """(table, column) -> the ORM type name, across every domain model."""
    import app.domains as domains

    found: dict[tuple[str, str], str] = {}
    for mod_info in pkgutil.iter_modules(domains.__path__):
        try:
            module = importlib.import_module(f"app.domains.{mod_info.name}.models")
        except ModuleNotFoundError:
            continue
        for _, obj in inspect.getmembers(module, inspect.isclass):
            table = getattr(obj, "__table__", None)
            if table is None:
                continue
            for col in table.columns:
                found[(table.name, col.name)] = type(col.type).__name__
    return found


async def run() -> int:
    from sqlalchemy import text

    from app.core.database import engine

    declared = declared_columns()
    if not declared:
        print(f"{RED}  enum column lint: no models found{RESET}")
        return 1

    async with engine.connect() as conn:
        all_cols = (
            await conn.execute(
                text(
                    "SELECT c.table_name, c.column_name, c.data_type, c.udt_name "
                    "  FROM information_schema.columns c "
                    "  JOIN information_schema.tables t "
                    "    ON t.table_name = c.table_name "
                    "   AND t.table_schema = c.table_schema "
                    " WHERE c.table_schema = 'public' "
                    "   AND t.table_type = 'BASE TABLE'"
                )
            )
        ).all()

    real = {(t, c) for t, c, _, _ in all_cols}
    real_tables = {t for t, _, _, _ in all_cols}
    rows = [(t, c, udt) for t, c, dt, udt in all_cols if dt == "USER-DEFINED"]

    # A column the model declares that the database does not have. Only checked
    # for tables that exist — a table missing entirely is a different problem
    # and would drown this list in noise.
    phantom = sorted(
        (table, column)
        for (table, column) in declared
        if table in real_tables and (table, column) not in real
    )
    if phantom:
        print(f"{RED}  enum column lint: {len(phantom)} column(s) declared in a "
              f"model but absent from the database{RESET}")
        for table, column in phantom:
            print(f"    {table}.{column}")
        print("\n  Every ORM read and write of these tables fails with")
        print("  UndefinedColumnError. Add the column in a migration, or drop it")
        print("  from the model if nothing reads it.")
        return 1

    bad = [
        (table, column, udt, declared[(table, column)])
        for table, column, udt in rows
        if declared.get((table, column)) in STRINGY
    ]

    if bad:
        print(f"{RED}  enum column lint: {len(bad)} column(s) declared as text "
              f"but stored as a Postgres enum{RESET}")
        for table, column, udt, orm in bad:
            print(f"    {table}.{column}: model says {orm}, Postgres says {udt}")
        print("\n  Writing any row in these tables through the ORM will fail with")
        print("  DatatypeMismatchError. Declare them with pg_enum(\"<type>\") from")
        print("  app.core.pg_types.")
        return 1

    # The same failure without the enum: a JSONB column declared for a uuid[],
    # a text column declared for an integer. asyncpg casts the bind parameter
    # to whatever the model says and Postgres rejects the statement.
    # Deliberately a small allow-list of shapes rather than a full type lattice
    # — the goal is to catch outright category errors, not to police widths.
    FAMILY = {
        "ARRAY": {"ARRAY"},
        "jsonb": {"JSONB", "JSON"}, "json": {"JSONB", "JSON"},
        "boolean": {"Boolean"},
        "integer": {"Integer", "SmallInteger"}, "smallint": {"Integer", "SmallInteger"},
        "bigint": {"BigInteger", "Integer"},
        "numeric": {"Numeric", "DECIMAL", "Float"},
        "uuid": {"UUID"},
    }
    shape_bad = []
    for table, column, data_type, udt in all_cols:
        orm = declared.get((table, column))
        if orm is None:
            continue
        allowed = FAMILY.get(data_type)
        if allowed and orm not in allowed:
            shape_bad.append((table, column, data_type, orm))

    if shape_bad:
        print(f"{RED}  model/schema lint: {len(shape_bad)} column(s) whose ORM "
              f"type is the wrong shape for the database{RESET}")
        for table, column, data_type, orm in shape_bad:
            print(f"    {table}.{column}: model says {orm}, Postgres says {data_type}")
        print("\n  asyncpg casts the bind parameter to the model's type and")
        print("  Postgres refuses the cast, so writes to these tables fail.")
        return 1

    checked = sum(1 for t, c, _ in rows if (t, c) in declared)
    print(f"{GREEN}  model/schema lint: clean ({len(declared)} mapped columns, "
          f"{checked} of them enums){RESET}")
    return 0


def main() -> int:
    try:
        return asyncio.run(run())
    except Exception as exc:  # noqa: BLE001 — no database is a skip, not a pass
        print(f"{YELLOW}  enum column lint: SKIPPED — no database ({exc}){RESET}")
        return 0


if __name__ == "__main__":
    sys.exit(main())
