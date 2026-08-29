#!/usr/bin/env python3
"""Tests for the parts of apply_migrations.py that would otherwise only
be exercised by an operator running --remote against real Cloudflare
credentials this session doesn't have. subprocess.run is mocked so these
check the script's own logic — command construction, JSON parsing,
error handling — not wrangler or D1 themselves. --replay-only has its
own, much stronger coverage: it runs for real against an in-memory
SQLite database with no mocking at all.

Run with: python3 migrations/test_apply_migrations.py
"""

import json
import os
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parent))
import apply_migrations as am


def fake_completed(returncode=0, stdout="", stderr=""):
    result = MagicMock()
    result.returncode = returncode
    result.stdout = stdout
    result.stderr = stderr
    return result


def get_file_path_from_args(args) -> str:
    for arg in args:
        if arg.startswith("--file="):
            return arg[len("--file=") :]
    raise AssertionError(f"no --file=... argument found in {args!r}")


class ParseWranglerJsonTest(unittest.TestCase):
    """Covers a real live failure: json.loads(result.stdout) raised
    JSONDecodeError with no visible wrangler output anywhere in the
    error, making it undiagnosable from the traceback alone."""

    def test_parses_clean_json_directly(self):
        payload = am.parse_wrangler_json(
            json.dumps([{"results": []}]), "", context="test"
        )
        self.assertEqual(payload, [{"results": []}])

    def test_recovers_json_preceded_by_a_banner_line(self):
        noisy = "⛅️ wrangler 4.45.3\nSome status line\n" + json.dumps([{"results": []}])
        payload = am.parse_wrangler_json(noisy, "", context="test")
        self.assertEqual(payload, [{"results": []}])

    def test_genuinely_empty_stdout_raises_with_stdout_and_stderr_visible(self):
        # This is the exact live failure this covers: json.loads("")
        # used to raise JSONDecodeError with nothing else in the error
        # message. The fix must put the raw output IN the exception, so
        # the next failure report is diagnosable without another
        # round trip.
        with self.assertRaises(RuntimeError) as ctx:
            am.parse_wrangler_json("", "some stderr content", context="a test query")
        message = str(ctx.exception)
        self.assertIn("a test query", message)
        self.assertIn("some stderr content", message)

    def test_unparseable_garbage_raises_with_the_garbage_visible(self):
        with self.assertRaises(RuntimeError) as ctx:
            am.parse_wrangler_json("not json at all {{{", "", context="a test query")
        self.assertIn("not json at all", str(ctx.exception))


class RunWranglerSqlFileTest(unittest.TestCase):
    """Covers the fix made after a real --remote run against actual
    Cloudflare infrastructure failed with a confusing "Unknown argument"
    error when SQL was inlined via --command. Not reproduced from a bug
    report in the abstract — this is the literal shape of what broke."""

    def test_writes_sql_to_a_file_and_uses_the_file_flag_not_command(self):
        captured = {}

        def record(args, **kwargs):
            captured["args"] = args
            path = get_file_path_from_args(args)
            captured["file_contents_at_call_time"] = Path(path).read_text()
            return fake_completed()

        with patch("apply_migrations.subprocess.run", side_effect=record):
            am._run_wrangler_sql_file("some-db", "CREATE TABLE x (id TEXT);")

        args = captured["args"]
        self.assertTrue(
            any(a.startswith("--file=") for a in args),
            f"expected a --file=... argument, got {args!r}",
        )
        self.assertNotIn(
            "--command", args, "must not fall back to --command — that's the bug this fixes"
        )
        self.assertEqual(captured["file_contents_at_call_time"], "CREATE TABLE x (id TEXT);")

    def test_temp_file_is_removed_after_the_call(self):
        captured_path = {}

        def record(args, **kwargs):
            captured_path["path"] = get_file_path_from_args(args)
            return fake_completed()

        with patch("apply_migrations.subprocess.run", side_effect=record):
            am._run_wrangler_sql_file("some-db", "SELECT 1;")

        self.assertFalse(
            os.path.exists(captured_path["path"]),
            "temp file must be cleaned up, not left behind on every migration run",
        )

    def test_adds_json_flag_when_requested(self):
        with patch("apply_migrations.subprocess.run", return_value=fake_completed()) as run:
            am._run_wrangler_sql_file("some-db", "SELECT 1;", json_output=True)
        self.assertIn("--json", run.call_args.args[0])

    def test_omits_json_flag_by_default(self):
        with patch("apply_migrations.subprocess.run", return_value=fake_completed()) as run:
            am._run_wrangler_sql_file("some-db", "SELECT 1;")
        self.assertNotIn("--json", run.call_args.args[0])

    def test_includes_yes_flag_to_avoid_hanging_on_confirmation_prompt(self):
        # wrangler d1 execute --remote can prompt for interactive
        # confirmation; Cloudflare's own docs recommend --yes for
        # CI/automation. A subprocess has no TTY to answer that prompt.
        with patch("apply_migrations.subprocess.run", return_value=fake_completed()) as run:
            am._run_wrangler_sql_file("some-db", "SELECT 1;")
        self.assertIn("--yes", run.call_args.args[0])


class EnsureRemoteBookkeepingTest(unittest.TestCase):
    def test_calls_wrangler_with_create_if_not_exists_ddl(self):
        captured = {}

        def record(args, **kwargs):
            path = get_file_path_from_args(args)
            captured["contents"] = Path(path).read_text()
            return fake_completed()

        with patch("apply_migrations.subprocess.run", side_effect=record):
            am.ensure_remote_bookkeeping("some-db")
        # The whole point of this function: idempotent, so it's safe to
        # call on every --remote invocation, not just the first.
        self.assertIn("CREATE TABLE IF NOT EXISTS", captured["contents"])

    def test_raises_on_wrangler_failure(self):
        with patch(
            "apply_migrations.subprocess.run",
            return_value=fake_completed(returncode=1, stderr="not logged in"),
        ):
            with self.assertRaises(RuntimeError):
                am.ensure_remote_bookkeeping("some-db")


class RemoteAppliedFilenamesTest(unittest.TestCase):
    def test_ensures_bookkeeping_before_querying_it(self):
        # The bug this covers: querying _migrations before confirming it
        # exists fails on a brand-new database. Assert the ordering, not
        # just the end result, so a future refactor can't silently
        # reintroduce it by reordering the two calls.
        calls = []

        def record_and_respond(args, **kwargs):
            calls.append(args)
            if "--json" in args:
                payload = [{"results": [{"filename": "0001_x.sql"}]}]
                return fake_completed(stdout=json.dumps(payload))
            return fake_completed()

        with patch("apply_migrations.subprocess.run", side_effect=record_and_respond):
            result = am.remote_applied_filenames("some-db")

        self.assertEqual(result, {"0001_x.sql"})
        self.assertEqual(len(calls), 2, "expected exactly one DDL call and one SELECT call")
        self.assertNotIn("--json", calls[0], "the DDL call must not be the --json SELECT")
        self.assertIn("--json", calls[1])

    def test_empty_remote_returns_empty_set_not_an_error(self):
        def record_and_respond(args, **kwargs):
            if "--json" in args:
                return fake_completed(stdout=json.dumps([{"results": []}]))
            return fake_completed()

        with patch("apply_migrations.subprocess.run", side_effect=record_and_respond):
            result = am.remote_applied_filenames("some-db")
        self.assertEqual(result, set())

    def test_rows_missing_filename_key_raise_diagnosable_error_not_a_keyerror(self):
        # Reproduces the exact live failure: rows came back from wrangler
        # but without a "filename" key, causing a bare KeyError with no
        # explanation.
        def record_and_respond(args, **kwargs):
            if "--json" in args:
                payload = [{"results": [{"some_other_column": "x"}]}]
                return fake_completed(stdout=json.dumps(payload))
            return fake_completed()

        with patch("apply_migrations.subprocess.run", side_effect=record_and_respond):
            with self.assertRaises(RuntimeError) as ctx:
                am.remote_applied_filenames("vf-app-poc")

        message = str(ctx.exception)
        self.assertNotIsInstance(ctx.exception, KeyError)
        self.assertIn("some_other_column", message)
        self.assertIn("vf-app-poc", message, "the diagnostic command shown must target the real database")

    def test_reproduces_the_exact_import_stats_shape_seen_live(self):
        # The literal row reported back after the --yes fix:
        # {'Total queries executed': 1, 'Rows read': 1, 'Rows written': 0,
        #  'Database size (MB)': '0.02'} — import/upload statistics, not
        # query results. Root cause: the SELECT was going through --file,
        # which routes through a bulk-import path instead of returning
        # row data. This test locks in that the SELECT now goes through
        # --command instead, which is what fixes it.
        def record_and_respond(args, **kwargs):
            if any(a.startswith("--command=SELECT filename") for a in args):
                payload = [{"results": [{"filename": "0001_rule_engine_schema.sql"}]}]
                return fake_completed(stdout=json.dumps(payload))
            if any(a.startswith("--file=") for a in args):
                # What --file actually returned live, reproduced exactly.
                stats = [
                    {
                        "results": [
                            {
                                "Total queries executed": 1,
                                "Rows read": 1,
                                "Rows written": 0,
                                "Database size (MB)": "0.02",
                            }
                        ]
                    }
                ]
                return fake_completed(stdout=json.dumps(stats))
            return fake_completed()

        with patch("apply_migrations.subprocess.run", side_effect=record_and_respond):
            result = am.remote_applied_filenames("vf-app-poc")

        self.assertEqual(result, {"0001_rule_engine_schema.sql"})

    def test_select_query_uses_command_not_file(self):
        calls = []

        def record_and_respond(args, **kwargs):
            calls.append(args)
            if "--json" in args:
                return fake_completed(stdout=json.dumps([{"results": []}]))
            return fake_completed()

        with patch("apply_migrations.subprocess.run", side_effect=record_and_respond):
            am.remote_applied_filenames("some-db")

        select_call = calls[1]
        self.assertTrue(
            any(a.startswith("--command=") for a in select_call),
            f"expected the SELECT to use --command, got {select_call!r}",
        )
        self.assertFalse(
            any(a.startswith("--file=") for a in select_call),
            "the SELECT must not use --file — that's the bug this fixes "
            "(--file returns import stats, not row data)",
        )


class ApplyRemoteTest(unittest.TestCase):
    def test_pending_migration_is_applied_via_file_not_command(self):
        calls = []

        def record_and_respond(args, **kwargs):
            calls.append(args)
            if "--json" in args:
                return fake_completed(stdout=json.dumps([{"results": []}]))
            return fake_completed()

        with patch("apply_migrations.subprocess.run", side_effect=record_and_respond):
            am.apply_remote("some-db", dry_run=False, refresh_checksums=False)

        self.assertGreaterEqual(len(calls), 2, "expected at least the bookkeeping + query + apply calls")
        for call_args in calls:
            self.assertNotIn(
                "--command", call_args, "no wrangler d1 execute call should use --command"
            )

    def test_dry_run_makes_no_apply_call(self):
        calls = []

        def record_and_respond(args, **kwargs):
            calls.append(args)
            if "--json" in args:
                return fake_completed(stdout=json.dumps([{"results": []}]))
            return fake_completed()

        with patch("apply_migrations.subprocess.run", side_effect=record_and_respond):
            am.apply_remote("some-db", dry_run=True, refresh_checksums=False)

        # Only the bookkeeping-ensure and the SELECT should have run —
        # nothing that would actually write the migration's DDL.
        self.assertEqual(len(calls), 2)


class ForeignKeyEnforcementTest(unittest.TestCase):
    """Covers a real gap found while testing the vf-licence chain: D1
    enforces foreign keys by default (confirmed against Cloudflare's
    own D1 docs, not assumed), but plain SQLite — and therefore Python's
    sqlite3 module, and therefore --replay-only before this fix — does
    not. Without PRAGMA foreign_keys = ON, replay could pass on an FK
    violation that real D1 would reject, making the local check weaker
    than production for exactly the kind of mistake foreign keys exist
    to catch."""

    def test_replay_rejects_a_row_violating_a_foreign_key(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            (tmp_path / "0001_fk_test.sql").write_text(
                "CREATE TABLE parents (id TEXT PRIMARY KEY);\n"
                "CREATE TABLE children (id TEXT PRIMARY KEY, parent_id TEXT REFERENCES parents(id));\n"
                "INSERT INTO children (id, parent_id) VALUES ('c1', 'does-not-exist');\n"
            )
            with self.assertRaises(sqlite3.IntegrityError):
                am.replay(migrations_dir=tmp_path, verbose=False)

    def test_replay_accepts_a_row_that_satisfies_its_foreign_key(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            (tmp_path / "0001_fk_test.sql").write_text(
                "CREATE TABLE parents (id TEXT PRIMARY KEY);\n"
                "CREATE TABLE children (id TEXT PRIMARY KEY, parent_id TEXT REFERENCES parents(id));\n"
                "INSERT INTO parents (id) VALUES ('p1');\n"
                "INSERT INTO children (id, parent_id) VALUES ('c1', 'p1');\n"
            )
            # Should not raise.
            am.replay(migrations_dir=tmp_path, verbose=False)


class MigrationsDirParameterTest(unittest.TestCase):
    """Covers --migrations-dir, added so vf-licence's control-plane
    schema can have its own independent chain against a different
    database without duplicating the runner. load_migrations() defaults
    to DEFAULT_MIGRATIONS_DIR (this script's own directory) when no
    directory is given, preserving the original vf-app-poc behaviour
    unchanged."""

    def test_replay_uses_the_given_directory_not_the_default(self):
        import io
        import contextlib

        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            (tmp_path / "0001_other_schema.sql").write_text(
                "CREATE TABLE customers (id TEXT PRIMARY KEY);\n"
                "-- ASSERT: SELECT count(*) FROM customers == 0\n"
            )
            captured = io.StringIO()
            with contextlib.redirect_stdout(captured):
                am.replay(migrations_dir=tmp_path, verbose=True)
            output = captured.getvalue()

            # The weak version of this test only checked replay() didn't
            # raise — which it wouldn't even if the default vf-app-poc
            # chain ran instead, since that chain is self-consistent on
            # its own. Checking exactly which filename got printed is
            # what actually distinguishes "used the given directory"
            # from "silently fell back to the default".
            self.assertIn("0001_other_schema.sql", output)
            self.assertNotIn("0001_rule_engine_schema.sql", output)

    def test_default_directory_is_unaffected_when_none_is_given(self):
        # The real regression this guards against: a refactor that
        # changes the default parameter value, silently breaking every
        # existing --replay-only invocation for vf-app-poc that doesn't
        # pass --migrations-dir.
        migrations = am.load_migrations()
        filenames = {m.filename for m in migrations}
        self.assertIn("0001_rule_engine_schema.sql", filenames)

    def test_load_migrations_from_a_custom_directory_finds_only_that_directorys_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp_path = Path(tmp)
            (tmp_path / "0001_control_plane.sql").write_text("CREATE TABLE x (id TEXT);\n")
            migrations = am.load_migrations(migrations_dir=tmp_path)
            filenames = {m.filename for m in migrations}
            self.assertEqual(filenames, {"0001_control_plane.sql"})


if __name__ == "__main__":
    unittest.main()
