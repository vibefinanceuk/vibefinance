# 0012 — deploy-all: construct, don't duplicate

Status: settled, 30 August 2026. Blueprint build order step 5, the
second half of "fleet tooling" — `migrate-all` (decision 0011) covered
running migrations against every customer's database; this closes
the other half, deploying each customer's `vf-app` Worker.

## The problem, stated plainly

Deploying a customer's `vf-app` needs a complete, valid
`wrangler.jsonc` — every field, not just the ones that vary per
customer. `wrangler` has no notion of "deploy this Worker but override
these three fields from elsewhere."

## Design considered and rejected: N committed config files

One real, static `wrangler.jsonc` per customer, all checked into git.
Rejected: `main`, `compatibility_date`, the AI binding, the Service
Binding, and the cron trigger are identical across every customer.
Duplicating them into N files means a future change to any of them —
a new cron schedule, a compatibility flag — needs updating in N
places, and missing one silently leaves that customer on stale
config. This is exactly the class of drift the fleet manifest itself
(decision 0011) was designed to avoid for customer data; the same
reasoning applies here to deployment config.

## Design chosen: the committed `wrangler.jsonc` IS the template

No second template file either. `deploy_all.py` reads the real,
currently-committed `workers/vf-app/wrangler.jsonc` — the exact file
`cd workers/vf-app && wrangler deploy` already uses directly for
Acme — and overrides exactly five fields per customer, read from the
fleet manifest (decision 0011): `name`,
`d1_databases[0].database_name`, `d1_databases[0].database_id`,
`vars.CUSTOMER_ID`, `vars.LOCALE`. Every other field is carried
through unchanged, read fresh from the one real file on every run.

This means there is exactly one file to keep correct, and it's the
same file already being deployed for Acme today — a global change
(the cron schedule, a compatibility flag) is made once, in the one
place it's always been made, and takes effect for every customer the
next time `deploy_all.py` runs. Acme's own direct-deploy workflow
(`cd workers/vf-app && wrangler deploy`) is completely unaffected —
nothing about this design touches or requires touching that file's
role as a real, directly-deployable config in its own right.

## `--config` and where the generated file lives — verified, not assumed

Checked against Cloudflare's own docs before deciding, not guessed:
paths inside a `wrangler.jsonc` (like `main`) resolve relative to the
*config file's own location*, not the working directory. Separately,
a currently-open `workers-sdk` GitHub issue documents `wrangler`
mishandling a nested relative `--config` path supplied from a parent
directory. Both point to the same safe design: every generated
per-customer config is written as a flat file *directly inside*
`workers/vf-app/` — no subdirectory at all, see the next section for
why that specific detail matters — and `wrangler` is always invoked
with `cwd=workers/vf-app` and a bare filename as the `--config`
argument, never a path reaching into a parent directory, never run
from outside `workers/vf-app`.

Generated configs are gitignored (`workers/*/.deploy-generated.*.wrangler.json`),
consistent with them being purely derived, always reconstructible
from the fleet manifest plus the one committed file — never a second
source of truth.

## A real bug, found on the first live run — not a hypothetical

The first genuine attempt to run this against production failed:
`✘ [ERROR] The entry-point file at "src/index.ts" was not found.` The
first version of this script wrote each generated config into a
*subdirectory* (`workers/vf-app/.deploy-generated/<customer>.wrangler.json`)
— one directory level deeper than the real `wrangler.jsonc`. Since
`main: "src/index.ts"` is copied through unchanged, and (per the
verified behaviour above) resolves relative to the *generated* file's
own location, wrangler correctly looked for
`workers/vf-app/.deploy-generated/src/index.ts` — which genuinely
doesn't exist. This was exactly the class of problem the design
verification above was meant to avoid, reintroduced one level down by
nesting the generated file itself, not just by a bad `--config` path.

Fixed by writing each generated config as a **flat file directly
inside `workers/vf-app/`** — `.deploy-generated.<customer>.wrangler.json`,
no subdirectory at all — so every relative path already in the base
config, `main` included, continues to mean exactly what it always
meant, with nothing needing rewriting.

A new test was added specifically for the property that broke: it
resolves `main` relative to where the generated config will actually
live, against a real file on disk (a self-contained fake entry point,
not the real repository's own — this test doesn't touch the actual
codebase), and confirms it exists. The earlier, subdirectory-based
tests had checked the *shape* of the generated config and the
`--config` argument, but never checked whether `main`, interpreted the
way wrangler itself interprets it, actually resolved to anything real
— confirmed by reintroducing the subdirectory bug and watching this
specific new test catch it before restoring the fix.

## Parsing JSONC without a library

`wrangler.jsonc` has real `//` comments; a plain `json.loads()` can't
read it. A hand-written stripper tracks string-literal state
explicitly rather than a naive regex — this matters concretely, not
hypothetically: the real committed file contains
`"LICENCE_SERVER_URL": "https://vf-licence.vibefinance.workers.dev"`,
and a naive `//`-anywhere stripper would corrupt that exact value.
Proven, not assumed: a test parses the real committed file (not a
fixture) end to end, and a second test swapped in a naive
regex-based stripper and confirmed it produces invalid JSON on
exactly this shape.

## What this script deliberately does NOT do

- **Create a customer's D1 database.** `wrangler d1 create <name>` is
  a separate, one-time, manual step per new customer — this script
  has no way to know a customer needs a *new* database versus an
  existing one being redeployed, and creating infrastructure
  implicitly as a side effect of a "deploy" command would be a
  surprising, risky thing for a fleet tool to do silently.
- **Set `VF_LICENCE_API_KEY`, or any secret.** No fleet tool in this
  project touches a secret — generated once, shown once, set by hand,
  the same discipline applied to every credential built this session.
  A freshly deployed customer's Worker will deploy successfully and
  then fail its own licence refresh and usage push until this is set
  — a real, expected, separate step, printed as an explicit reminder
  at the end of every run, not silently left for the operator to
  discover.

## The real onboarding sequence this is one piece of

For a genuinely new customer, in order: provision them in `vf-licence`
(`POST /customers`) → create their D1 database by hand
(`wrangler d1 create`) → backfill their fleet metadata
(`PATCH .../fleet-metadata`, decision 0011) → `migrate_all.py
--customer <id>` (or the whole fleet) → `deploy_all.py --customer
<id>` → set `VF_LICENCE_API_KEY` by hand. `deploy_all.py` is one step
in a six-step sequence, not the whole thing — stated here so it's
never mistaken for more automation than it actually provides.

## Continue-on-error and the deep-copy property, both proven

Same continue-on-error discipline as `migrate_all.py`, proven the
same way: deliberately made the loop stop on first failure and
confirmed a specific test failure (a customer after a failed one
never being attempted) before trusting it.

A second, `deploy_all.py`-specific property was also proven, not
assumed: `build_customer_config()` deep-copies the base config before
overriding fields. Deliberately removed the deep copy and confirmed a
real test failure — without it, deploying customer B would silently
mutate the shared in-memory config object, corrupting every
subsequent customer's deploy in the same run with customer B's
`name`.

## What's still open

- No automatic D1 database creation — a deliberate, stated boundary
  above, not an oversight.
- No secret provisioning — same.
- `--customer <id>` supports targeting one customer; there is no
  equivalent for "deploy every customer except this one," which
  hasn't been needed yet.
- Code-version reporting ("who's on what version," the code half,
  per decision 0011) remains unbuilt — this script deploys code but
  doesn't record which commit was deployed anywhere queryable.
