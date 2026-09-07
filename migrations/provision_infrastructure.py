#!/usr/bin/env python3
"""Create a customer's Cloudflare infrastructure — decision 0135.

Decision 0039 built the control-plane half of provisioning: the API key,
the customer, the environment, the trial licence, and the link back to
the signup request. It deliberately does not touch the Cloudflare API,
and reports `infrastructureProvisioned: false` rather than pretending.

This is the other half.

    provision_infrastructure.py --customer acme --environment acme-production
        Create the D1 database, apply the migration chain, create the R2
        bucket, deploy the Worker, create any Email Routing rules, and
        then record the result in the control plane.

    provision_infrastructure.py --customer acme --environment acme-production --dry-run
        Say what would be created, touching nothing. No credentials
        needed, which is what makes it worth running first.

WHY THIS IS A SCRIPT AND NOT A ROUTE
------------------------------------
The API calls are five HTTP requests. **The credential that makes them
is the most dangerous thing this system would hold**: a token that can
create D1 databases and deploy Workers can also delete every customer's
database and replace any Worker with anything.

`vf-licence` is internet-reachable, holds an admin key, and serves every
customer. Giving it account-level write means a flaw in any route
becomes total account compromise (decision 0135).

So the operator runs this, with a token from their own environment — the
same shape as `apply_migrations.py`, which already does the genuinely
dangerous part of the migration story and is trusted because a person
runs it deliberately.

Decision 0038 already puts a person in this loop at approval. This is
not friction being added; it is friction already there.

ORDERING, AND WHAT A FAILURE LEAVES BEHIND
------------------------------------------
Steps run **cheapest-to-undo first**, and the control-plane rows are
written **last**. A failure before the final step leaves the customer
exactly as decision 0039 left them — `not-yet-deployed.invalid` and
`infrastructureProvisioned: false` — which decision 0011 already says a
fleet tool must read as "not deployable yet".

The half-built infrastructure is **orphaned, not deleted**. A database
with no Worker costs nothing and is visible in the dashboard, and an
automatic cleanup would mean the failure path holds delete authority —
the one thing worth not automating.

Every step checks whether its object already exists, so a second run
after a failure continues rather than duplicating.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
from dataclasses import dataclass


# The token the operator holds. Read from the environment rather than
# any file in this repository, and never written to one.
TOKEN_VAR = "CLOUDFLARE_API_TOKEN"
ACCOUNT_VAR = "CLOUDFLARE_ACCOUNT_ID"


class ProvisioningError(Exception):
    """Something failed, and the message says which step."""


@dataclass
class Step:
    """One thing to create, and how to tell whether it already exists.

    `exists` is what makes a second run safe: a step that already
    happened is reported and skipped, so a failure at step four does not
    mean redoing steps one to three by hand.
    """

    name: str
    describe: str


def run(command: list[str], *, dry_run: bool) -> str:
    """Run a wrangler command, or say what would be run.

    Uses `wrangler` rather than the REST API directly, because wrangler
    already handles authentication, account selection and the shape of
    every response — and because an operator debugging this can run the
    same command by hand.
    """
    printable = " ".join(command)
    if dry_run:
        print(f"    would run: {printable}")
        return ""

    result = subprocess.run(command, capture_output=True, text=True)
    if result.returncode != 0:
        raise ProvisioningError(
            f"`{printable}` failed:\n{result.stderr.strip() or result.stdout.strip()}"
        )
    return result.stdout


def database_exists(name: str) -> bool:
    """Whether a D1 database of this name is already there."""
    result = subprocess.run(
        ["npx", "wrangler", "d1", "list", "--json"], capture_output=True, text=True
    )
    if result.returncode != 0:
        return False
    try:
        return any(db.get("name") == name for db in json.loads(result.stdout))
    except json.JSONDecodeError:
        # A wrangler that answered with something other than JSON is a
        # wrangler whose answer this cannot read, and guessing "no" would
        # try to create a database that may already exist.
        raise ProvisioningError("could not read `wrangler d1 list --json` output")


def bucket_exists(name: str) -> bool:
    result = subprocess.run(
        ["npx", "wrangler", "r2", "bucket", "list"], capture_output=True, text=True
    )
    return result.returncode == 0 and name in result.stdout


def create_database(name: str, *, dry_run: bool) -> str | None:
    """Create the D1 database, and return its id.

    The id is what the Worker's binding needs, so this is the one step
    whose *output* matters rather than only its success.
    """
    if not dry_run and database_exists(name):
        print(f"    already exists: {name}")
        return None

    output = run(["npx", "wrangler", "d1", "create", name], dry_run=dry_run)
    if dry_run:
        return None

    # wrangler prints the binding block; the id is the only part needed.
    match = re.search(r'"?database_id"?\s*[:=]\s*"([0-9a-f-]{36})"', output)
    if not match:
        raise ProvisioningError(
            f"created {name} but could not find its id in wrangler's output — "
            "the database exists and this script cannot continue; find the id "
            "with `wrangler d1 list` and re-run"
        )
    return match.group(1)


def apply_migrations(database: str, *, dry_run: bool) -> None:
    """Apply the migration chain to the new database.

    **Delegated, not reimplemented.** `apply_migrations.py` already
    replays against a throwaway copy first, checks every assertion, and
    keeps an idempotent bookkeeping table — decision 0011 calls it the
    genuinely hard part, and a second implementation here would be a
    second thing to get right.
    """
    if dry_run:
        # **`apply_migrations.py --dry-run` still reaches the network**
        # to ask which migrations are recorded as applied — reasonable
        # for a database that exists, and wrong here, where the dry run
        # is promised to need no credentials and the database has not
        # been created.
        #
        # Found by running it: the dry run failed asking for a token.
        chain = sorted(f for f in os.listdir("migrations") if f.endswith(".sql"))
        print(f"    would apply {len(chain)} migrations, {chain[0]} to {chain[-1]}")
        return

    command = [
        sys.executable,
        "migrations/apply_migrations.py",
        "--remote",
        "--database",
        database,
    ]

    result = subprocess.run(command, text=True)
    if result.returncode != 0:
        raise ProvisioningError(f"migrations failed against {database}")


def create_bucket(name: str, *, dry_run: bool) -> None:
    if not dry_run and bucket_exists(name):
        print(f"    already exists: {name}")
        return
    run(["npx", "wrangler", "r2", "bucket", "create", name], dry_run=dry_run)


def deploy_worker(customer: str, *, dry_run: bool) -> None:
    """Deploy the customer's own `vf-app`.

    **Not implemented**, and deliberately not faked. Decision 0011
    records this as the hard part of `deploy-all`: a Worker deployment is
    per-config, needing either a generated `wrangler.jsonc` at deploy
    time or one maintained per customer, and decision 0135 leaves that
    choice open.

    Raising here rather than printing a warning: a script that reports
    success having skipped the step that makes an instance reachable
    would be worse than one that stops.
    """
    raise ProvisioningError(
        "deploying the Worker is not implemented (decision 0135): a deployment is "
        "per-config and whether the config is generated or maintained per customer "
        "is undecided. Everything before this step has been done and is safe to "
        "re-run; deploy by hand and then record the result."
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--customer", required=True, help="the customer id, e.g. acme")
    parser.add_argument(
        "--environment", required=True, help="the environment id, e.g. acme-production"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="say what would be created, touching nothing and needing no credentials",
    )
    args = parser.parse_args()

    if not args.dry_run:
        missing = [v for v in (TOKEN_VAR, ACCOUNT_VAR) if not os.environ.get(v)]
        if missing:
            print(
                f"Set {' and '.join(missing)} first.\n"
                "The token is the operator's, held in their own environment and never "
                "in this repository or any Worker (decision 0135).",
                file=sys.stderr,
            )
            return 2

    database = f"{args.environment}"
    bucket = f"{args.environment}-documents"

    print(f"Provisioning {args.environment} for customer {args.customer}")
    print(f"  1. D1 database: {database}")
    database_id = create_database(database, dry_run=args.dry_run)
    if database_id:
        print(f"     id: {database_id}")

    print("  2. migration chain")
    apply_migrations(database, dry_run=args.dry_run)

    print(f"  3. R2 bucket: {bucket}")
    create_bucket(bucket, dry_run=args.dry_run)

    print("  4. vf-app Worker")
    deploy_worker(args.customer, dry_run=args.dry_run)

    # Steps 5 and 6 — Email Routing rules, and recording the result in
    # the control plane — are unreachable until step 4 exists. Left
    # unwritten rather than written and never run.
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except ProvisioningError as error:
        print(f"\nStopped: {error}", file=sys.stderr)
        print(
            "\nNothing has been recorded in the control plane, so this customer still "
            "reads `infrastructureProvisioned: false` and `not-yet-deployed.invalid` — "
            "which a fleet tool must treat as not deployable (decision 0011).",
            file=sys.stderr,
        )
        sys.exit(1)
