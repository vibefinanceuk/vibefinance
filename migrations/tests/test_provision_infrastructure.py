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


class TestOrdering:
    """The control-plane record is written last — decision 0135.

    **Until it is, the customer reads `not-yet-deployed.invalid` and
    `infrastructureProvisioned: false`**, which decision 0011 says a
    fleet tool must treat as "not deployable yet". So a failure at any
    earlier step leaves them honestly unfinished rather than half-real.
    """

    def test_records_where_the_worker_is_after_deploying_it(self):
        # **Asserts the actions, not the headings.** The first version
        # compared the printed step titles, which stay in place whether
        # or not the step beneath them runs — so removing the deploy
        # call entirely left it passing. The third time in a day a check
        # verified the wrong thing.
        result = run(["--customer", "acme", "--environment", "acme-production", "--dry-run"])
        deploy_at = result.stdout.index("would write a wrangler.jsonc")
        record_at = result.stdout.index("would record: instanceUrl")
        assert deploy_at < record_at

    def test_records_the_ids_before_verifying_them(self):
        # The verification has nothing to check otherwise.
        result = run(["--customer", "acme", "--environment", "acme-production", "--dry-run"])
        assert result.stdout.index("would record: d1DatabaseName") < result.stdout.index(
            "verify the manifest"
        )

    def test_says_what_is_still_the_operators_to_do(self):
        # Secrets never travel through the manifest (decision 0009), and
        # Email Routing rules are per source rather than per customer,
        # so both outlive this script.
        result = run(["--customer", "acme", "--environment", "acme-production", "--dry-run"])
        assert "wrangler secret put" in result.stdout
        assert "Email" in result.stdout


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

    def test_needs_the_control_plane_key_too(self):
        # **A second credential, and the reasoning for it** (decision
        # 0136): recording ids by hand produced a wrong bucket name
        # within an hour, and an admin key is strictly less dangerous
        # than the Cloudflare token already here.
        result = run(
            ["--customer", "acme", "--environment", "acme-sandbox-eu"],
            env={
                "CLOUDFLARE_API_TOKEN": "x",
                "CLOUDFLARE_ACCOUNT_ID": "x",
                "VF_LICENCE_ADMIN_KEY": "",
                "VF_LICENCE_URL": "",
            },
        )
        assert result.returncode == 2
        assert "VF_LICENCE_ADMIN_KEY" in result.stderr

    def test_runs_every_step_now(self):
        # The script stopped at the Worker until the manifest could
        # supply its config. It no longer does, and a test asserting it
        # stops would be defending the old behaviour.
        result = run(["--customer", "acme", "--environment", "acme-sandbox-eu", "--dry-run"])
        assert result.returncode == 0
        assert "Done." in result.stdout
