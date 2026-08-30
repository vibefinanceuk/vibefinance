"""Tests for migrations/migrate_all.py.

This exercises the orchestration logic — fetching the fleet manifest,
deciding what to skip, running each customer's migration, continuing
past a failure, and building the final summary — with the HTTP call
and subprocess call both faked. It does NOT exercise a real network
call to vf-licence or a real `wrangler d1 execute --remote` call:
neither this test suite nor the development session that wrote it has
Cloudflare credentials to do either for real. See migrate_all.py's own
module docstring, and docs/decisions/0011-fleet-tooling.md.
"""

from __future__ import annotations

import json
import subprocess
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from unittest.mock import MagicMock, patch

from migrate_all import (  # noqa: E402
    FleetCustomer,
    MigrationResult,
    _real_http_get,
    fetch_fleet,
    format_summary,
    migrate_all,
    migrate_one,
)

FAKE_SCRIPT = Path("/fake/apply_migrations.py")


def fake_subprocess_result(returncode: int, stdout: str = "", stderr: str = "") -> subprocess.CompletedProcess:
    return subprocess.CompletedProcess(args=[], returncode=returncode, stdout=stdout, stderr=stderr)


class TestFetchFleet(unittest.TestCase):
    def test_parses_a_real_shaped_response(self):
        def fake_get(url, headers):
            self.assertEqual(url, "https://x/customers")
            self.assertEqual(headers["Authorization"], "Bearer real-admin-key")
            body = json.dumps({
                "customers": [
                    {"id": "acme", "d1DatabaseName": "vf-app-poc", "workerName": "vf-app"},
                    {"id": "globex", "d1DatabaseName": None, "workerName": None},
                ]
            })
            return 200, body

        customers = fetch_fleet("https://x", "real-admin-key", http_get=fake_get)
        self.assertEqual(len(customers), 2)
        self.assertEqual(
            customers[0],
            FleetCustomer(id="acme", d1_database_name="vf-app-poc", worker_name="vf-app"),
        )
        self.assertEqual(customers[1], FleetCustomer(id="globex", d1_database_name=None))

    def test_raises_with_a_clear_message_on_a_non_200(self):
        def fake_get(url, headers):
            return 401, '{"error":"unauthorized"}'

        with self.assertRaises(RuntimeError) as ctx:
            fetch_fleet("https://x", "wrong-key", http_get=fake_get)
        self.assertIn("401", str(ctx.exception))

    def test_handles_an_empty_fleet(self):
        def fake_get(url, headers):
            return 200, json.dumps({"customers": []})

        self.assertEqual(fetch_fleet("https://x", "key", http_get=fake_get), [])

    def test_parses_the_full_set_of_fields_deploy_all_needs(self):
        def fake_get(url, headers):
            body = json.dumps({
                "customers": [
                    {
                        "id": "acme",
                        "d1DatabaseName": "vf-app-poc",
                        "workerName": "vf-app",
                        "d1DatabaseId": "7cac2188-4fce-46e1-a555-2b2ac852f494",
                        "locale": "en",
                    }
                ]
            })
            return 200, body

        customers = fetch_fleet("https://x", "key", http_get=fake_get)
        self.assertEqual(
            customers[0],
            FleetCustomer(
                id="acme",
                d1_database_name="vf-app-poc",
                worker_name="vf-app",
                d1_database_id="7cac2188-4fce-46e1-a555-2b2ac852f494",
                locale="en",
            ),
        )


class TestMigrateOne(unittest.TestCase):
    def test_skips_a_customer_with_no_database_name(self):
        customer = FleetCustomer(id="globex", d1_database_name=None)
        result = migrate_one(customer, FAKE_SCRIPT)
        self.assertEqual(result.status, "skipped")
        self.assertEqual(result.customer_id, "globex")

    def test_a_skip_never_invokes_the_subprocess_at_all(self):
        calls = []

        def fake_run(args):
            calls.append(args)
            return fake_subprocess_result(0)

        migrate_one(FleetCustomer(id="globex", d1_database_name=None), FAKE_SCRIPT, run_subprocess=fake_run)
        self.assertEqual(calls, [])

    def test_calls_apply_migrations_with_the_right_arguments(self):
        calls = []

        def fake_run(args):
            calls.append(args)
            return fake_subprocess_result(0, stdout="replay OK\n")

        migrate_one(FleetCustomer(id="acme", d1_database_name="vf-app-poc"), FAKE_SCRIPT, run_subprocess=fake_run)
        self.assertEqual(len(calls), 1)
        self.assertIn("--remote", calls[0])
        self.assertIn("--database", calls[0])
        self.assertIn("vf-app-poc", calls[0])
        self.assertIn(str(FAKE_SCRIPT), calls[0])

    def test_reports_success_on_exit_code_zero(self):
        def fake_run(args):
            return fake_subprocess_result(0, stdout="applying 0001...\nreplay OK\n")

        result = migrate_one(FleetCustomer(id="acme", d1_database_name="vf-app-poc"), FAKE_SCRIPT, run_subprocess=fake_run)
        self.assertEqual(result.status, "success")

    def test_reports_failure_on_a_nonzero_exit_code(self):
        def fake_run(args):
            return fake_subprocess_result(1, stderr="REPLAY FAILED: assertion did not hold")

        result = migrate_one(FleetCustomer(id="acme", d1_database_name="vf-app-poc"), FAKE_SCRIPT, run_subprocess=fake_run)
        self.assertEqual(result.status, "failed")
        self.assertIn("assertion did not hold", result.detail)


class TestMigrateAll(unittest.TestCase):
    def test_the_critical_property_a_failure_does_not_stop_the_rest_of_the_fleet(self):
        # customer B's migration fails; customer C must still be attempted.
        attempted = []

        def fake_run(args):
            db_name = args[args.index("--database") + 1]
            attempted.append(db_name)
            if db_name == "db-b":
                return fake_subprocess_result(1, stderr="boom")
            return fake_subprocess_result(0, stdout="replay OK")

        customers = [
            FleetCustomer(id="a", d1_database_name="db-a"),
            FleetCustomer(id="b", d1_database_name="db-b"),
            FleetCustomer(id="c", d1_database_name="db-c"),
        ]
        results = migrate_all(customers, FAKE_SCRIPT, run_subprocess=fake_run)

        # The real assertion: C was attempted at all, despite B failing
        # in between A and C.
        self.assertEqual(attempted, ["db-a", "db-b", "db-c"])
        self.assertEqual([r.status for r in results], ["success", "failed", "success"])

    def test_skipped_customers_are_interleaved_correctly_with_migrated_ones(self):
        def fake_run(args):
            return fake_subprocess_result(0, stdout="replay OK")

        customers = [
            FleetCustomer(id="a", d1_database_name="db-a"),
            FleetCustomer(id="b", d1_database_name=None),
            FleetCustomer(id="c", d1_database_name="db-c"),
        ]
        results = migrate_all(customers, FAKE_SCRIPT, run_subprocess=fake_run)
        self.assertEqual([r.status for r in results], ["success", "skipped", "success"])


class TestRealHttpGet(unittest.TestCase):
    # The one function this whole test file deliberately cannot fully
    # exercise without a real network call — but the request
    # construction itself (which headers get sent) is real code, not
    # network I/O, and is worth testing directly. Found live: a real
    # request without a proper User-Agent was rejected by Cloudflare's
    # own edge-level bot protection (error 1010) before ever reaching
    # vf-licence. This test exists specifically so that regression
    # can't silently reappear.
    def test_sends_a_real_user_agent_and_the_caller_supplied_headers(self):
        captured_request = {}

        def fake_urlopen(req, timeout=30):
            captured_request["headers"] = dict(req.headers)
            captured_request["url"] = req.full_url
            mock_response = MagicMock()
            mock_response.status = 200
            mock_response.read.return_value = b'{"customers":[]}'
            mock_response.__enter__ = lambda self: mock_response
            mock_response.__exit__ = lambda self, *a: None
            return mock_response

        with patch("urllib.request.urlopen", side_effect=fake_urlopen):
            status, body = _real_http_get("https://x/customers", {"Authorization": "Bearer key123"})

        self.assertEqual(status, 200)
        # Request() title-cases header keys internally (e.g. "User-agent").
        headers_lower = {k.lower(): v for k, v in captured_request["headers"].items()}
        self.assertIn("user-agent", headers_lower)
        self.assertNotIn("python-urllib", headers_lower["user-agent"].lower())
        self.assertEqual(headers_lower["authorization"], "Bearer key123")


class TestFormatSummary(unittest.TestCase):
    def test_counts_are_correct(self):
        results = [
            MigrationResult("a", "db-a", "success", "replay OK"),
            MigrationResult("b", "db-b", "failed", "boom"),
            MigrationResult("c", None, "skipped", "no d1_database_name set"),
        ]
        summary = format_summary(results)
        self.assertIn("1 succeeded, 1 failed, 1 skipped", summary)
        self.assertIn("of 3 customers", summary)

    def test_every_customer_id_appears_in_the_summary(self):
        results = [
            MigrationResult("acme", "db-a", "success", "replay OK"),
            MigrationResult("globex", None, "skipped", "no d1_database_name set"),
        ]
        summary = format_summary(results)
        self.assertIn("acme", summary)
        self.assertIn("globex", summary)


if __name__ == "__main__":
    unittest.main()
