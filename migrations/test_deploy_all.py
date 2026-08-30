"""Tests for migrations/deploy_all.py.

Same honest split as test_migrate_all.py: the orchestration logic
(JSONC parsing, config construction, deciding what to skip, continuing
past a failure, the summary) is tested directly, including against the
REAL committed workers/vf-app/wrangler.jsonc. What is NOT tested, and
cannot be from this session: a real `wrangler deploy` subprocess call
— no Cloudflare credentials here, same limitation as migrate_all.py
and every other --remote operation in this project.
"""

from __future__ import annotations

import json
import subprocess
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from deploy_all import (  # noqa: E402
    BASE_CONFIG_PATH,
    DeployResult,
    build_customer_config,
    deploy_all,
    deploy_one,
    format_summary,
    load_base_config,
    strip_jsonc_comments,
)
from migrate_all import FleetCustomer  # noqa: E402

COMPLETE_CUSTOMER = FleetCustomer(
    id="acme",
    d1_database_name="vf-app-acme",
    worker_name="vf-app-acme",
    d1_database_id="db-id-123",
    locale="de",
)


def fake_subprocess_result(returncode: int, stdout: str = "", stderr: str = "") -> subprocess.CompletedProcess:
    return subprocess.CompletedProcess(args=[], returncode=returncode, stdout=stdout, stderr=stderr)


class TestStripJsoncComments(unittest.TestCase):
    def test_strips_a_simple_line_comment(self):
        text = '{\n  "a": 1, // a comment\n  "b": 2\n}'
        result = strip_jsonc_comments(text)
        parsed = json.loads(result)
        self.assertEqual(parsed, {"a": 1, "b": 2})

    def test_the_critical_property_a_double_slash_inside_a_string_value_is_not_stripped(self):
        # This is not a contrived edge case — the real committed
        # wrangler.jsonc contains exactly this shape
        # (LICENCE_SERVER_URL: "https://..."). A naive stripper that
        # doesn't track string state would corrupt this value.
        text = '{\n  "url": "https://example.com/path" // a real comment\n}'
        result = strip_jsonc_comments(text)
        parsed = json.loads(result)
        self.assertEqual(parsed["url"], "https://example.com/path")

    def test_handles_an_escaped_quote_inside_a_string(self):
        text = r'{"a": "he said \"hi\"" }'
        parsed = json.loads(strip_jsonc_comments(text))
        self.assertEqual(parsed["a"], 'he said "hi"')

    def test_a_full_multiline_document_with_several_comments(self):
        text = (
            "{\n"
            '  // top-level comment\n'
            '  "name": "vf-app", // trailing comment\n'
            '  "vars": {\n'
            '    "LICENCE_SERVER_URL": "https://vf-licence.example.workers.dev"\n'
            "  }\n"
            "}\n"
        )
        parsed = json.loads(strip_jsonc_comments(text))
        self.assertEqual(parsed["name"], "vf-app")
        self.assertEqual(parsed["vars"]["LICENCE_SERVER_URL"], "https://vf-licence.example.workers.dev")


class TestLoadBaseConfig(unittest.TestCase):
    def test_parses_the_real_committed_wrangler_jsonc(self):
        # A genuine integration check against the real file, not a
        # fixture — this is exactly the file deploy_all.py will
        # actually read in production.
        config = load_base_config(BASE_CONFIG_PATH)
        self.assertEqual(config["name"], "vf-app")
        self.assertIn("d1_databases", config)
        self.assertEqual(len(config["d1_databases"]), 1)
        self.assertIn("vars", config)
        self.assertIn("CUSTOMER_ID", config["vars"])
        self.assertIn("services", config)


class TestBuildCustomerConfig(unittest.TestCase):
    def setUp(self):
        self.base = load_base_config(BASE_CONFIG_PATH)

    def test_overrides_exactly_the_fields_that_vary_per_customer(self):
        config = build_customer_config(self.base, COMPLETE_CUSTOMER)
        self.assertEqual(config["name"], "vf-app-acme")
        self.assertEqual(config["d1_databases"][0]["database_name"], "vf-app-acme")
        self.assertEqual(config["d1_databases"][0]["database_id"], "db-id-123")
        self.assertEqual(config["vars"]["CUSTOMER_ID"], "acme")
        self.assertEqual(config["vars"]["LOCALE"], "de")

    def test_carries_global_fields_through_unchanged(self):
        config = build_customer_config(self.base, COMPLETE_CUSTOMER)
        self.assertEqual(config["main"], self.base["main"])
        self.assertEqual(config["compatibility_date"], self.base["compatibility_date"])
        self.assertEqual(config["services"], self.base["services"])
        self.assertEqual(config["vars"]["LICENCE_SIGNING_PUBLIC_KEY"], self.base["vars"]["LICENCE_SIGNING_PUBLIC_KEY"])

    def test_defaults_locale_to_en_when_the_customer_has_none_set(self):
        customer = FleetCustomer(
            id="acme", d1_database_name="db", worker_name="w", d1_database_id="id", locale=None
        )
        config = build_customer_config(self.base, customer)
        self.assertEqual(config["vars"]["LOCALE"], "en")

    def test_does_not_mutate_the_base_config_passed_in(self):
        # A real, meaningful property: calling this for customer A must
        # never leak into what customer B's config looks like.
        original_name = self.base["name"]
        build_customer_config(self.base, COMPLETE_CUSTOMER)
        self.assertEqual(self.base["name"], original_name)


class TestDeployOne(unittest.TestCase):
    def setUp(self):
        self.base = load_base_config(BASE_CONFIG_PATH)

    def test_skips_a_customer_with_incomplete_fleet_metadata(self):
        customer = FleetCustomer(id="acme", d1_database_name=None, worker_name=None, d1_database_id=None)
        result = deploy_one(customer, self.base, vf_app_dir=Path("/fake"))
        self.assertEqual(result.status, "skipped")

    def test_a_skip_never_invokes_the_subprocess_at_all(self):
        calls = []

        def fake_run(args, cwd):
            calls.append((args, cwd))
            return fake_subprocess_result(0)

        customer = FleetCustomer(id="acme", d1_database_name=None, worker_name=None, d1_database_id=None)
        deploy_one(customer, self.base, run_subprocess=fake_run, vf_app_dir=Path("/fake"))
        self.assertEqual(calls, [])

    def test_writes_a_real_generated_config_file_and_deploys_with_a_shallow_relative_path(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            vf_app_dir = Path(tmp)
            calls = []

            def fake_run(args, cwd):
                calls.append((args, cwd))
                return fake_subprocess_result(0, stdout="Deployed vf-app-acme\n")

            result = deploy_one(COMPLETE_CUSTOMER, self.base, run_subprocess=fake_run, vf_app_dir=vf_app_dir)

            self.assertEqual(result.status, "success")
            self.assertEqual(len(calls), 1)
            args, cwd = calls[0]
            self.assertEqual(cwd, vf_app_dir)
            self.assertIn("--config", args)
            config_arg = args[args.index("--config") + 1]
            # Shallow, relative, no parent-directory traversal — the
            # exact shape that avoids the known wrangler --config bug.
            self.assertFalse(config_arg.startswith("/"))
            self.assertFalse(config_arg.startswith(".."))

            generated_path = vf_app_dir / config_arg
            self.assertTrue(generated_path.exists())
            written = json.loads(generated_path.read_text())
            self.assertEqual(written["name"], "vf-app-acme")

    def test_reports_failure_on_a_nonzero_exit_code(self):
        import tempfile

        with tempfile.TemporaryDirectory() as tmp:
            def fake_run(args, cwd):
                return fake_subprocess_result(1, stderr="authentication error")

            result = deploy_one(COMPLETE_CUSTOMER, self.base, run_subprocess=fake_run, vf_app_dir=Path(tmp))
            self.assertEqual(result.status, "failed")
            self.assertIn("authentication error", result.detail)


class TestDeployAll(unittest.TestCase):
    def setUp(self):
        self.base = load_base_config(BASE_CONFIG_PATH)

    def test_the_critical_property_a_failure_does_not_stop_the_rest_of_the_fleet(self):
        import tempfile

        attempted = []

        def fake_run(args, cwd):
            config_arg = args[args.index("--config") + 1]
            attempted.append(config_arg)
            if "b" in config_arg:
                return fake_subprocess_result(1, stderr="boom")
            return fake_subprocess_result(0, stdout="Deployed\n")

        customers = [
            FleetCustomer(id="a", d1_database_name="db-a", worker_name="w-a", d1_database_id="id-a"),
            FleetCustomer(id="b", d1_database_name="db-b", worker_name="w-b", d1_database_id="id-b"),
            FleetCustomer(id="c", d1_database_name="db-c", worker_name="w-c", d1_database_id="id-c"),
        ]
        with tempfile.TemporaryDirectory() as tmp:
            results = deploy_all(customers, self.base, run_subprocess=fake_run, vf_app_dir=Path(tmp))

        self.assertEqual(len(attempted), 3)
        self.assertEqual([r.status for r in results], ["success", "failed", "success"])


class TestFormatSummary(unittest.TestCase):
    def test_counts_are_correct(self):
        results = [
            DeployResult("a", "w-a", "success", "Deployed"),
            DeployResult("b", "w-b", "failed", "boom"),
            DeployResult("c", None, "skipped", "incomplete fleet metadata"),
        ]
        summary = format_summary(results)
        self.assertIn("1 succeeded, 1 failed, 1 skipped", summary)


if __name__ == "__main__":
    unittest.main()
