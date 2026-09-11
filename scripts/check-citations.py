#!/usr/bin/env python3
"""
Every decision a comment cites is one that exists.

**Two records were cited nineteen times and never written** — decisions
0188 and 0224, found by comparing what is cited against what is on disk
and not by anyone reading the code. Decision 0224's own record says so.

The convention is that a comment naming a number can be followed. Twice
it could not, and neither was noticed while writing three of the records
in between.

Run with the tests:

    python3 scripts/check-citations.py
"""

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DECISIONS = ROOT / "docs" / "decisions"

# Where a citation can appear. Not `node_modules`, and not the bundles.
SUFFIXES = {".ts", ".js", ".sql", ".md", ".py"}
SKIP = {"node_modules", ".git", "dist", ".wrangler"}


def main() -> int:
    have = {p.name[:4] for p in DECISIONS.glob("[0-9]*.md")}
    if len(have) < 100:
        # A guard on the guard: an empty set would make everything pass.
        print(f"only {len(have)} decision records found — is the path right?", file=sys.stderr)
        return 2

    dangling: dict[str, list[str]] = {}

    for path in ROOT.rglob("*"):
        if not path.is_file() or path.suffix not in SUFFIXES:
            continue
        if any(part in SKIP for part in path.parts):
            continue

        try:
            text = path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError):
            continue

        # "decision 0123" and "decisions 0123", which is how every
        # comment in this repository writes one.
        for number in set(re.findall(r"\bdecisions?\s+0(\d{3})", text)):
            if f"0{number}" not in have:
                dangling.setdefault(f"0{number}", []).append(str(path.relative_to(ROOT)))

    if not dangling:
        print(f"citations OK — {len(have)} records, none dangling.")
        return 0

    print("cited and never written:", file=sys.stderr)
    for number, files in sorted(dangling.items()):
        print(f"  {number} — {len(files)} reference(s): {files[0]}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
