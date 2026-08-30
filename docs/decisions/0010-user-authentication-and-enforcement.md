# 0010 — User authentication and enforcement

Status: settled, 30 August 2026. Closes the largest gap left open by
docs/decisions/0009-org-authority-profiles.md: `org_users` rows
existed as data, but nothing let a real person authenticate as one,
and nothing checked a permission before letting any action through.

## Real design tensions worked through before writing code

**Bootstrap deadlock.** Requiring an authenticated user with
`Admin.UserManagement` just to create the *first* user would mean
there's never a way to create one at all. `/org/*` management routes
stay deliberately unauthenticated, matching decision 0009's own
precedent — enforcement is scoped specifically to the rules workflow
(compile, evaluate, review, approve), where identity actually matters
for an audit trail, not to org administration itself.

**`/licence/refresh` stays untouched.** It was built as a deliberately
unblockable escape hatch (decisions 0004 and 0007's own reasoning).
Adding user-auth to it would recreate exactly the bootstrap problem it
exists to solve — a genuinely broken instance (no cache, no working
auth setup) needs this route reachable no matter what.

**Authority-limit enforcement is out of scope, honestly.** There's no
existing "this action needs approval up to $X" step in any current
route — building one means inventing a new approval concept, which is
separate, larger scope. Flagged here rather than forced into a
contrived integration.

**A real integrity fix fell out of this naturally.** `confirmedBy` and
`activatedBy` were, until this bundle, just client-supplied strings —
claiming to be "alice@example.com" cost nothing. Now that real
authentication exists, both are *derived from the authenticated
identity* and the request-body fields are ignored entirely. Proven,
not just implemented: a test sends a spoofed `confirmedBy` claiming to
be `someone-else@attacker.example` and confirms the stored value is
still the real authenticated user's email.

## API keys, not passwords or sessions

Same generate-once, hash-only-stored, timing-safe-compare pattern
already proven twice in `workers/vf-licence/src/auth.ts` (the admin
key, per-customer keys). This product has no login UI to type a
password into; a Bearer key is the natural fit, the same reasoning
that shaped every other credential in this system.

`user-auth.ts` is a deliberate near-duplicate of `vf-licence`'s
`auth.ts`, not an import from a shared module. Considered extraction —
this is the third occurrence of the identical pattern, past the usual
"rule of three" — but chose the lower-risk path: `vf-licence`'s
`auth.ts` is already live and proven; refactoring it purely for
DRY-ness risks a regression in an already-working security module for
no functional gain. A future low-risk consolidation into `shared/` is
reasonable, not done here.

`authenticateUser()` scans active users and compares with
`timingSafeEqual`, the same application-level comparison
`vf-licence`'s `isValidCustomerKey` uses, rather than a SQL
`WHERE api_key_hash = ?` lookup — consistent security posture across
both Workers rather than two different approaches to the same
property. A real false positive was caught while writing this: the
first version of the cross-user isolation test passed even with
authentication completely broken (returning "the first active user"
regardless of key), because the test only checked one direction and
the broken code happened to return the right user by insertion-order
luck. Fixed by checking both directions before trusting the test.

## An extensible, category-based permission framework

The original permission list was route-mapped (`rules.compile`,
`rules.evaluate`) — technically accurate but not how a finance
organisation actually thinks about roles. Restructured around real
business categories, informed directly by the person's own domain
input:

- **AP** (Accounts Payable) — the side of the business this product
  actually handles today. `AP.Validate` (real, `POST /rules/evaluate`),
  `AP.Approve` (real, `POST .../activate`), `AP.Review` (real,
  `GET .../examples` + confirm). `AP.Match` (3-way match) and
  `AP.Code` (GL coding) are listed but have zero backing capability —
  genuinely new scope, not built. `AP.Analysis` has real data behind
  it (`invoice_runs` in D1) but no route reads it back yet.
- **AR** (Accounts Receivable) — the entire category is a placeholder.
  This system has no invoice-issuance, reminder, or collections
  workflow at all; it only handles the *incoming* invoice side.
- **Admin** — `Admin.UserManagement`, `Admin.ConfigManagement`, and
  `Admin.RuleManagement` all have real routes behind them, but only
  `RuleManagement` is actually enforced by this bundle (the `/org/*`
  routes stay unauthenticated — see the bootstrap-deadlock reasoning
  above). `Admin.Configure` has no route of its own yet — configuration
  today is entirely `wrangler.jsonc` vars, not an API.
- **System** — `System.UsagePush` and `System.LicenceRefresh`, neither
  enforced by design (see above).

Deliberately extensible: adding a permission is a one-line addition to
the relevant category array in `permissions.ts`. That change never
touches `enforce.ts` (it only ever checks whatever permission string a
route gives it), never touches the schema (`permissions_json` is
free-form JSON), and never requires renaming anything else.

## What's still open

- Authority-limit enforcement — genuinely separate scope, as above.
- `AR.*` and `AP.Match`/`AP.Code` — permission strings with no route
  behind them yet, by design, not an oversight.
- `Admin.Configure` — no corresponding route.
- No key expiry policy for per-user keys, matching the same
  already-known gap for per-customer keys (decision 0006).
- No admin UI, matching every other precedent in this codebase — raw
  API only, now with real credentials required for the routes that
  matter.
