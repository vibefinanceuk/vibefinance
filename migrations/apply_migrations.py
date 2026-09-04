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
import json
import re
import sqlite3
import subprocess
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

DEFAULT_MIGRATIONS_DIR = Path(__file__).resolve().parent
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


def load_migrations(migrations_dir: Path = DEFAULT_MIGRATIONS_DIR) -> list[Migration]:
    files = sorted(migrations_dir.glob("*.sql"), key=lambda p: p.name)
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


def replay(migrations_dir: Path = DEFAULT_MIGRATIONS_DIR, verbose: bool = True) -> None:
    migrations = load_migrations(migrations_dir)
    conn = sqlite3.connect(":memory:")
    # D1 enforces foreign key constraints by default — "identical to
    # the behaviour you would observe when setting PRAGMA foreign_keys
    # = on in SQLite for every transaction" (Cloudflare's own D1 docs).
    # Plain SQLite defaults this OFF (confirmed directly: a fresh
    # sqlite3 connection's own PRAGMA foreign_keys reports 0). Without
    # this line, --replay-only would silently accept an FK violation
    # that real D1 would reject, making replay a weaker check than
    # production for exactly the kind of mistake FKs exist to catch.
    conn.execute("PRAGMA foreign_keys = ON")
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


def _run_wrangler_command(database_name: str, sql: str, *, json_output: bool = False) -> subprocess.CompletedProcess:
    """Run a short, single-line SQL statement against remote D1 via
    wrangler's --command flag — for reads that need row data back.

    Not --file. A live run against real Cloudflare infrastructure
    revealed that `wrangler d1 execute --file=...` does not return
    query row data at all: it appears to route through a bulk
    import/upload code path that reports execution statistics instead
    ("Total queries executed", "Rows read", "Rows written", "Database
    size (MB)" — human-readable stats keys, not SQL result columns).
    --file remains correct for writes (DDL, INSERTs), where only
    success/failure matters and the tokenization bug it fixed only ever
    applied to large multi-statement bodies. For a short single-line
    SELECT like the bookkeeping-table query, --command is what every
    basic wrangler example actually uses to get row data back as JSON,
    and the earlier tokenization bug never applied to input this short.
    """
    args = [
        "npx",
        "wrangler",
        "d1",
        "execute",
        database_name,
        "--remote",
        f"--command={sql}",
        "--yes",
    ]
    if json_output:
        args.append("--json")
    return subprocess.run(args, capture_output=True, text=True)


def _run_wrangler_sql_file(database_name: str, sql: str, *, json_output: bool = False) -> subprocess.CompletedProcess:
    """Run a SQL string against remote D1 via wrangler's --file flag.

    Not --command. A live run against real Cloudflare infrastructure
    failed with a confusing "Unknown argument" error when a large,
    multi-line, multi-statement migration body was passed inline via
    --command — something between Python's subprocess, npx, and
    wrangler's own argument parser was mis-tokenizing it (the error
    contained a fragment of the migration filename, which should never
    have been anywhere near the argument parser). --file is wrangler's
    documented mechanism for exactly this case (running a .sql file,
    as opposed to a short ad hoc query) and sidesteps the whole class of
    problem rather than working around one instance of it. Cloudflare's
    own docs and every example found use the single-token `--file=path`
    form specifically (not `--file path` as two separate argv entries)
    — matched exactly here rather than assumed equivalent, given the
    bug this fixes was itself an argument-tokenization problem.
    """
    with tempfile.NamedTemporaryFile(
        mode="w", suffix=".sql", delete=False, encoding="utf-8"
    ) as tmp:
        tmp.write(sql)
        tmp_path = tmp.name
    try:
        args = [
            "npx",
            "wrangler",
            "d1",
            "execute",
            database_name,
            "--remote",
            f"--file={tmp_path}",
            # --remote can prompt for interactive confirmation
            # ("Ok to proceed?") — documented Cloudflare guidance is to
            # pass --yes for CI/automation use. subprocess.run here has
            # no TTY to answer that prompt, and an unanswered prompt is
            # a very plausible explanation for empty/malformed stdout on
            # earlier runs, even though it hasn't been confirmed as the
            # root cause of any specific failure seen so far.
            "--yes",
        ]
        if json_output:
            args.append("--json")
        return subprocess.run(args, capture_output=True, text=True)
    finally:
        Path(tmp_path).unlink(missing_ok=True)


def ensure_remote_bookkeeping(database_name: str) -> None:
    """Create the bookkeeping table on the remote database if it isn't
    there yet. Idempotent — safe to call on every --remote invocation,
    not just the first."""
    result = _run_wrangler_sql_file(database_name, BOOKKEEPING_DDL.strip())
    if result.returncode != 0:
        raise RuntimeError(
            f"could not create the bookkeeping table on {database_name!r} "
            f"(check `wrangler login` and the database name):\n{result.stderr}"
        )


def parse_wrangler_json(stdout: str, stderr: str, *, context: str) -> object:
    """Parse wrangler's --json output, defensively.

    A live run produced a JSONDecodeError with an empty parse position
    (line 1, column 1) and no visible wrangler output in the traceback
    at all -- meaning either stdout was genuinely empty, or it contained
    something this function never showed the operator, making the
    failure undiagnosable from the error alone. Two things fixed here:
    first, try to recover if wrangler printed a non-JSON banner line
    before the actual JSON (some CLIs mix status text into stdout
    despite --json); second, and more important than any parsing
    cleverness, if that doesn't work either, fail with the *raw* stdout
    and stderr included in the error message, so the next failure
    report contains the actual wrangler output instead of a bare
    Python traceback with nothing to diagnose from.
    """
    stripped = stdout.strip()
    if stripped:
        try:
            return json.loads(stripped)
        except json.JSONDecodeError:
            pass
        # Look for a line that starts a JSON value and try parsing from
        # there — handles a banner/warning line printed before the JSON.
        for i, ch in enumerate(stripped):
            if ch in "[{":
                try:
                    return json.loads(stripped[i:])
                except json.JSONDecodeError:
                    break

    def _truncated(s: str, limit: int = 4000) -> str:
        return s if len(s) <= limit else s[:limit] + f"... [{len(s) - limit} more chars truncated]"

    raise RuntimeError(
        f"could not parse wrangler's output as JSON while {context}. "
        f"This is the actual output wrangler produced — please include it "
        f"verbatim if reporting this:\n"
        f"--- stdout ---\n{_truncated(stdout) or '(empty)'}\n"
        f"--- stderr ---\n{_truncated(stderr) or '(empty)'}"
    )


def remote_applied_filenames(database_name: str) -> set[str]:
    """Filenames only — see remote_applied_checksums for drift work."""
    return set(remote_applied_checksums(database_name))


def remote_applied_checksums(database_name: str) -> dict[str, str]:
    """Query the remote D1 database's bookkeeping table via wrangler.

    Returns filename -> checksum. The checksum half went unread for a
    long time: it was written on every apply and compared to nothing,
    while a comment in the apply loop described the result as
    "checksum-verified". Decision 0076.
    """
    ensure_remote_bookkeeping(database_name)
    result = _run_wrangler_command(
        database_name, f"SELECT filename, checksum FROM {BOOKKEEPING_TABLE}", json_output=True
    )
    if result.returncode != 0:
        raise RuntimeError(
            "could not query remote bookkeeping table (has the first "
            "migration been applied yet? has `wrangler login` been run?):\n"
            f"{result.stderr}"
        )
    payload = parse_wrangler_json(
        result.stdout, result.stderr, context="querying the bookkeeping table"
    )
    if not isinstance(payload, list) or not payload or "results" not in payload[0]:
        raise RuntimeError(
            f"wrangler's JSON output for the bookkeeping query had an "
            f"unexpected shape (expected a list with a 'results' key in "
            f"the first element): {payload!r}"
        )
    rows = payload[0]["results"]
    if rows and "filename" not in rows[0]:
        # Live run history on this: the first time this fired, the row
        # shape was {'Total queries executed': 1, 'Rows read': 1, ...}
        # — import/upload statistics, not query results. That was
        # because the query was run via --file, which turned out to
        # route through a bulk-import code path instead of returning
        # row data (fixed above: this query now goes through
        # _run_wrangler_command, i.e. --command, which every basic
        # wrangler example uses for getting rows back as JSON). So the
        # "leftover malformed table from an earlier failed attempt"
        # theory this message used to lead with is probably wrong —
        # left as a fallback thing to check only if this still fires
        # after that fix, not the first thing to suspect.
        raise RuntimeError(
            "the remote _migrations table's query results don't have a "
            "'filename' column — if this looks like execution statistics "
            "(keys like 'Rows read', 'Database size (MB)') rather than "
            "actual row data, something is still routing this query "
            "through --file instead of --command; that was the cause "
            "the one other time this fired. Actual row shape: "
            f"{rows[0]!r}\n\n"
            "If it doesn't look like statistics, check the table's real "
            "schema directly: npx wrangler d1 execute "
            f"{database_name} --remote --json --command="
            "\"SELECT sql FROM sqlite_master WHERE type='table' AND "
            "name='_migrations'\"\n"
            "Only if THAT shows an unexpected schema is dropping the "
            "table (npx wrangler d1 execute "
            f"{database_name} --remote --command=\"DROP TABLE "
            "_migrations\") and re-running the right move — safe here "
            "because no migration has successfully completed against "
            "this database yet — there is nothing legitimate to lose."
        )
    return {row["filename"]: row.get("checksum", "") for row in rows}


def apply_remote(
    database_name: str,
    dry_run: bool,
    refresh_checksums: bool,
    migrations_dir: Path = DEFAULT_MIGRATIONS_DIR,
) -> None:
    migrations = load_migrations(migrations_dir)
    stored = remote_applied_checksums(database_name)
    applied = set(stored)
    pending = [m for m in migrations if m.filename not in applied]

    # Drift first, and BEFORE the nothing-to-apply return — decision
    # 0076. An applied migration edited with no new migration to apply
    # is exactly the case --refresh-checksums exists for, and the old
    # early return made it unreachable.
    drift = [
        m
        for m in migrations
        if m.filename in stored and stored[m.filename] and stored[m.filename] != m.checksum
    ]
    if drift:
        if refresh_checksums:
            for m in drift:
                print(f"refresh-checksums: {m.filename} changed since it was applied")
                result = _run_wrangler_command(
                    database_name,
                    f"UPDATE {BOOKKEEPING_TABLE} SET checksum = '{m.checksum}' "
                    f"WHERE filename = '{m.filename}'",
                )
                if result.returncode != 0:
                    raise RuntimeError(f"could not refresh the checksum for {m.filename}:\n{result.stderr}")
                print(f"  recorded {m.checksum[:12]}...")
        else:
            names = ", ".join(m.filename for m in drift)
            raise RuntimeError(
                f"applied migration(s) edited since being applied: {names}. "
                f"The deployed schema no longer matches the file that claims "
                f"to describe it. If the edit was deliberate — widening a "
                f"standing invariant, correcting a comment — re-run with "
                f"--refresh-checksums, which is the act of saying so."
            )

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
        result = _run_wrangler_sql_file(database_name, full_sql)
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
        # same SQL body — now genuinely checksum-verified, which this
        # comment claimed before anything checked (decision 0076).
        print(f"  applied. checksum {migration.checksum[:12]}...")

    if refresh_checksums and not drift:
        print("refresh-checksums: no drift found — every applied migration "
              "still matches its file.")


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
    parser.add_argument(
        "--migrations-dir",
        default=None,
        help=(
            "Directory containing the *.sql chain to run, for a database "
            "other than vf-app-poc's (default: this script's own "
            "directory, migrations/ at the repo root). Each database gets "
            "its own independent chain and its own _migrations "
            "bookkeeping table on that database — the chains do not "
            "share numbering or state. Example: "
            "--migrations-dir workers/vf-licence/migrations "
            "--database vf-licence-poc"
        ),
    )
    args = parser.parse_args()
    migrations_dir = Path(args.migrations_dir) if args.migrations_dir else DEFAULT_MIGRATIONS_DIR

    if args.replay_only:
        try:
            replay(migrations_dir)
        except (AssertionFailure, ValueError) as exc:
            print(f"REPLAY FAILED: {exc}", file=sys.stderr)
            sys.exit(1)
        except sqlite3.Error as exc:
            # A real constraint violation (FK, CHECK, UNIQUE, NOT NULL)
            # or a genuine SQL syntax error — found live: enabling FK
            # enforcement (above) surfaced this as a raw traceback
            # before this except clause existed. Caught here so it
            # reads the same as every other failure mode this tool
            # produces, not a special case.
            print(f"REPLAY FAILED: {type(exc).__name__}: {exc}", file=sys.stderr)
            sys.exit(1)
        return

    if args.remote:
        try:
            apply_remote(
                args.database,
                dry_run=args.dry_run,
                refresh_checksums=args.refresh_checksums,
                migrations_dir=migrations_dir,
            )
        except (RuntimeError, ChecksumDrift) as exc:
            print(f"ERROR: {exc}", file=sys.stderr)
            sys.exit(1)
        return

    parser.error("specify --replay-only, or --remote (optionally with --dry-run)")


if __name__ == "__main__":
    main()
