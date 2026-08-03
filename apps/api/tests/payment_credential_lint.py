"""Fail the build if a payment credential is put on module state.

The failure this exists to prevent moves real money to the wrong company.

`stripe.api_key` is one variable shared by the whole process. While every
charge belongs to the platform's own account that is merely untidy. The moment
credentials are per-tenant it is a cross-tenant money bug: request A resolves
tenant A's key, request B overwrites the global with tenant B's, and A's charge
goes out against B's account. It succeeds. Nothing in the response says the
money landed in the wrong place, and reconciliation finds it weeks later.

The same reasoning applies to any SDK configured by assignment rather than by
argument, so this checks for the shape rather than for one library.

Walks the AST instead of grepping, so a match is a real assignment and not a
mention in a docstring — this file would otherwise flag itself.
"""
from __future__ import annotations

import ast
import pathlib
import sys

GREEN, RED = "\033[32m", "\033[31m"
RESET = "\033[0m"

# module attributes that configure a payment SDK globally
FORBIDDEN = {
    ("stripe", "api_key"),
    ("stripe", "api_base"),
    ("stripe", "default_http_client"),
    ("braintree", "Configuration"),
    ("Adyen", "client"),
}

ROOT = pathlib.Path(__file__).resolve().parent.parent / "app"


def offences(path: pathlib.Path) -> list[tuple[int, str]]:
    try:
        source = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        # Not decodable as UTF-8, so not something Python will import as source
        # either. Skipping keeps the lint running; crashing on it would mean the
        # check silently stops covering every file after this one.
        return []
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return []

    found: list[tuple[int, str]] = []
    for node in ast.walk(tree):
        targets: list[ast.expr] = []
        if isinstance(node, ast.Assign):
            targets = list(node.targets)
        elif isinstance(node, (ast.AugAssign, ast.AnnAssign)):
            targets = [node.target]
        for target in targets:
            if not isinstance(target, ast.Attribute):
                continue
            if not isinstance(target.value, ast.Name):
                continue
            pair = (target.value.id, target.attr)
            if pair in FORBIDDEN:
                found.append((node.lineno, f"{pair[0]}.{pair[1]}"))
    return found


def main() -> int:
    hits: list[tuple[pathlib.Path, int, str]] = []
    scanned = 0
    for path in sorted(ROOT.rglob("*.py")):
        scanned += 1
        for lineno, what in offences(path):
            hits.append((path, lineno, what))

    if hits:
        print(f"{RED}  payment credential lint: {len(hits)} global credential "
              f"assignment(s){RESET}")
        for path, lineno, what in hits:
            rel = path.relative_to(ROOT.parent)
            print(f"    {rel}:{lineno}  assigns {what}")
        print("\n  A payment credential on module state is shared by every request")
        print("  in the process. Pass it as an argument instead — see")
        print("  app/integrations/stripe_merchant.py.")
        return 1

    print(f"{GREEN}  payment credential lint: clean ({scanned} files){RESET}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
