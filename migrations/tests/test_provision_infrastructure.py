"""Tests for the provisioning script — decision 0135.

**A provisioning script that goes wrong is expensive**, and every
failure mode here is one a person discovers with a half-created customer
in their account.

Run with: python3 -m pytest migrations/tests/ -q
"""

import os
import subprocess
import sys

SCRIPT = "migrations/provision_infrastructure.py"


def run(args, env=None):
    return subprocess.run(
        [sys.executable, SCRIPT, *args],
        capture_output=True,
        text=True,
        env={**os.environ, **(env or {})},
    )


class TestDryRun:
    """The dry run is promised to need no credentials.

    **It did not, at first.** `apply_migrations.py --dry-run` still
    reaches the network to ask which migrations are recorded as applied
    — reasonable for a database that exists, wrong for one that has not
    been created. Found by running it.
    """

    def test_needs_no_token(self):
        result = run(
            ["--customer", "acme", "--environment", "acme-production", "--dry-run"],
            env={"CLOUDFLARE_API_TOKEN": "", "CLOUDFLARE_ACCOUNT_ID": ""},
        )
        assert "CLOUDFLARE_API_TOKEN" not in result.stderr

    def test_touches_nothing(self):
        result = run(["--customer", "acme", "--environment", "acme-production", "--dry-run"])
        # Every command is described rather than run.
        assert "would run: npx wrangler d1 create" in result.stdout
        assert "would run: npx wrangler r2 bucket create" in result.stdout

    def test_names_the_migration_chain_without_reading_a_database(self):
        result = run(["--customer", "acme", "--environment", "acme-production", "--dry-run"])
        assert "would apply" in result.stdout
        assert "0001_rule_engine_schema.sql" in result.stdout

    def test_derives_the_bucket_from_the_environment(self):
        # A bucket named after the customer rather than the environment
        # would be shared between a sandbox and production, which
        # decision 0118 provisions as separate.
        result = run(["--customer", "acme", "--environment", "acme-sandbox", "--dry-run"])
        assert "acme-sandbox-documents" in result.stdout


class TestStoppingHonestly:
    """A failure must leave the customer readable as not-yet-provisioned."""

    def test_stops_at_the_worker_rather_than_claiming_success(self):
        # **A script reporting success having skipped the step that
        # makes an instance reachable would be worse than one that
        # stops.**
        result = run(["--customer", "acme", "--environment", "acme-production", "--dry-run"])
        assert result.returncode == 1
        assert "not implemented" in result.stderr

    def test_says_what_a_failure_left_behind(self):
        result = run(["--customer", "acme", "--environment", "acme-production", "--dry-run"])
        assert "infrastructureProvisioned: false" in result.stderr
        assert "not-yet-deployed.invalid" in result.stderr

    def test_says_earlier_steps_are_safe_to_re_run(self):
        # The thing a person needs to know at 6pm with half a customer
        # created.
        result = run(["--customer", "acme", "--environment", "acme-production", "--dry-run"])
        assert "safe to re-run" in result.stderr


class TestCredentials:
    """The token is the operator's, and lives in their environment."""

    def test_refuses_a_real_run_with_no_token(self):
        result = run(
            ["--customer", "acme", "--environment", "acme-production"],
            env={"CLOUDFLARE_API_TOKEN": "", "CLOUDFLARE_ACCOUNT_ID": ""},
        )
        assert result.returncode == 2
        assert "CLOUDFLARE_API_TOKEN" in result.stderr

    def test_says_where_the_token_belongs(self):
        # Not in this repository, and not in any Worker (0135).
        result = run(
            ["--customer", "acme", "--environment", "acme-production"],
            env={"CLOUDFLARE_API_TOKEN": "", "CLOUDFLARE_ACCOUNT_ID": ""},
        )
        assert "never in this repository" in result.stderr

    def test_names_both_missing_variables_at_once(self):
        # Telling somebody about one, then the other, is two round trips
        # for one mistake.
        result = run(
            ["--customer", "acme", "--environment", "acme-production"],
            env={"CLOUDFLARE_API_TOKEN": "", "CLOUDFLARE_ACCOUNT_ID": ""},
        )
        assert "CLOUDFLARE_API_TOKEN" in result.stderr
        assert "CLOUDFLARE_ACCOUNT_ID" in result.stderr


class TestArguments:
    def test_requires_a_customer_and_an_environment(self):
        # Provisioning the wrong environment is not something to make
        # easy by defaulting.
        assert run(["--dry-run"]).returncode != 0
        assert run(["--customer", "acme", "--dry-run"]).returncode != 0


class TestManifestVerification:
    """Built after demonstrating the need for it — decision 0136.

    Setting Acme's `r2_bucket_name` by hand, the value was **guessed
    wrong**: `vf-documents-poc` where the Worker is bound to
    `acme-documents`. Nothing objected.

    A deploy reading that manifest would have produced a Worker bound to
    a bucket that does not exist. Decision 0136 says the manifest *"stops
    being a record and starts being an instruction"* — and an
    instruction nobody checks is one that is eventually wrong.
    """

    def test_verifies_before_deploying_not_after(self):
        # A Worker bound to something that is not there is not a thing
        # to discover afterwards.
        result = run(["--customer", "acme", "--environment", "acme-sandbox-eu", "--dry-run"])
        verify_at = result.stdout.index("verify the manifest")
        deploy_at = result.stdout.index("vf-app Worker")
        assert verify_at < deploy_at

    def test_says_it_is_skipping_rather_than_reporting_success(self):
        # **Honest about doing nothing.** Reading the real manifest
        # needs an admin key alongside the Cloudflare token, and
        # reporting a clean verification of an empty config would be
        # worse than saying so.
        result = run(["--customer", "acme", "--environment", "acme-sandbox-eu"])
        assert result.returncode == 2  # no credentials, which is a different stop

    def test_the_stop_message_names_what_remains(self):
        # It said the config question was undecided, which 0136
        # answered. A message that goes stale sends somebody to reopen a
        # settled decision.
        result = run(["--customer", "acme", "--environment", "acme-sandbox-eu", "--dry-run"])
        assert "0136" in result.stderr
        assert "undecided" not in result.stderr
