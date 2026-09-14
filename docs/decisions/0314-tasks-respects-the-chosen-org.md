# 0314 — Tasks respects the chosen org

**Status: built, in one place.** The switcher decision 0313 shipped
now does something, for the first time, on the one screen already
wired for it.

---

## What was asked

> lets continue - what makes most sense to approach next?

Investigated before recommending anything. Of roughly thirty
enforcement checks in the backend, only two are unit-aware today: the
task list's own visibility filter (decision 0202) and claiming a task
(decision 0203). Everything else — keying, validating, approving,
returning, the document list, dashboard cards, the supplier list —
still checks "does this person hold this permission *anywhere*,"
unchanged since decision 0199 first recorded the gap. "Wire the switch
into filtering everywhere" is genuinely large, multi-session work, not
a next step.

A sharper, smaller finding pointed the way instead: **even the one
screen already unit-aware doesn't yet respect the switch just built.**
Tasks shows the union of everywhere a person holds a role — decision
0202's own filter — regardless of which single org decision 0313's
switcher has been pointed at. Confirmed with the operator before
building: narrow that one filter to the chosen org specifically. No
new unit-awareness to build — the mechanism already exists — only a
second layer on top of it.

## What was built

**`TaskListOptions.currentOrgUnitId`**, threaded from the `org` query
parameter on `/api/tasks` through to `handleListMyTasks`'s own
`maySee()` check — the same per-call shape decision 0199's own
`hasPermission(..., unitId)` already established, since there is no
session row here to hold a chosen org between requests.

**Layered on top of decision 0202's own check, not replacing it.** A
task still has to pass the existing permission-denial test — held
nowhere in particular imposes no restriction; held somewhere, the
task's own unit must be reachable from at least one of those. Only
once that holds does the new check apply: focused on one org, the
task's own unit must also be reachable from that org specifically —
even when the permission itself is held everywhere, since "seeing
only that org's work" was the operator's own request regardless of
how broadly a role reaches.

**A task about a document in no unit at all stays visible regardless
of which org is chosen** — the same reasoning decision 0202 already
gives for its own version of this: hiding it would make it invisible
under every possible choice, since it belongs to none of them, which
is a loss of real work rather than the narrowing either feature is
meant to do.

**The frontend sends the chosen org, and nothing else changed about
how it is chosen.** `loadTasks()` reads `currentOrgId()` from `orgs.js`
and appends it to the request when one is set. `orgPicker()`'s own
`choose()` now reloads the page after persisting a choice — the same
reasoning decision 0302's own language toggle already gives: this app
has no router and no way, from outside a screen, to ask whichever one
is open to re-fetch itself: a fresh load is the one place already
guaranteed to read the newly-chosen org before anything renders.

## What has coverage

Five new backend tests, built on the same fixtures decision 0202's own
tests already established: narrows to the chosen org even when the
permission is held everywhere; narrows correctly when held directly in
two units; still empties the list when the permission is not held in
the chosen org at all — narrowing never grants what the underlying
check refuses; a document with no unit stays visible regardless of
which org is chosen; nothing chosen shows the same, full union as
before. Each probed directly — removing the new check, and removing
the "no unit" early return, each fail exactly the test written to
catch it.

Three new frontend tests: a chosen org's own name persists and shows
correctly on a fresh load (`choose()` no longer updates the label
in place, so the existing decision 0313 test needed rewriting rather
than only extending); `/api/tasks` is called with the chosen org;
`/api/tasks` carries no org parameter at all when nothing has been
chosen. The org-parameter test probed directly — removing the query
parameter fails exactly it.

vf-app: 1484 tests (was 1474). vf-ui: 49 Worker, 406 browser (was
403). No migration.

## What is not built, and this matters

**Every other screen still shows the union of everywhere a person
holds a role**, unaffected by which org is chosen — Documents, the
dashboard's own cards, Suppliers, and the write-side actions
(keying, validating, approving, returning) all still ask "anywhere,"
the same as before this record. Tasks is the only screen the chosen
org changes anything for.

**Approval limits remain unscoped and unenforced**, and there is
still no UI to view, assign, or manage role allocation — both
unchanged from decision 0313's own closing notes.
