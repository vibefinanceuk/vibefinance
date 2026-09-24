# 0470 — "Add Person to Conversation": Phase 2

**Status: built and verified locally, not yet committed/pushed at the
time of writing.** No push access from this session — delivered as a
git bundle, per this repo's own established handover mechanism.

---

## What was asked

*"lets move onto phase 2"* — after decision 0469's own Phase 1
(matching exceptions, PO buyer, org-wide tolerance, Non-PO Approval
routing) was built, pushed, deployed, and its migration applied and
confirmed live. Phase 2's own scope was not yet settled anywhere in the
docs, so it was asked directly: of the later-phase pieces decision
0469 itself named as not built (the real AP Setup Matching tab UI,
"Add person to conversation," standard-rule checkboxes, `AP.Match`'s
own route-widening), which is Phase 2? **"Add person to conversation"
was the sole answer** — the other three stay out of scope unless
separately requested.

## What was found

**Decision 0468 had already settled the shape**, this phase only had
to build it: `invoice_collaborators` (migration 0078, decision 0469)
as the access record, `Procurement.Collaborate` (also 0469, reserved
until now) as the permission a person needs on top of being listed.
Both were already real, tested, and live — nothing new to design there.

**"View an invoice you've been added to" (decision 0468's own words)
meant more than the Timeline / Chat tab.** `GET /invoices/:id` itself,
and every route the viewer needs beside it to actually show a
document — `document-url`, `pages`, `pages/:n/document-url`,
`progress` — all still required `AP.Validate`/`AP.Code`/`AP.Review`
alone. Widening only `/documents/:id/activity` and
`/documents/:id/comments` would have added someone to a conversation
they could not otherwise reach: opening the invoice the conversation
is about is the first gate a Business User meets, and decision 0468's
own phrase names exactly that as in scope, not only the chat beside
it.

**No per-record access check existed anywhere in this codebase
before this.** `enforce.ts`'s own `hasPermission`/`requireAnyPermission`
are both global, role-grant checks with no invoice awareness — correct
for every route built so far, since nothing before this needed to ask
"does this specific person, on this specific invoice, get in." The
five widened routes below all now combine a global permission check
(`Procurement.Collaborate`) with a new per-record one
(`isInvoiceCollaborator`) — one new small helper
(`canViewInvoiceAsCollaborator` in `index.ts`) rather than five
near-identical inline checks that would drift the way this codebase's
own commit history has caught happen before.

**Adding the same person twice is a no-op, not a 409 — resolved by
re-reading migration 0078's own design comment, not left open.** It
names `org_user_supervisor_overrides` (decision 0075) directly as "the
same 'no duplicate grant' shape" — that route
(`handleSetSupervisorOverride`, `approval-config-route.ts`) is a
silent `INSERT ... ON CONFLICT DO UPDATE`, 200 either way, not
`handleAddTeamMember`'s own 409-on-duplicate (`team-route.ts`), a
different table with no such comment pointing at a different
precedent. `handleAddCollaborator` follows the cited precedent:
`INSERT ... ON CONFLICT(invoice_id, user_id) DO NOTHING`, 200 whether
newly added or already present, the first `added_by` kept rather than
overwritten by a second caller's own attempt.

**No route existed for an ordinary AP clerk to search for one person
to invite.** `GET /org/overview` returns every user with every
administrative field this codebase has, gated on
`Admin.Configure`/`Admin.UserManagement` — the wrong shape and the
wrong gate for someone who can already see a document (`AP.Review`)
looking for a name to add to its conversation. A small, purpose-built
`GET /org/users/search` fills this, gated the same `AP.Review` the
invite action itself uses.

## What was built

- **`invoice-collaborators-route.ts`** (new file):
  `handleAddCollaborator` (validates the invoice and the target user
  exist, then the no-op-on-duplicate insert above), `handleListCollaborators`
  (earliest-added first, joined with both the collaborator's and the
  adder's own names), and `isInvoiceCollaborator` — the per-record
  check every widened route below shares.
- **`handleSearchUsers`** (`org-route.ts`), a small name/email search
  over active users, `LIMIT 20`, gated on `AP.Review` at its route —
  deliberately not `handleGetOrgOverview`'s own gate or field set.
- **Three new routes, `index.ts`**: `GET /org/users/search`;
  `GET /documents/:id/collaborators` (the roster, same widened gate as
  activity/comments below); `POST /documents/:id/collaborators` (the
  invite itself, `AP.Review`-only — nothing in decision 0468's own
  scope has a Business User inviting anyone else in).
- **Five existing routes widened** with a shared
  `canViewInvoiceAsCollaborator(db, userId, invoiceId)` helper
  (`Procurement.Collaborate` AND `isInvoiceCollaborator`, both
  required): `GET /invoices/:id`, `POST /invoices/:id/document-url`,
  `GET /invoices/:id/pages`, `POST /invoices/:id/pages/:n/document-url`,
  `GET /invoices/:id/progress`, plus `GET /documents/:id/activity` and
  `POST /documents/:id/comments` widened the same way. Every one of
  these keeps its existing AP-staff checks completely unchanged,
  additive only.
- **`Procurement.Collaborate`'s own description and category comment**
  (`permissions.ts`) corrected from "reserved, no route yet" to name
  the five routes it now actually gates, the same correction decision
  0469 itself made for `AP.Code` after decisions 0455/0456.
  `Procurement.Approve` is untouched, still reserved — genuinely
  separate, later-phase scope.
- **`collaborators.js`** (new file, `vf-ui`): the Timeline / Chat tab's
  own roster-and-search bar, sitting above `activity.js`'s own feed —
  a standing "who is here" row, the same reasoning `viewer.js`'s own
  unreadable-document banner already uses for "about the document, not
  a timestamped event in it." Self-contained the same way
  `activity.js` is, with one deliberate difference: the search
  `<input>` and its results container are stable DOM nodes created
  once when the panel opens and reused for as long as it stays open,
  rather than rebuilt on every keystroke the way this codebase's own
  "rebuild the whole `content` node" convention would otherwise do —
  confirmed by hand that a mid-word re-render would have dropped focus
  and cursor position, the one thing a search-as-you-type box cannot
  do, so only the results underneath the input are swapped as answers
  arrive.
- **Wired into `viewer.js`'s `buildDocTabs`**, shared by the embedded
  panel and the pop-out window (decision 0384's own extraction) with
  no separate wiring needed for either.
- **Five new `ui_strings` keys**, en/de
  (`workers/vf-licence/migrations/0158_add_person_to_conversation_strings.sql`),
  applied in `test/setup.ts` and required by `string-coverage.test.ts`
  the same way decision 0452's own strings migration was.
- **New CSS** (`.collabbar`/`.collabchip`/`.collabsearch*`, `app.css`),
  reusing `.activityavatar` for each chip's own initials circle rather
  than a second copy of the same shape.

## What was not built

Everything else decision 0469 itself named as later-phase and Dan did
not select for this round: the real AP Setup Matching tab UI, standard-
rule checkboxes, and `AP.Match`'s own route-widening. No way to
*remove* a collaborator — decision 0468's own picture was adding
someone to a conversation, not managing a roster; a `DELETE` route is a
real, separate follow-up once there is a reason to ask for it, not
assumed here. `Procurement.Approve` stays reserved — the Non-PO
Approval routing this phase's own roster now genuinely feeds
(`resolveInvoiceRequester`, decision 0469) is real and live, but
nothing yet lets a Business User *complete* an approval task; that is
its own, separate piece of work.

## Verification

`workers/vf-app/test/invoice-collaborators-route.test.ts` — new file,
**11/11** (`handleAddCollaborator`'s validation, the real add, the
no-op-not-409 duplicate behaviour with the original `added_by` kept,
the same person collaborating on two invoices independently;
`handleListCollaborators`'s 404, empty case, and earliest-added-first
ordering with both names; `isInvoiceCollaborator` true/false).
`workers/vf-app/test/org-route.test.ts` **142/142** (136 pre-existing +
6 new for `handleSearchUsers`: blank/null query short-circuits before
touching the database, name match, case-insensitive email match, a
disabled user excluded, results ordered by name). `workers/vf-app/
test/index.test.ts` **161/161** (152 pre-existing + 9 new, through the
real router: the invite route itself working and refusing a
`Procurement.Collaborate`-only caller; a real collaborator opening the
invoice, its document, its pages, and its progress; a real collaborator
reading the activity feed and posting a comment; a `Procurement.Collaborate`
holder never added still refused; a real collaborator never granted the
permission still refused — proving both halves of the check are
actually required, not either alone; the roster on one invoice not
leaking access to a second the same person was never added to; the
user-search route working and its own `AP.Review` gate). `workers/
vf-app/test/activity-route.test.ts`, `test/stage-permissions.test.ts`,
`test/team-route.test.ts` run together with `index.test.ts` and
`org-route.test.ts` beforehand, **350/350**, confirming nothing this
phase touched regressed the activity feed, the closed permission-
vocabulary discipline, or the team-membership precedent this phase's
own no-op-vs-409 design question was resolved against.
`workers/vf-licence`'s full suite **320/320** (unchanged in count —
migration `0158` adds rows to the existing `ui_strings` table, not a
new test file), including `string-coverage.test.ts` **10/10** with the
five new keys required. `tsc --noEmit` on `vf-app` shows no new errors
in any touched file — the only findings are the same pre-existing
`cloudflare:test` module-resolution noise and pre-existing,
out-of-diff findings in files this decision did not touch
(`ap-assistant.ts`, `coding-list-route.ts`, `ledger-route.ts`, and the
same `workflow-engine.test.ts` lines decision 0469 already documented
as pre-existing). `eslint` clean on every file this decision touched,
backend and frontend. `node --check` clean on both new/edited frontend
JS files. **A full, unfiltered `vf-app` suite run timed out at ten
minutes without finishing** — the same known timeout decisions 0448,
0449, 0451, and 0452 already hit and recorded; verification here is
targeted, the same discipline decision 0452 itself used for the same
reason.

## Still to do, operator side

Push, deploy, and apply migration `0158` (`vf-licence`) once confirmed
— no `vf-app` migration this time, since `invoice_collaborators` and
`Procurement.Collaborate` both already existed and were already live
from decision 0469. Then: decide whether a "remove collaborator" route
is worth building, and separately, whether `Procurement.Approve`
(a Business User completing their own Non-PO approval task) is the
next piece of work — genuinely its own decision, not assumed here.
