#!/usr/bin/env python3
"""Fleet migration runner (Blueprint build order step 5 — see
docs/decisions/0011-fleet-tooling.md).

Reads the fleet manifest from vf-licence's GET /customers (admin-
authenticated), and for every customer with a real d1_database_name
set, runs this repo's own apply_migrations.py --remote against that
customer's database — the same, already-proven migration runner used
throughout this project, not a reimplementation of it.

    ADMIN_API_KEY=<key> python3 migrations/migrate_all.py
    ADMIN_API_KEY=<key> python3 migrations/migrate_all.py --licence-url https://vf-licence.example.workers.dev

ADMIN_API_KEY is read from the environment, never a CLI argument —
CLI arguments are visible in shell history and process listings; this
matches the same discipline already established for every other
credential in this project (never printed, never committed, never
passed as a plain argument).

Like apply_migrations.py's own --remote mode, this requires real
Cloudflare credentials (via `wrangler`) that this development session
does not have — the operator runs this, never the session. See
docs/change-and-promotion-model.md §9, "never deploy."

Continue-on-error, deliberately: one customer's migration failing must
never prevent the rest of the fleet from being attempted. Every
customer is attempted regardless of what happened to any other; the
script's own exit code (0 if every attempted customer succeeded, 1 if
any failed) is what signals overall success or failure, checked once
at the end, not used to short-circuit the loop.

A customer with no d1_database_name set in the fleet manifest is
skipped, not failed — that is the correct, expected state for a
customer that has been provisioned in vf-licence but not yet deployed
(see docs/decisions/0011-fleet-tooling.md), not an error.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Optional

DEFAULT_LICENCE_URL = "https://vf-licence.vibefinance.workers.dev"


@dataclass
class FleetCustomer:
    id: str
    d1_database_name: Optional[str]


@dataclass
class MigrationResult:
    customer_id: str
    database_name: Optional[str]
    status: str  # "success" | "failed" | "skipped"
    detail: str


HttpGet = Callable[[str, dict], tuple[int, str]]


def _real_http_get(url: str, headers: dict) -> tuple[int, str]:
    # Found live: Cloudflare's own edge-level bot protection returned a
    # plain-text "error code: 1010" (Cloudflare's own error, never
    # reaching the Worker at all — confirmed against Cloudflare's own
    # error-code documentation, not guessed) for this exact request.
    # The most commonly cited cause is Python's urllib default
    # User-Agent ("Python-urllib/3.x"), a well-known, easily
    # fingerprinted non-browser signature. Sent honestly here — this is
    # the operator's own infrastructure, not a third party being
    # scraped, so identifying the tool plainly rather than impersonating
    # a real browser is both the more transparent and the simpler fix.
    full_headers = {
        "User-Agent": "VibeFinance-migrate-all/1.0 (+fleet migration tool)",
        "Accept": "application/json",
        **headers,
    }
    req = urllib.request.Request(url, headers=full_headers)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return resp.status, resp.read().decode("utf-8")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8")


def fetch_fleet(licence_url: str, admin_api_key: str, http_get: Optional[HttpGet] = None) -> list[FleetCustomer]:
    """Fetches the fleet manifest from vf-licence's GET /customers.
    http_get is injectable — this is the seam the test suite uses to
    exercise this function without a real network call, since this
    session has no credentials to reach a live vf-licence deployment."""
    get = http_get or _real_http_get
    status, body = get(f"{licence_url}/customers", {"Authorization": f"Bearer {admin_api_key}"})
    if status != 200:
        raise RuntimeError(f"GET {licence_url}/customers returned HTTP {status}: {body}")
    data = json.loads(body)
    return [
        FleetCustomer(id=c["id"], d1_database_name=c.get("d1DatabaseName"))
        for c in data["customers"]
    ]


RunSubprocess = Callable[[list[str]], "subprocess.CompletedProcess[str]"]


def _real_run_subprocess(args: list[str]) -> "subprocess.CompletedProcess[str]":
    return subprocess.run(args, capture_output=True, text=True)


def migrate_one(
    customer: FleetCustomer,
    migrations_script: Path,
    run_subprocess: Optional[RunSubprocess] = None,
) -> MigrationResult:
    if not customer.d1_database_name:
        return MigrationResult(customer.id, None, "skipped", "no d1_database_name set in the fleet manifest")

    run = run_subprocess or _real_run_subprocess
    result = run([sys.executable, str(migrations_script), "--remote", "--database", customer.d1_database_name])

    if result.returncode == 0:
        last_line = result.stdout.strip().splitlines()[-1] if result.stdout.strip() else "(no output)"
        return MigrationResult(customer.id, customer.d1_database_name, "success", last_line)
    detail = (result.stderr or result.stdout or "(no output)").strip()
    return MigrationResult(customer.id, customer.d1_database_name, "failed", detail)


def migrate_all(
    customers: list[FleetCustomer],
    migrations_script: Path,
    run_subprocess: Optional[RunSubprocess] = None,
) -> list[MigrationResult]:
    """Attempts every customer in turn, regardless of what happened to
    any earlier one — the whole point of this function over just
    calling migrate_one in a loop inline is that this behaviour is
    itself a tested, named property, not an accident of how a loop
    happens to be written."""
    return [migrate_one(c, migrations_script, run_subprocess) for c in customers]


def format_summary(results: list[MigrationResult]) -> str:
    lines = []
    counts = {"success": 0, "failed": 0, "skipped": 0}
    for r in results:
        counts[r.status] += 1
        marker = {"success": "OK", "failed": "FAILED", "skipped": "skip"}[r.status]
        db = r.database_name or "(none)"
        lines.append(f"  [{marker:>6}] {r.customer_id:<20} {db:<24} {r.detail}")
    lines.append("")
    lines.append(
        f"{counts['success']} succeeded, {counts['failed']} failed, {counts['skipped']} skipped "
        f"(of {len(results)} customers in the fleet manifest)"
    )
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "--licence-url",
        default=os.environ.get("VF_LICENCE_URL", DEFAULT_LICENCE_URL),
        help=f"vf-licence base URL (default: env VF_LICENCE_URL, or {DEFAULT_LICENCE_URL})",
    )
    args = parser.parse_args()

    admin_api_key = os.environ.get("ADMIN_API_KEY")
    if not admin_api_key:
        print("ADMIN_API_KEY environment variable is required.", file=sys.stderr)
        sys.exit(2)

    print(f"Fetching fleet manifest from {args.licence_url}/customers ...")
    customers = fetch_fleet(args.licence_url, admin_api_key)
    print(f"  {len(customers)} customer(s) in the fleet manifest.")

    migrations_script = Path(__file__).parent / "apply_migrations.py"
    print("Migrating each customer with a real d1_database_name set ...")
    results = migrate_all(customers, migrations_script)

    print()
    print(format_summary(results))

    sys.exit(1 if any(r.status == "failed" for r in results) else 0)


if __name__ == "__main__":
    main()
