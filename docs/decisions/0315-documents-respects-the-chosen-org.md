# 0315 — Documents respects the chosen org too

**Status: built.** The same treatment decision 0314 gave Tasks,
extended to the second screen.

---

## What was asked

> please continue the the org split work, Documents next?

## A correction, found before building anything

The last record's own closing notes claimed Documents had no
unit-awareness at all. That was wrong, and the error was simple: two
files share a nearly identical name — `document-route.ts` (singular,
checked, empty) and `documents-route.ts` (plural, the real list route,
never checked). The real file already had a mature mechanism from
decision 0199: a `visibleUnits` parameter, walked downward from every
unit a person holds `AP.Review` in, intersected into the SQL query
directly. Documents also already has its own, separate, screen-level
"filter by operating unit" dropdown (decisions 0193, 0260) — a
genuinely different, narrower concept from the org switcher, kept
untouched throughout this record.

## What was built

**`unitsBeneath(db, unitId)`**, extracted as its own function — the
downward walk `unitsWherePermitted` already did inline, now reusable
for a single starting unit rather than a batch of held ones.
Deliberately *not* reused inside `unitsWherePermitted` itself: that
function batches every held unit into one query per tree level, and
calling the new function once per unit instead would have meant
several times the queries for a person holding several units — a
performance regression caught and reverted before it shipped, not
after.

**`scopedToChosenOrg(db, visible, currentOrg)`**, extracted as its own
function rather than left inline in the route handler, so the
intersection itself — the same "narrow, never grant" safety property
decision 0314 already established for Tasks — is directly testable
rather than only provable by simulating a full request. A person
permitted everywhere who focuses on Finance sees exactly Finance's own
units; a person permitted only in Germany who somehow focuses on
France (a stale switch, another tab, a hand-built URL) sees nothing,
rather than being granted France by the choice itself.

**Wired into `/api/documents`** via a new `org` query parameter,
intersected with the existing `visibleUnits` before being handed to
`handleListDocuments` — the existing route function itself needed no
change at all, since it already accepted exactly this shape of
parameter.

**`documents.js` sends the chosen org** alongside its own, already-
existing `unit` parameter — two different concepts kept visibly
distinct in the query string, not merged into one.

## What has coverage

Five new backend tests on `scopedToChosenOrg`, built on the same
fixtures decision 0199's own document-visibility tests already
established: narrows correctly when the permission is held
everywhere; narrows correctly when held directly in two units; still
shows nothing when the permission is not held in the chosen org at
all — narrowing cannot grant what the underlying check refuses; an
unassigned document stays hidden the same way it already was before
any org was chosen, since decision 0199's own rule for documents
(unlike its rule for tasks) was always to hide rather than show an
unassigned one; nothing chosen shows the same, full visibility as
before. Two probed directly, including the security-critical one:
disabling the narrowing entirely, and bypassing the intersection to
return the chosen org's own units unconditionally, each fail exactly
the test written to catch it.

Two new frontend tests: the chosen org is sent to `/api/documents`;
no `org` parameter is sent at all when nothing has been chosen. One
needed a real fix before it passed for the right reason — the shared
`openDocuments()` test helper clears `localStorage` internally, which
was silently erasing the very choice the test was trying to set;
rewritten to set it in the correct place rather than papered over.
Both probed directly.

vf-app: 1489 tests (was 1484). vf-ui: 49 Worker, 408 browser (was
406). No migration.

## What is not built, and this matters

**Every screen besides Tasks and Documents still shows the union of
everywhere a person holds a role**: the dashboard's own cards,
Suppliers, and the write-side actions — keying, validating, approving,
returning — are all unaffected by which org is chosen. Approval limits
remain unscoped and unenforced, and there is still no UI to view,
assign, or manage role allocation, both unchanged from where decision
0313 left them.
