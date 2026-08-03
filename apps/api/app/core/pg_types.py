"""Column types for Postgres constructs the ORM cannot infer.

`pg_enum` exists because of a failure that is easy to write and hard to spot.

A column declared `Text` in the model but stored as a named enum in Postgres
makes asyncpg render the bind parameter as `$n::VARCHAR`. Postgres will not
cast varchar into an enum, so the statement is rejected — and it is rejected
for the whole row, including when the value being bound is NULL and the column
is one nobody is using. `customers.preferred_transmission` was exactly that:
never set by any code path, and it made creating any customer at all return a
500.

The mismatch is invisible in the model, invisible in the migration, and only
shows up as a DatatypeMismatchError at INSERT time naming a column unrelated to
what the caller was doing.

Values pass through untouched in both directions — a `pg_enum` column reads
back as a plain `str`, the same as `Text` did, so nothing downstream changes.
That is the point: SQLAlchemy's own `postgresql.ENUM` also fixes the bind, but
it validates results against a value list, which means either duplicating every
enum's members here and letting them drift from the migrations, or getting
`LookupError: 'AUTOMATIC' is not among the defined enum values` on read.

`tests/enum_column_lint.py` fails the build when a model declares a string type
for a column Postgres stores as an enum.
"""
from __future__ import annotations

from typing import Any

from sqlalchemy.types import UserDefinedType


class PgEnum(UserDefinedType):
    """A named Postgres enum, carried in Python as a plain string."""

    cache_ok = True

    def __init__(self, name: str) -> None:
        self.name = name

    def get_col_spec(self, **_kw: Any) -> str:
        return self.name

    def __repr__(self) -> str:
        return f"PgEnum({self.name!r})"


def pg_enum(name: str) -> PgEnum:
    """Declare a column stored as the Postgres enum type `name`."""
    return PgEnum(name)
