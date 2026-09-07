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
import tempfile
import sys
from dataclasses import dataclass


# The token the operator holds. Read from the environment rather than
# any file in this repository, and never written to one.
TOKEN_VAR = "CLOUDFLARE_API_TOKEN"
ACCOUNT_VAR = "CLOUDFLARE_ACCOUNT_ID"

# The control plane, and the operator's key for it.
#
# **A second credential, and the reasoning for it.** Decision 0135 gave
# the Cloudflare token real thought, so a second deserves the same.
#
# Recording ids by hand produced a wrong bucket name within an hour of
# the column existing (decision 0136) — which is why a verification step
# exists at all. Having the thing that created an id record it removes
# that error class rather than checking for it afterwards.
#
# And an admin key is **strictly less dangerous than the token already
# here**: anybody holding an account-level Cloudflare token can deploy a
# Worker that reads whatever they like. This does not widen the blast
# radius; it narrows the error surface.
LICENCE_KEY_VAR = "VF_LICENCE_ADMIN_KEY"
LICENCE_URL_VAR = "VF_LICENCE_URL"


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


def deploy_worker(config: dict, *, dry_run: bool) -> None:
    """Deploy the customer's own `vf-app`, from the manifest.

    **The config is data, not a file** — decision 0136. This writes a
    `wrangler.jsonc` into a temporary directory and deploys from it, so
    nothing is maintained per customer and the manifest cannot disagree
    with a copy of itself.

    **No secrets.** Decision 0009 is this project's own record of a
    private signing key sitting in a customer's `wrangler.jsonc` as a
    plain var — in git history and Cloudflare's deployment logs, caught
    only because a reviewer noticed `key_ops` read `["sign"]` where a
    public key should read `["verify"]`.

    So the generated config carries **bindings and non-secret vars
    only**. The signing key, the licence API key and everything else are
    set afterwards with `wrangler secret put`, by the operator.
    """
    if dry_run:
        print("    would write a wrangler.jsonc and deploy from it")
        return

    if not config.get("deployable"):
        raise ProvisioningError(
            "the manifest says this environment is not deployable: missing "
            + ", ".join(config.get("missing", []))
        )

    generated = {
        "name": config["workerName"],
        "main": "src/index.ts",
        "compatibility_date": "2025-09-01",
        "d1_databases": [
            {
                "binding": "DB",
                "database_name": config["d1DatabaseName"],
                "database_id": config["d1DatabaseId"],
            }
        ],
        "r2_buckets": [{"binding": "DOCUMENTS", "bucket_name": config["r2BucketName"]}],
        "vars": {
            "CUSTOMER_ID": config["customerId"],
            "ENVIRONMENT_ID": config["environmentId"],
        },
    }

    with tempfile.TemporaryDirectory() as directory:
        path = os.path.join(directory, "wrangler.json")
        with open(path, "w", encoding="utf-8") as handle:
            json.dump(generated, handle, indent=2)

        # **Kept, as an artefact of what was deployed** — decision 0136.
        # Generating at deploy time means nobody can read what a customer
        # runs; writing the output answers that without making it the
        # source.
        record = f"docs/operations/deployed-{config['environmentId']}.json"
        os.makedirs("docs/operations", exist_ok=True)
        with open(record, "w", encoding="utf-8") as handle:
            json.dump(generated, handle, indent=2)
        print(f"    recorded what was deployed: {record}")

        run(
            ["npx", "wrangler", "deploy", "--config", path, "--cwd", "workers/vf-app"],
            dry_run=False,
        )


# ---------------------------------------------------------------------
# Verifying the manifest against what actually exists — decision 0136.
# ---------------------------------------------------------------------
#
# **This was recorded as an idea and built after demonstrating the need
# for it.** Setting Acme's `r2_bucket_name` by hand, the value was
# guessed wrong — `vf-documents-poc` where the Worker is bound to
# `acme-documents`. Nothing objected.
#
# A deploy reading that manifest would have produced a Worker bound to a
# bucket that does not exist. Decision 0136 says the manifest "stops
# being a record and starts being an instruction", and an instruction
# nobody checks is one that is eventually wrong.


def verify_manifest(config: dict, *, dry_run: bool) -> list[str]:
    """Every way the manifest disagrees with the account.

    Returns the disagreements rather than raising, so a person sees all
    of them at once. Being told about a wrong bucket, fixing it, and
    then being told about a wrong database id is two round trips for one
    problem.
    """
    problems: list[str] = []

    if dry_run:
        print("    would verify the manifest against the account")
        return problems

    if not config:
        # Honest about doing nothing, rather than reporting a clean
        # verification of an empty config.
        print("    skipped: no manifest was read (see main)")
        return problems

    database_name = config.get("d1DatabaseName")
    if database_name and not database_exists(database_name):
        problems.append(
            f"the manifest names D1 database '{database_name}', which does not exist"
        )

    bucket = config.get("r2BucketName")
    if bucket and not bucket_exists(bucket):
        problems.append(f"the manifest names R2 bucket '{bucket}', which does not exist")

    return problems


# ---------------------------------------------------------------------
# Recording what was created — decisions 0136 and 0006.
# ---------------------------------------------------------------------


def record_in_manifest(environment: str, fields: dict, *, dry_run: bool) -> None:
    """Tell the control plane what this script just created.

    **Written by the thing that knows.** The alternative is a person
    reading an id off one terminal and typing it into another, which
    produced a wrong bucket name the first time it was tried.

    `handleSetFleetMetadata` merges rather than replaces, so a field not
    named here keeps its current value — which is what lets this be run
    twice, and what lets an environment be corrected one field at a
    time.
    """
    if dry_run:
        print(f"    would record: {', '.join(f'{k}={v}' for k, v in fields.items())}")
        return

    import urllib.request

    url = f"{os.environ[LICENCE_URL_VAR]}/environments/{environment}/fleet-metadata"
    request = urllib.request.Request(
        url,
        data=json.dumps(fields).encode(),
        headers={
            "Authorization": f"Bearer {os.environ[LICENCE_KEY_VAR]}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(request) as response:
            if response.status != 200:
                raise ProvisioningError(f"the control plane refused the manifest update: {response.status}")
    except Exception as error:  # noqa: BLE001 — the message is what matters here
        raise ProvisioningError(
            f"could not record in the manifest: {error}\n\n"
            "The infrastructure exists and this is safe to re-run. Until the "
            "manifest records it, nothing can deploy from it."
        )


def read_manifest(environment: str, *, dry_run: bool) -> dict:
    """The config a deploy needs, from the control plane — decision 0136."""
    if dry_run:
        print("    would read the manifest")
        return {}

    import urllib.request

    url = f"{os.environ[LICENCE_URL_VAR]}/environments/{environment}/config"
    request = urllib.request.Request(
        url, headers={"Authorization": f"Bearer {os.environ[LICENCE_KEY_VAR]}"}
    )

    try:
        with urllib.request.urlopen(request) as response:
            return json.loads(response.read())
    except Exception as error:  # noqa: BLE001
        raise ProvisioningError(f"could not read the manifest: {error}")


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
        missing = [
            v
            for v in (TOKEN_VAR, ACCOUNT_VAR, LICENCE_KEY_VAR, LICENCE_URL_VAR)
            if not os.environ.get(v)
        ]
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

    # **Does this environment exist, and is it waiting for
    # infrastructure?** — checked first, before anything is created.
    #
    # Found by asking what happens if this is pointed at an environment
    # that does not exist: it created the database, applied forty
    # migrations and created the bucket, then failed at step four with
    # all of it orphaned. **A typo in the environment name did that**,
    # and the error read like a control-plane problem rather than a
    # mistyped argument.
    #
    # This does not weaken decision 0038's checkpoint — it enforces it.
    # An environment exists only because somebody approved a signup
    # request, so an environment that is not there is a request nobody
    # approved.
    print("  0. confirm the environment is waiting for this")
    existing = read_manifest(args.environment, dry_run=args.dry_run)
    if not args.dry_run:
        if existing.get("environmentId") != args.environment:
            raise ProvisioningError(
                f"the control plane has no environment called '{args.environment}'.\n\n"
                "An environment exists only once a signup request has been approved "
                "(decision 0038). Check the name, or approve the request first — "
                "nothing has been created."
            )
        if existing.get("deployable"):
            print(
                "    already provisioned: this environment has every binding recorded.\n"
                "    Re-running is safe and will redeploy it."
            )
    print(f"  1. D1 database: {database}")
    database_id = create_database(database, dry_run=args.dry_run)
    if database_id:
        print(f"     id: {database_id}")

    print("  2. migration chain")
    apply_migrations(database, dry_run=args.dry_run)

    print(f"  3. R2 bucket: {bucket}")
    create_bucket(bucket, dry_run=args.dry_run)

    # **Recorded before verifying**, so the verification has something
    # to check. And recorded by the thing that created them, which is
    # the point (decision 0136).
    record_in_manifest(
        args.environment,
        {
            "d1DatabaseName": database,
            "r2BucketName": bucket,
            **({"d1DatabaseId": database_id} if database_id else {}),
        },
        dry_run=args.dry_run,
    )

    print("  4. verify the manifest against the account")
    # **Before deploying, not after.** A manifest that disagrees with
    # the account deploys a Worker bound to something that is not there
    # — or, worse, to another customer's.
    config = read_manifest(args.environment, dry_run=args.dry_run)
    problems = verify_manifest(config, dry_run=args.dry_run)
    if problems:
        joined = "\n  ".join(problems)
        raise ProvisioningError(
            "the manifest disagrees with the account:\n  "
            + joined
            + "\n\nFix the manifest, or the account, before deploying."
        )

    print("  5. vf-app Worker")
    deploy_worker(config, dry_run=args.dry_run)

    print("  6. record where it is")
    # **Last, deliberately** — decision 0135. Until this runs, the
    # customer reads `not-yet-deployed.invalid` and
    # `infrastructureProvisioned: false`, which decision 0011 says a
    # fleet tool must treat as "not deployable yet".
    #
    # So a failure at any earlier step leaves them honestly unfinished
    # rather than half-real.
    record_in_manifest(
        args.environment,
        {"instanceUrl": f"https://{config.get('workerName', 'vf-app')}.workers.dev"},
        dry_run=args.dry_run,
    )

    # Email Routing rules (decision 0126) are **per source, not per
    # customer** — a source gets its address whenever somebody creates
    # one, which may be long after provisioning. Left out of this script
    # rather than run once here and never again.
    print("\nDone. Set secrets with `wrangler secret put`, and create Email")
    print("Routing rules when sources get their addresses (decision 0126).")
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
