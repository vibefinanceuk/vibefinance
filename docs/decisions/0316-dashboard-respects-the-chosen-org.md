# 0316 — The dashboard's own cards respect the chosen org too

**Status: built.** The third screen, following the same shape as
decisions 0314 and 0315.

---

## What was asked

> Can you update the Dashboard now

Investigated the actual backend first, having been wrong about a
sibling screen's own starting point one record ago. The dashboard
already had substantial unit-awareness of its own — a `Scope`
abstraction, a `scopeFor()` function built on `unitsWherePermitted`,
and a `unitClause()` helper threaded into eleven separate card
queries, all from decision 0240's own opening argument: *"every count
is a disclosure"* — a number is still a way of showing somebody work
they should not see.

## What was built

**`scopeFor()` narrows through `scopedToChosenOrg()`**, the same
function decisions 0314 and 0315 already built and tested. Because
every one of the dashboard's eleven card queries already reads its
unit restriction from the one `Scope` this function returns, no card
needed touching individually — the narrowing lands in the single place
all of them already agree to ask.

**`handleDashboard()` takes the chosen org as its own third,
optional parameter**, threaded from a new `org` query string on
`/api/dashboard` — the same shape decisions 0314 and 0315 already gave
`/api/tasks` and `/api/documents`.

**`dashboard.js` sends the chosen org** the same way `tasks.js` and
`documents.js` already do.

## What has coverage

Three new backend tests, on the existing "a count is a disclosure"
fixtures: narrows to the chosen org even when the permission is held
everywhere; still counts nothing when the permission is not held in
the chosen org at all — narrowing cannot grant what the underlying
scope refuses, the same security property decisions 0314 and 0315
already proved for their own screens; the full, unnarrowed count shows
when nothing is chosen. Probed directly — removing the narrowing from
`scopeFor()` fails exactly the test written to catch it.

Two new frontend tests: the chosen org is sent to `/api/dashboard`; no
`org` parameter is sent at all when nothing has been chosen. Both
probed directly.

vf-app: 1492 tests (was 1489). vf-ui: 49 Worker, 410 browser (was
408). No migration.

## What is not built, and this matters

**Suppliers, and every write-side action — keying, validating,
approving, returning — remain unaffected by which org is chosen.**
Three of the app's screens now respect the switch; the rest do not.
Approval limits remain unscoped and unenforced, and there is still no
UI to view, assign, or manage role allocation, both unchanged from
where decision 0313 left them.
