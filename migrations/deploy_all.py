#!/usr/bin/env python3
"""Fleet deploy runner (Blueprint build order step 5 — see
docs/decisions/0012-deploy-all.md).

Constructs a real, complete wrangler.jsonc per customer at deploy time
from the checked-in workers/vf-app/wrangler.jsonc, overriding only the
handful of fields that genuinely vary per customer (name,
d1_databases[0].database_name/database_id, vars.CUSTOMER_ID,
vars.LOCALE) — every other field (main, compatibility_date, the AI
binding, the licence signing public key, the Service Binding, the
cron trigger) is carried through unchanged, read fresh from the one
real committed file every time. No separate template file: the
committed wrangler.jsonc IS the template, and remains directly
deployable on its own (`cd workers/vf-app && wrangler deploy`) for
Acme specifically, exactly as it always has been.

    ADMIN_API_KEY=<key> python3 migrations/deploy_all.py
    ADMIN_API_KEY=<key> python3 migrations/deploy_all.py --customer Acme

ADMIN_API_KEY is read from the environment, never a CLI argument — see
migrate_all.py's own module docstring for the full reasoning, which
applies identically here.

Like migrate_all.py, this requires real Cloudflare credentials this
development session does not have — the operator runs this, never the
session.

Continue-on-error, deliberately, for the whole-fleet case: one
customer's deploy failing must never prevent the rest of the fleet
from being attempted. See migrate_all.py's own reasoning — the same
property, proven the same way.

IMPORTANT — what this script does NOT do:
  - It does not create a customer's D1 database. `wrangler d1 create
    <name>` is a separate, one-time step per new customer, run by the
    operator before this script can do anything useful for them.
  - It does not set VF_LICENCE_API_KEY, or any other secret. Secrets
    are never handled by fleet tooling in this project — generated
    once, shown once, set by hand via `wrangler secret put`, the same
    discipline applied to every credential in this system. A newly
    deployed Worker with no VF_LICENCE_API_KEY secret set will deploy
    successfully and then fail its own licence refresh / usage push —
    a real, expected, separate step, not a bug in this script.

A customer with incomplete fleet metadata (missing worker_name,
d1_database_name, or d1_database_id) is skipped, not failed — the
same "provisioned but not yet deployable" state migrate_all.py already
treats as a skip, not an error.
"""

from __future__ import annotations

import argparse
import copy
import json
import os
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Optional

sys.path.insert(0, str(Path(__file__).parent))
from migrate_all import FleetCustomer, fetch_fleet  # noqa: E402

VF_APP_DIR = Path(__file__).parent.parent / "workers" / "vf-app"
BASE_CONFIG_PATH = VF_APP_DIR / "wrangler.jsonc"


def generated_config_filename(customer_id: str) -> str:
    """Deliberately a flat filename directly inside vf_app_dir, never a
    subdirectory. Found live: an earlier version of this script put
    generated configs one directory level deeper
    (.deploy-generated/<customer>.wrangler.json), which silently broke
    `main: "src/index.ts"` — that relative path, copied through
    unchanged from the base config, then resolved relative to the
    GENERATED file's own (one-level-deeper) location instead of
    vf_app_dir, and wrangler could no longer find the real entry point.
    A flat file directly alongside the real wrangler.jsonc sidesteps
    this entirely: every relative path in the base config continues to
    mean exactly what it always meant, with no rewriting needed."""
    return f".deploy-generated.{customer_id}.wrangler.json"


@dataclass
class DeployResult:
    customer_id: str
    worker_name: Optional[str]
    status: str  # "success" | "failed" | "skipped"
    detail: str


def strip_jsonc_comments(text: str) -> str:
    """Strips `//` line comments, respecting string literals so a URL
    or value that happens to contain `//` is never mistaken for a
    comment start. This file's own comments are the only reason a
    plain json.loads() can't read wrangler.jsonc directly — everything
    else in it is valid JSON."""
    out = []
    in_string = False
    i = 0
    n = len(text)
    while i < n:
        ch = text[i]
        if in_string:
            out.append(ch)
            if ch == "\\" and i + 1 < n:
                out.append(text[i + 1])
                i += 2
                continue
            if ch == '"':
                in_string = False
            i += 1
            continue
        if ch == '"':
            in_string = True
            out.append(ch)
            i += 1
            continue
        if ch == "/" and i + 1 < n and text[i + 1] == "/":
            while i < n and text[i] != "\n":
                i += 1
            continue
        out.append(ch)
        i += 1
    return "".join(out)


def load_base_config(path: Path = BASE_CONFIG_PATH) -> dict:
    return json.loads(strip_jsonc_comments(path.read_text()))


def build_customer_config(base_config: dict, customer: FleetCustomer) -> dict:
    """Every field not explicitly overridden here is carried through
    from base_config unchanged. This function's whole job is to name,
    exhaustively, the small set of fields that genuinely vary per
    customer — anything added to that set later belongs here, in one
    place, not scattered across per-customer files. Assumes the
    caller has already confirmed worker_name, d1_database_name, and
    d1_database_id are all present (see deploy_one's own guard)."""
    config = copy.deepcopy(base_config)
    config["name"] = customer.worker_name
    config["d1_databases"][0]["database_name"] = customer.d1_database_name
    config["d1_databases"][0]["database_id"] = customer.d1_database_id
    config.setdefault("vars", {})["CUSTOMER_ID"] = customer.id
    config["vars"]["LOCALE"] = customer.locale or "en"
    return config


RunSubprocess = Callable[[list[str], Path], "subprocess.CompletedProcess[str]"]


def _real_run_subprocess(args: list[str], cwd: Path) -> "subprocess.CompletedProcess[str]":
    return subprocess.run(args, cwd=cwd, capture_output=True, text=True)


def deploy_one(
    customer: FleetCustomer,
    base_config: dict,
    run_subprocess: Optional[RunSubprocess] = None,
    vf_app_dir: Path = VF_APP_DIR,
) -> DeployResult:
    if not (customer.worker_name and customer.d1_database_name and customer.d1_database_id):
        return DeployResult(
            customer.id,
            customer.worker_name,
            "skipped",
            "incomplete fleet metadata (worker_name, d1_database_name, and d1_database_id are all required)",
        )

    config = build_customer_config(base_config, customer)
    config_filename = generated_config_filename(customer.id)
    config_path = vf_app_dir / config_filename
    config_path.write_text(json.dumps(config, indent=2))

    run = run_subprocess or _real_run_subprocess
    # Always cwd=vf_app_dir, always a flat filename with no directory
    # component at all — see generated_config_filename's own comment,
    # and this module's docstring, for the two distinct path-resolution
    # problems this avoids: a known wrangler bug with nested relative
    # --config paths from a parent directory, and (found live) `main`
    # silently breaking if the generated file itself lived one level
    # deeper than vf_app_dir.
    result = run(["npx", "wrangler", "deploy", "--config", config_filename], vf_app_dir)

    if result.returncode == 0:
        last_line = result.stdout.strip().splitlines()[-1] if result.stdout.strip() else "(no output)"
        return DeployResult(customer.id, customer.worker_name, "success", last_line)
    detail = (result.stderr or result.stdout or "(no output)").strip()
    return DeployResult(customer.id, customer.worker_name, "failed", detail)


def deploy_all(
    customers: list[FleetCustomer],
    base_config: dict,
    run_subprocess: Optional[RunSubprocess] = None,
    vf_app_dir: Path = VF_APP_DIR,
) -> list[DeployResult]:
    """Attempts every customer regardless of what happened to any
    earlier one — same continue-on-error property as
    migrate_all.migrate_all(), for the same reason: one customer's
    deploy failing must never prevent the rest of the fleet from being
    attempted."""
    return [deploy_one(c, base_config, run_subprocess, vf_app_dir) for c in customers]


def format_summary(results: list[DeployResult]) -> str:
    lines = []
    counts = {"success": 0, "failed": 0, "skipped": 0}
    for r in results:
        counts[r.status] += 1
        marker = {"success": "OK", "failed": "FAILED", "skipped": "skip"}[r.status]
        name = r.worker_name or "(none)"
        lines.append(f"  [{marker:>6}] {r.customer_id:<20} {name:<24} {r.detail}")
    lines.append("")
    lines.append(
        f"{counts['success']} succeeded, {counts['failed']} failed, {counts['skipped']} skipped "
        f"(of {len(results)} customers considered)"
    )
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument(
        "--licence-url",
        default=os.environ.get("VF_LICENCE_URL", "https://vf-licence.vibefinance.workers.dev"),
    )
    parser.add_argument("--customer", help="Deploy only this one customer id, not the whole fleet.")
    args = parser.parse_args()

    admin_api_key = os.environ.get("ADMIN_API_KEY")
    if not admin_api_key:
        print("ADMIN_API_KEY environment variable is required.", file=sys.stderr)
        sys.exit(2)

    print(f"Fetching fleet manifest from {args.licence_url}/customers ...")
    customers = fetch_fleet(args.licence_url, admin_api_key)
    if args.customer:
        customers = [c for c in customers if c.id == args.customer]
        if not customers:
            print(f"No customer '{args.customer}' found in the fleet manifest.", file=sys.stderr)
            sys.exit(2)
    print(f"  {len(customers)} customer(s) to consider.")

    base_config = load_base_config()
    print(f"Deploying each customer with complete fleet metadata, using {BASE_CONFIG_PATH} as the base ...")
    results = deploy_all(customers, base_config)

    print()
    print(format_summary(results))
    print()
    print(
        "Reminder: this script never sets secrets. A newly deployed customer needs "
        "VF_LICENCE_API_KEY set by hand before their licence refresh or usage push will work:\n"
        f"  cd {VF_APP_DIR}\n"
        f"  npx wrangler secret put VF_LICENCE_API_KEY --config .deploy-generated.<customer>.wrangler.json"
    )

    sys.exit(1 if any(r.status == "failed" for r in results) else 0)


if __name__ == "__main__":
    main()
