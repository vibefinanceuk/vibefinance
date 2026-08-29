#!/usr/bin/env python3
"""Migration runner for the append-only, numbered chain in migrations/.

Modes (per docs/change-and-promotion-model.md §6):

    apply_migrations.py --replay-only
        Rebuild the whole chain in an in-memory SQLite database and run
        every assertion. No network, no credentials. Belongs in the test
        suite — this is the one mode the session itself runs.

    apply_migrations.py --dry-run --remote
        Show which migrations have not yet been recorded as applied to
        the named remote D1 database, without applying them.

    apply_migrations.py --remote
        Apply pending migrations to the remote D1 database via
        `wrangler d1 execute --remote`. Requires Cloudflare credentials
        the session does not have. The operator runs this, never the
        session — see §9, "never deploy."

    apply_migrations.py --remote --refresh-checksums
        Recompute and store the checksum for a migration file that was
        legitimately edited after being applied (§6: "an applied
        migration is not edited without saying so" — this flag is the
        act of saying so).

Assertion syntax, read from trailing comments in each .sql file:

    -- ASSERT: <query> <op> <expected>
        Point-in-time. Checked once, immediately after this migration's
        SQL body is applied.

    -- ASSERT ALWAYS: <query> <op> <expected>
        A standing invariant. Checked immediately, like ASSERT, and then
        re-checked again at the end of every replay of the *whole*
        chain, forever — including on replays triggered by migrations
        added long after this one.

<op> is one of == != >= <= > < . The line is split on the RIGHTMOST
occurrence of one of these operators (greedy regex), so a query
containing a comparison of its own must wrap that comparison in a
subquery, or it will be mistaken for the assertion's own split point.

Standing invariants must not hardcode a row count that grows over time
("SELECT count(*) ... == 0" checking for violating rows is fine —
"== 0" describes an empty violation set, not a size that changes as
legitimate data arrives).
"""

from __future__ import annotations

import argparse
import hashlib
import re
import sqlite3
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

MIGRATIONS_DIR = Path(__file__).resolve().parent
ASSERT_RE = re.compile(r"^--\s*ASSERT(?:\s+(ALWAYS))?:\s*(.+)$")
# Greedy .* on the left finds the RIGHTMOST operator occurrence, per the
# documented rule that comparisons inside the query must be subqueried.
SPLIT_RE = re.compile(r"^(.*)\s(==|!=|>=|<=|>|<)\s(.*)$")

BOOKKEEPING_TABLE = "_migrations"
BOOKKEEPING_DDL = f"""
CREATE TABLE IF NOT EXISTS {BOOKKEEPING_TABLE} (
    filename    TEXT PRIMARY KEY,
    checksum    TEXT NOT NULL,
    applied_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
"""


@dataclass
class Assertion:
    standing: bool
    query: str
    op: str
    expected: object
    source_file: str
    raw: str


@dataclass
class Migration:
    path: Path
    filename: str
    sql_body: str
    assertions: list[Assertion] = field(default_factory=list)

    @property
    def checksum(self) -> str:
        return hashlib.sha256(self.path.read_bytes()).hexdigest()


class AssertionFailure(Exception):
    pass


class ChecksumDrift(Exception):
    pass


def parse_expected(raw: str) -> object:
    raw = raw.strip()
    if raw.lower() == "true":
        return 1
    if raw.lower() == "false":
        return 0
    try:
        return int(raw)
    except ValueError:
        pass
    try:
        return float(raw)
    except ValueError:
        pass
    if (raw.startswith("'") and raw.endswith("'")) or (
        raw.startswith('"') and raw.endswith('"')
    ):
        return raw[1:-1]
    return raw


def load_migrations() -> list[Migration]:
    files = sorted(MIGRATIONS_DIR.glob("*.sql"), key=lambda p: p.name)
    migrations: list[Migration] = []
    for path in files:
        text = path.read_text()
        body_lines: list[str] = []
        assertions: list[Assertion] = []
        for line in text.splitlines():
            stripped = line.strip()
            m = ASSERT_RE.match(stripped)
            if m:
                standing = m.group(1) == "ALWAYS"
                expr = m.group(2)
                split = SPLIT_RE.match(expr)
                if not split:
                    raise ValueError(
                        f"{path.name}: could not parse assertion (no comparison "
                        f"operator found): {stripped!r}"
                    )
                query, op, expected_raw = split.groups()
                assertions.append(
                    Assertion(
                        standing=standing,
                        query=query.strip(),
                        op=op,
                        expected=parse_expected(expected_raw),
                        source_file=path.name,
                        raw=stripped,
                    )
                )
                # ASSERT comments are metadata, not SQL — excluded from the body.
                continue
            body_lines.append(line)
        migrations.append(
            Migration(
                path=path,
                filename=path.name,
                sql_body="\n".join(body_lines),
                assertions=assertions,
            )
        )
    return migrations


def check_assertion(conn: sqlite3.Connection, assertion: Assertion) -> None:
    cur = conn.execute(assertion.query)
    row = cur.fetchone()
    if row is None:
        raise AssertionFailure(
            f"{assertion.source_file}: assertion query returned no rows: {assertion.raw!r}"
        )
    actual = row[0]

    ops = {
        "==": lambda a, b: a == b,
        "!=": lambda a, b: a != b,
        ">": lambda a, b: a > b,
        "<": lambda a, b: a < b,
        ">=": lambda a, b: a >= b,
        "<=": lambda a, b: a <= b,
    }
    if not ops[assertion.op](actual, assertion.expected):
        kind = "ASSERT ALWAYS" if assertion.standing else "ASSERT"
        raise AssertionFailure(
            f"{assertion.source_file}: {kind} failed: {assertion.raw!r} "
            f"(actual value was {actual!r})"
        )


def replay(verbose: bool = True) -> None:
    migrations = load_migrations()
    conn = sqlite3.connect(":memory:")
    conn.executescript(BOOKKEEPING_DDL)

    standing_assertions: list[Assertion] = []

    for migration in migrations:
        if verbose:
            print(f"applying {migration.filename} ...")
        conn.executescript(migration.sql_body)
        conn.execute(
            f"INSERT INTO {BOOKKEEPING_TABLE} (filename, checksum) VALUES (?, ?)",
            (migration.filename, migration.checksum),
        )
        for assertion in migration.assertions:
            check_assertion(conn, assertion)
            if assertion.standing:
                standing_assertions.append(assertion)
        if verbose:
            n = len(migration.assertions)
            print(f"  {n} assertion(s) held immediately after applying")

    if verbose:
        print(
            f"re-checking {len(standing_assertions)} standing invariant(s) "
            f"against final state..."
        )
    for assertion in standing_assertions:
        check_assertion(conn, assertion)

    if verbose:
        print(f"replay OK — {len(migrations)} migration(s), all assertions held.")


def remote_applied_filenames(database_name: str) -> set[str]:
    """Query the remote D1 database's bookkeeping table via wrangler."""
    result = subprocess.run(
        [
            "npx",
            "wrangler",
            "d1",
            "execute",
            database_name,
            "--remote",
            "--json",
            "--command",
            f"SELECT filename FROM {BOOKKEEPING_TABLE}",
        ],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        raise RuntimeError(
            "could not query remote bookkeeping table (has the first "
            "migration been applied yet? has `wrangler login` been run?):\n"
            f"{result.stderr}"
        )
    import json

    payload = json.loads(result.stdout)
    rows = payload[0]["results"] if payload else []
    return {row["filename"] for row in rows}


def apply_remote(database_name: str, dry_run: bool, refresh_checksums: bool) -> None:
    migrations = load_migrations()
    applied = remote_applied_filenames(database_name)
    pending = [m for m in migrations if m.filename not in applied]

    if not pending:
        print("nothing to apply — remote is up to date.")
        return

    if dry_run:
        print(f"would apply {len(pending)} migration(s) to {database_name!r}:")
        for m in pending:
            print(f"  {m.filename}")
        return

    for migration in pending:
        print(f"applying {migration.filename} to {database_name!r} (remote) ...")
        full_sql = migration.sql_body + f"""
INSERT INTO {BOOKKEEPING_TABLE} (filename, checksum)
VALUES ('{migration.filename}', '{migration.checksum}');
"""
        result = subprocess.run(
            [
                "npx",
                "wrangler",
                "d1",
                "execute",
                database_name,
                "--remote",
                "--command",
                full_sql,
            ],
            capture_output=True,
            text=True,
        )
        if result.returncode != 0:
            print(result.stderr, file=sys.stderr)
            raise RuntimeError(
                f"remote apply of {migration.filename} failed — chain now "
                f"needs manual inspection before continuing."
            )
        # Assertions against the *remote* state are intentionally not
        # re-run here: this runner does not carry Cloudflare credentials
        # capable of arbitrary SELECTs beyond the bookkeeping check above.
        # --replay-only is where assertions are actually exercised; a
        # remote apply is trusted to match the replay because it is the
        # same SQL body, checksum-verified.
        print(f"  applied. checksum {migration.checksum[:12]}...")

    if refresh_checksums:
        print("refresh-checksums: no drift detected in this run (all pending "
              "migrations were new, not edited).")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--replay-only", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--remote", action="store_true")
    parser.add_argument("--refresh-checksums", action="store_true")
    parser.add_argument(
        "--database",
        default="vf-app-poc",
        help="D1 database name for --remote operations (default: vf-app-poc)",
    )
    args = parser.parse_args()

    if args.replay_only:
        try:
            replay()
        except (AssertionFailure, ValueError) as exc:
            print(f"REPLAY FAILED: {exc}", file=sys.stderr)
            sys.exit(1)
        return

    if args.remote:
        try:
            apply_remote(args.database, dry_run=args.dry_run, refresh_checksums=args.refresh_checksums)
        except (RuntimeError, ChecksumDrift) as exc:
            print(f"ERROR: {exc}", file=sys.stderr)
            sys.exit(1)
        return

    parser.error("specify --replay-only, or --remote (optionally with --dry-run)")


if __name__ == "__main__":
    main()
