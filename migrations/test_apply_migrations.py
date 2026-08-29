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


class EnsureRemoteBookkeepingTest(unittest.TestCase):
    def test_calls_wrangler_with_create_if_not_exists_ddl(self):
        with patch("apply_migrations.subprocess.run", return_value=fake_completed()) as run:
            am.ensure_remote_bookkeeping("some-db")
        args = run.call_args.args[0]
        self.assertIn("wrangler", args)
        self.assertIn("some-db", args)
        self.assertIn("--remote", args)
        # The whole point of this function: idempotent, so it's safe to
        # call on every --remote invocation, not just the first.
        command_arg = args[args.index("--command") + 1]
        self.assertIn("CREATE TABLE IF NOT EXISTS", command_arg)

    def test_raises_on_wrangler_failure(self):
        with patch(
            "apply_migrations.subprocess.run",
            return_value=fake_completed(returncode=1, stderr="not logged in"),
        ):
            with self.assertRaises(RuntimeError):
                am.ensure_remote_bookkeeping("some-db")


class RemoteAppliedFilenamesTest(unittest.TestCase):
    def test_ensures_bookkeeping_before_querying_it(self):
        # This is the exact bug being fixed: querying _migrations before
        # confirming it exists fails on a brand-new database. Assert the
        # ordering, not just the end result, so a future refactor can't
        # silently reintroduce it by reordering the two calls.
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


if __name__ == "__main__":
    unittest.main()
