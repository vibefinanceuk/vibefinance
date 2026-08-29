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
import sys
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


if __name__ == "__main__":
    unittest.main()
