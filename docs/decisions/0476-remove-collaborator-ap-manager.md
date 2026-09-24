# 0476 — Removing a Collaborator, Restricted to a New `AP.Manager` Permission

**Status: built and verified locally, not yet committed/pushed at the
time of writing.** No push access from this session — delivered as a
git bundle, per this repo's own established handover mechanism.

---

## What was asked

*"whats next in the list"* — answered directly: the last remaining
backlog item was decision 0470's own named-but-deferred gap, "removing
a collaborator" ("Add person to conversation" only ever supports
adding one). *"Yes, but I'd like to restruc the ability to remove a
collaborator to the AP.Manager role"* — build it, restricted to
"AP.Manager." Corrected mid-turn: *"restrict, not restruc"* — same
meaning, no change of scope.

## What was found

**"AP Manager" is not a real permission or a seeded role anywhere in
this codebase.** A full grep across the repo found it only as an
illustrative example role *name* in docs and tests (an operator-created
bundle such as `["AP.Approve", "AP.Review"]`, used purely to show what
a role could look like) — never a seeded row, never a checked string.
This codebase's own permission architecture (decisions 0199/0201) only
ever lets a route check a permission a role happens to grant; roles
themselves are entirely operator-defined bundles with arbitrary names
an operator chooses via the Access screen, and no route anywhere checks
a role's own name. So "restrict removal to the AP Manager role" could
not mean "gate on a role called AP Manager" — that check does not exist
in this codebase for anything, and adding one here would be a new kind
of check nothing else uses. Rather than assume which of the two real
readings was meant, this was put to Dan directly: an existing role he
had already created for his own org via Access → Roles (in which case
the routes below would need to know its actual permissions), or a new
permission for the closed vocabulary. **Answered: a new permission.**
This also matches every other elevated-capability precedent this
session has built — `AP.Match`, `Procurement.Approve`, `AP.TaskManage`,
`AP.FraudReview`, `AP.Assistant` — always a new dedicated permission,
never a role-name check.

**The right no-op/404 semantics for the new `DELETE` were not obvious
from decision 0470's own precedent and had to be checked, not
assumed.** `handleAddCollaborator`'s own duplicate-add is a silent
no-op (`INSERT ... ON CONFLICT DO NOTHING`, 200 either way) — the
initial draft of this route mirrored that for symmetry. The actual
established precedent for *removing* from a plain membership table is
different: `team-route.ts`'s `handleRemoveTeamMember` checks
`result.meta.changes` after the `DELETE` and 404s if nothing was
removed. `invoice_collaborators` is a plain membership table, not a
composite-key "grant" table with duplicate-tolerant semantics of its
own — the same distinction this codebase already draws elsewhere — so
the 404 precedent is the one this route now follows; the doc comment on
`handleRemoveCollaborator` explains the asymmetry directly rather than
leaving future readers to wonder why add and remove don't mirror each
other.

**The vf-ui proxy allowlist had never been updated for decision 0470's
own `GET`/`POST /documents/:id/collaborators` routes at all** — found
while adding this decision's own `DELETE` entry, the exact class of gap
decision 0212 first named and decisions 0418–0431, 0441, 0473, and 0474
have each independently found again since. Both `collaborators.js`'s
initial roster load and its "Add person" action would have 404'd
through this proxy in production, entirely independent of anything
built in this decision — closed here alongside the new route rather
than left for a live report, the same discipline this exact recurring
gap has repeatedly established as the right response.

**`collaborators.js` itself had zero dedicated browser-test coverage**
since decision 0470 shipped it — confirmed by searching
`workers/vf-ui/test-browser/` for any reference to it beyond the
generic empty-roster default `viewer.test.ts`'s own `stubFetch()`
already carries for `buildActivityTab`'s sake. New coverage was added
here scoped to this decision's own removal behavior (below), not
backfilled for the pre-existing Add-person flow — a separate,
already-flagged gap, not assumed into this one's scope.

## What was built

- **`AP.Manager`** (`permissions.ts`), a new entry in `AP_PERMISSIONS`
  with its own `PERMISSION_DESCRIPTIONS` entry, namespaced by what it
  actually does rather than folded into the nearest existing grant
  (`AP.TaskManage` and `AP.ReturnAny` are both genuinely different
  manager-override capabilities, not this one) — the same discipline
  this file already follows throughout.
- **`handleRemoveCollaborator`** (`invoice-collaborators-route.ts`): a
  plain `DELETE FROM invoice_collaborators`, 404 if the document
  doesn't exist, 404 if the target user wasn't a collaborator
  (`handleRemoveTeamMember`'s own precedent, not
  `handleAddCollaborator`'s), 200 with `{ invoiceId, userId }`
  otherwise. No soft-delete, no `removed_at`/`removed_by` columns —
  this table has never carried its own history, the same as
  `org_teams`' own membership table. Does not touch any task already
  routed to this person (decision 0471's `resolveNonPoApprovers`) —
  a task is its own row, resolved once at routing time, not a live
  join against the roster; reaching back into an already-created
  task's own grant from an unrelated roster change is a separate,
  bigger decision this one was not asked to make.
- **`DELETE /documents/:id/collaborators/:userId`** (`index.ts`),
  gated exclusively on `AP.Manager` — deliberately narrower than the
  `AP.Review` that gates the sibling add/list routes just above it, per
  the operator's own instruction: someone who can invite a person into
  a conversation should not automatically be able to remove one. Not
  widened to let a collaborator remove themselves.
- **The vf-ui proxy allowlist**, `PROXIED_TO_INSTANCE`
  (`workers/vf-ui/src/index.ts`): one new pattern covering both the
  new `DELETE` route and decision 0470's own never-added
  `GET`/`POST /documents/:id/collaborators`, plus the corresponding
  `CALLED_BY_A_SCREEN` entries in `test/index.test.ts` proving all
  three are actually reachable through the proxy, not merely listed.
- **`collaborators.js`**: a small "x" (`icon("close")`, already this
  file's own simple glyph, not a new one) on every chip, calling the
  new route and reloading the roster on success — the same
  read-after-write discipline `addPerson()` already uses rather than
  filtering the chip out locally. Shown on every chip unconditionally,
  matching this file's own already-stated habit for the Add button:
  never hide a control the caller cannot use, let the real 403 answer
  for itself. No confirmation dialog — the same "acts the moment you
  click it" discipline `ap-setup.js`'s own override-row Remove buttons
  already use, and trivially reversible the same way theirs is not:
  the person can be added right back via search.
- **New CSS** (`.collabchipremove`, `app.css`) for the button itself.
- **Two new `ui_strings` keys**, en/de
  (`workers/vf-licence/migrations/0162_remove_collaborator_strings.sql`),
  wired into `test/setup.ts` and required by `string-coverage.test.ts`.
- **New browser-test coverage** (`viewer.test.ts`, four tests): the
  remove button rendering on every chip; a successful removal reloading
  the roster so the chip is actually gone, not merely hidden; a refused
  removal showing the real inline error and leaving the roster
  untouched; the button rendering unconditionally regardless of the
  viewer's own permissions, as a tripwire against a future change that
  adds client-side gating this file's own doc comment explicitly says
  not to have.

## What was not built

No cascade to any task already routed to a removed collaborator — see
above, a deliberate, documented choice, not an oversight. No
confirmation dialog. No self-removal carve-out. No backfilled test
coverage for decision 0470's own Add-person flow, beyond the proxy
allowlist fix above (a real, separate gap, closed here because it was
found here — not because this decision's own scope asked for it).

## Verification

`workers/vf-app/test/invoice-collaborators-route.test.ts` **16/16**
(11 pre-existing + 5 new: 404 for a nonexistent document, 404 removing
someone never added — matching `handleRemoveTeamMember`'s precedent
explicitly, not `handleAddCollaborator`'s, a real removal with DB
assertions, and removal on one invoice/from one collaborator not
touching a second). `workers/vf-app/test/index.test.ts` +
`invoice-collaborators-route.test.ts` together **194/194** (six new
tests through the real router: the route working end to end gated on
`AP.Manager`; an `AP.Review`-only caller refused — deliberately
narrower than add, using a freshly-scoped `seedUserWithPermissions`
rather than `authHeaders()`'s fully-authorized user, which would have
proven nothing; a collaborator refused removing themselves even while
holding `Procurement.Collaborate`; 404 removing someone never added;
removal revoking `GET /invoices/:id` access immediately afterward).
`eslint` clean on every touched `vf-app` file.

`workers/vf-licence`'s full suite **320/320**, including
`string-coverage.test.ts` **10/10** with the two new keys required and
migration `0162` wired into `test/setup.ts`.

`workers/vf-ui`'s default suite **74/74** (the proxy-allowlist fix
proven live by three new `CALLED_BY_A_SCREEN` entries actually
reaching the router: `GET`/`POST /documents/:id/collaborators`,
decision 0470's own gap, and the new `DELETE`). `viewer.test.ts`
(browser) **181/181**, four of them new and scoped to this decision's
own removal behavior. The full `npm test` script (both `vitest.config.ts`
and `vitest.browser.config.ts`) **1080/1081**, the one failure
(`typography.test.ts`, a pre-existing hardcoded `font-size: 10px` on
`.collabchip .activityavatar`) confirmed present on unmodified
`origin/main` before any of this decision's own changes, by stashing
this diff and re-running the file in isolation — a real, pre-existing,
out-of-scope finding, not a regression introduced here. `eslint` clean
on every touched `vf-ui` file. `node --check` clean on `collaborators.js`.
`tsc --noEmit` shows no new errors — only the same pre-existing
`cloudflare:test` module-resolution noise and the pre-existing
`workload.test.ts` cast this session has already documented repeatedly.
251 unhandled-rejection warnings in the browser suite are pre-existing
noise from decision 0470's own `collaborators.js` fetch call not being
stubbed by test files written before it existed — confirmed present on
unmodified `origin/main` the same way as the typography failure, not
introduced or worsened by this decision.

## Still to do, operator side

Push, deploy, and apply migration `0162` (`vf-licence`) once confirmed.
Assign `AP.Manager` to whichever of your own roles should be able to
remove a collaborator — nothing is granted it automatically. Separately,
and out of scope here: decide whether the pre-existing
`typography.test.ts` hardcoded-`font-size` finding on
`.collabchip .activityavatar` is worth fixing, and whether decision
0470's own Add-person flow is worth its own dedicated browser-test
coverage beyond what this decision added for removal.
