# Handover

**Written 4 September 2026, updated 17 September (three times).**

**For a session starting cold.** Where things stand, what needs a
decision rather than work, what to do next, and the habits this project
has earned the hard way.

It holds **only what the other files cannot give you**:

- `docs/PROGRESS.md` — the map. What exists, what does not.
- `docs/decisions/` — the authority on *why* anything is as it is.
- `docs/decisions/SUPERSEDED.md` — what stopped being true.

**Nothing is struck through here.** When a thing is done it leaves this
page and appears in `SUPERSEDED.md`, because two copies of the same
history is one copy that lies — and the stale one is always the copy
nobody is told to check.

**Read `SUPERSEDED.md` before trusting an old record.** Records are never
rewritten to agree with later ones, so **contradictions between them are
real and neither is wrong** — they are dated. That page maps which
supersedes which, and it exists because the trap has been fallen into
twice.

---

## Where things stand

| | |
| --- | --- |
| `origin/main` | `a16b155` |
| vf-admin deployed | `8e27a34` · `https://admin.vibefinance-ai.com` · behind Cloudflare Access |
| vf-app deployed | `d0f2b65` |
| vf-licence deployed | `a235713` |
| vf-ui deployed | `45ab351` · `https://app.vibefinance-ai.com` |
| Domain | `vibefinance-ai.com` · **email intake receives real invoices** |
| `vf-app-poc` migrations | through `0069` |
| `vf-licence-poc` migrations | through `0120` |
| Tests | vf-admin 9 · vf-app 1912 · vf-licence 320 · vf-ui 74 Worker + 651 browser · shared 278 (+3 known pre-existing failures) |
| Decision records | 382 |

**Everything committed is deployed again.** Decision 0382 (phase 2 of
the document viewer — the client-side page renderer) touched `vf-ui`
(the renderer itself, its icons and CSS, and a vendored copy of
pdf.js) and, via one migration, `vf-licence-poc`'s data (five new UI
strings) — no `vf-licence` code changed, so that Worker itself did not
need redeploying, only the migration running against its database.
**Confirmed against the live origin, not just reported**: `vf-ui` is
now deployed at `45ab351` — `/page-renderer.js` and
`/vendor/pdfjs/pdf.min.mjs` both `200` where neither existed before —
and migration `0120` is applied against `vf-licence-poc` —
`/api/ui-strings?locale=en` now returns `"viewer.zoomin":"Zoom in"`.
`vf-app` stays at `d0f2b65`, untouched by this phase. Everything
through decision 0381 was already deployed and confirmed there.
**vf-app's count reads 1893 at `23f5938`, then 1912 with 0381**, and
separately, 1893 not the 1851 recorded through 0379, with no `vf-app`
change since 0378 — the difference is not explained, only measured
(0380). **vf-ui's browser count reads 651, up from 631** — the new
page-renderer widget's own 24 tests, plus four retired and two
rewritten where decision 0382 removed the `<iframe>`/`<img>` split
they asserted against.
**And the vf-ui browser suite exits 1 with every test passing** — 135
unhandled rejections now, was 136 at `46c1da2` (decision 0380) —
mostly a test's own per-URL fetch stub refusing a request the test
never stubbed, thrown inside work the viewer deliberately does not
await. Counts in this table are tests passing, not clean runs. Worth
fixing on its own; see 0380.
`vf-admin` untouched this arc —
its own last commit predates decision 0298, listed as-is rather than
guessed at.

**There are four Workers now.** `vf-app` per customer, `vf-licence`
shared, `vf-ui` shared — the customer's interface, its own deployment
because binding it to `vf-licence` would mean every UI change
redeploying the component that mints licence tokens for the whole fleet
(0099) — and `vf-admin`, the operator's, behind Cloudflare Access
(0186).

`shared`'s own three known failures: two are time-expired JWT keys in
the licensing token tests, failing on `main` since before any of this
work. The third — `migration/table-classes.test.ts`, "names each one
exactly once" — reports six unclassified tables, not the four first
found on 15 September: `_supplier_links`, `dashboard_cards`,
`dashboard_cards_new`, `document_comments`, `org_spend_limits`, and
`org_teams_new`. The last two were added by decisions 0334 and 0333
respectively, before this update, and never classified either — worth
a real fix, still not done.

---

## What the system does

**`docs/PROGRESS.md` is the map** — what exists, what does not, and the
reasoning for each. This page does not repeat it.

In one paragraph: an invoice arrives by email, by upload, or as UBL. It
is captured whether or not anything can read it, evaluated against rules
a customer wrote **in plain English**, and routed through a process of
stages where people key, approve and return it. Every visible word comes
from the control plane and every colour from a token, so a wording fix
or a new language is rows rather than a deployment.

**Ten screens**, grouped in the side nav (0346): Dashboard, Tasks and
Documents under Accounts payable; Suppliers under Supplier management;
Access, Sources, Purchase Orders, Rules and Processes under
Configuration — and the viewer that serves every stage. *(This line
read "Seven screens" until decision 0380, from before the Dashboard,
Purchase Orders and Processes existed.)* **Roles was renamed Access and
restructured into tabs this arc** (0333) — Org Units, Roles, People,
Teams, no longer four sections on one long scroll, with Org Units and
Roles themselves hidden from a delegated administrator holding only
`Admin.UserManagement`. Roles itself dates to 0319–0331: read for
anyone holding `Admin.Configure` or a scoped `Admin.UserManagement`,
write (creating and editing a role, assigning and revoking one,
creating a person) for the same permissions, kept deliberately
separate — editing what a role itself grants is instance-wide and
never delegable, where assigning an existing role to a person already
was (0201) and stays so. **Teams are real** (0332): the two routes that
already existed gained the three that did not (list, remove a member,
rename), every one gated, and every team now belongs to exactly one
org (`unit_id NOT NULL`, migration 0064) rather than sitting outside
the scoping every person already has. **A person's own properties are
real too** (0334): cost centre, manager, address, and a derived Budget
Holder flag, plus a genuinely new spend limit distinct from the
existing approval limit. **Creating and editing an org unit is real**
(0335), closing a real, previously-unauthenticated `POST /org/units`
gap along the way. **The org list is a real tree, not a flat sort**
(0336) — a child now sorts immediately beneath its own parent, the
way the screen's own indentation had always implied it should.

**Role allocation and property assignment are two separate pop-outs
again** (0337), each reached by its own icon in the row rather than a
single click on the row itself (0338 moved those icons into their own
columns once stacking them beneath a cell's own text grew every row
too tall) — reported live as *"not very user friendly"* when 0334
first combined them into one. The approval and spend limit currency
fields are a closed dropdown now, not free text (0339), corrected
twice more after building: to the real, researched Peppol BIS Billing
3.0 / ISO 4217 list rather than a stated four-currency guess (0340),
then filtered to the 156 of those 178 codes a company can actually
purchase with — precious metals, bond-market units, and ISO 4217's own
"funds" excluded (0342) — with the field's own width fixed twice more
along the way (0341, 0343, 0344).

**The side nav is grouped under three static headings** (0346):
Accounts payable, Supplier management, Configuration — distinct from
a single, collapsible "Vibe AP" folder decision 0274 built and 0276
reverted; nothing here expands or collapses, and a heading with
nothing unlocked beneath it is never shown. **Sources gained icons on
Rename, Retire, and a repositioned Create action** (0347), and its own
Rename and Retire confirmations are real, in-app pop-outs now rather
than native browser dialogs, which could never be made to look like
part of this app (0348).

**An org switcher** sits in the topbar for the first time: a person
holding a role at more than one org picks which one they are looking
at, and Tasks, Documents, Dashboard, and Suppliers all narrow to it
(0313–0316) — narrowing what is shown, never granting anything a
person could not already reach some other way.

**An invoice bills a company** (decision 0226), matched on its buyer
VAT id or electronic address. **Which department bears the cost is a
line-level question** and is not built — decision 0225 named three
things that were sharing the word *business unit*, and decision 0226
settled the first. The Coding stage, where a line is charged to a cost
centre or GL code, **does not exist**.

**The supplier mirror is built end to end** (decisions 0207–0219): a CSV
loads from the customer's ERP, an arriving invoice matches on the
seller's endpoint or VAT id, a pay site wins where several sites share a
number, and a load re-matches whatever was unmatched. **Nothing reads
the terms, hold, match option or tolerances** — they load, they display,
and no process consults them.

**Both party cards show our own record beside the image** (decisions
0219–0229), with a search on each for choosing by hand.

**And a supplier can be recorded before the ERP has one** (decision
0231). `erp_identifier` is nullable, `supplier.awaitingErp` is a fact a
rule can test, and **the next load adopts that row** and fills the
identifier in — which is decision 0233, and the whole sequence the
operator described. **The trigger now exists** (0350): Supplier
Maintenance is a real, separate workflow, not a stage on the existing
AP process, closing a gap decisions 0231 and 0233 both named and
deliberately left open until there was a real team and stage to write
the routing rule against.

**The Suppliers screen is complete as a piece** (decisions 0230, 0234,
0236, 0237): load a file or record one, click a row to hold, release,
activate, deactivate or edit — with a warning on save that the ERP is
the master and the next load overwrites this. **`supplier.onHold` is
testable and no rule reads it**, which is the same shape. **Real,
permission-based scoping arrived later** (0358): reading the list had
never been unit-scoped at all, and the dashboard's own supplier card
was silently using the wrong permission's visible set. **Search and
real, server-side pagination followed** (0378, mirroring 0376's own
work for Purchase Orders below) — which forced a fix to the status
ring and its click-to-filter, both of which had computed themselves
over the fully-loaded array in the browser and would have silently
gone wrong the moment that array became only one page.

**A UBL invoice is rendered as a document** (decisions 0205, 0206), at
capture and stored beside the original — A4 portrait, using OpenPEPPOL's
own CSS, code lists and labels, with a notice saying it is a rendering
and what of. **We could not run their stylesheet**: it is XSLT 2.0,
browsers do 1.0, and SaxonJS fails on import inside `workerd`.

**Proven on real documents**, not only in tests: a photographed invoice
has been read automatically and reached Payment-eligible with nobody
touching it, and one the model could not read was retained, explained on
screen, and left to be keyed.

---

## Since 15 September (0349–0380)

**Three genuinely separate arcs**, each closing a gap this document
itself used to name as open, plus smaller fixes along the way.
Supplier Maintenance (0350) and Suppliers' own search, pagination, and
permission scoping (0358, 0378) are covered above, in context.

**Process version control, finally wired up** (0349, 0352–0354).
Decisions 0150 and 0160 designed and built the foundation and said
plainly what was missing — "nothing creates a v2." A draft is not new
schema: it is the rows already sitting at `processes.version + 1`,
real the moment the first edit is made, gone entirely if discarded.
Along the way, three more real, previously-unauthenticated or
unreachable write routes were closed, the same class of gap this
project keeps finding rather than a new kind. Two real bugs in the
Rules screen itself, both found live and both the same shape in
opposite directions (0351, 0355): a stage list with no `WHERE
process_id = ?` at all, and a rule list that showed everything rather
than nothing when a process had no stages.

**Purchase orders, built end to end** (0370–0377) — the largest single
piece of work in this window. Line-level matching against a real
Peppol BIS Order Only 3.3 vocabulary, CSV load alongside XML
ingestion, org derivation and real, permission-based access control
matching what Suppliers already had, then search, pagination, and a
full status lifecycle (Active/On-Hold/Closed, with Invoiced
Part/Full derived live rather than stored) mirroring Suppliers' own
mechanisms rather than inventing new ones. **A real SQL bug was found
and fixed by testing, not by inspection**: `GROUP BY status` silently
grouped by the real, underlying column rather than the computed
expression sharing its name, since SQL resolves an unqualified
identifier against a real column before a `SELECT`-list alias —
collapsing rows with genuinely different statuses into one group.

**The Dashboard reshaped, mostly in direct response to live reports**
(0359–0369): the default screen at login, two real width bugs found
one at a time because the first fix didn't look at the sign-in screen
too, the org switcher relaunching whatever is open instead of
reloading to the default, a bar chart for Waiting for Me with two of
its own bugs fixed after shipping, and card layout arrived at only
after two earlier attempts (0364, 0365) each made the same underlying
problem smaller without closing it — a card's own stored order and
the band sorting it into disagreeing — until the bands themselves were
removed entirely (0366).

**One bug, in two files, found only because a test exercised failure
after success**: `loadStatusCounts()`, on both Purchase Orders' and
Suppliers' own status charts (one screen's own version was written by
copying the other's), returned early on a failed fetch without ever
resetting its own counts to `null` — a chart that had once loaded real
data kept showing it, silently stale, after a later, genuine failure.
Fixed in both files the same day it was found.

**The viewer's document frame, and a premise measured before fixing
it** (0380). A review of every past discussion of the viewer found a
comment claiming the preview was "refreshed when somebody returns to
the tab" — nothing did. Measured in Chromium before building that: an
expired link breaks nothing while a frame sits, scrolls, zooms, hides
or the tab changes; it breaks only when the frame *loads again*, and
then shows `vf-app`'s JSON error rather than going blank. So the fix is
the frame's own `load` event, not a timer — a return-to-tab refresh
would have reloaded a working PDF and lost the reader's place. The same
review corrected three stale comments, four missing `SUPERSEDED.md`
rows and one misattributed one, and the screen and test counts above. **Safari and Firefox were not measured.**

**Smaller, on-request fixes**: the Org Units table now shows Parent
Org and Tax Identifier as real columns, both data the edit form
already had and the table simply never showed (0379); the recorded
title "VAT ID" reads "Tax Identifier" everywhere, one string read by
both the table and the form so the two can't drift apart.

**The document viewer's ultimate shape was designed, and its first
phase built** (`docs/design/document-viewer.md`, decision 0381). The
operator's own request — one viewer for images, image PDFs and
structured PDFs, a thumbnail rail, rotate and zoom, and an Expand that
pops the whole document panel (Timeline/Chat included) into its own
window for two-screen use — was parked since decision 0123 and picked
back up straight out of 0380's review. Three decisions came out of that
conversation: build a real client-side page renderer rather than lean on
the browser's own PDF viewer (phase 2, the largest single piece), keep
retaining every page of a multi-page scan rather than reconsidering
whether to, and have the pop-out carry the whole panel, not just the
image. **Phase 1, built now, is backend only**: checking decision 0068's
own claim that the multi-page flow "deletes on finalise" turned up
nothing that deletes anything, anywhere — every page has been sitting in
R2 since decision 0045, unreachable rather than gone, because finalising
never linked a multi-page invoice into `invoice_documents`. Two new
routes (`GET /invoices/:id/pages`, `POST
/invoices/:id/pages/:n/document-url`) and one unauthenticated fetch route
(`GET /document-pages/:token`) now expose what was always there, with
their own signed token shape alongside decision 0073's. Nothing in the
viewer called any of it yet — phase 2 is what calls it.

**Phase 2, the client-side page renderer, built the same day** (0382).
One thumbnail rail, one zoom, one rotate, shared by images and PDFs —
`page-renderer.js` replaces the `<img>`/`<iframe>` split the Document
tab used since decision 0123. The one open question the design
document left — reset rotate/zoom on open, or remember it — was asked
directly and decided: reset, a session convenience rather than data.
pdf.js is vendored locally (`workers/vf-ui/public/vendor/pdfjs/`), not
loaded from a CDN, the same reasoning decision 0124 gave the font.
**Nobody planned this separately, but phase 2 retires decision 0380's
whole problem**: that bug could only happen because an `<iframe>` is a
live connection that can reload with a link gone stale; a canvas is
pixels already drawn, so nothing reloads it and nothing can ask an
expired token again. A real bug was caught by the new test suite's own
completeness check before it ever shipped — `REAL_DEPS` was missing
the `resolvePages` key `pageViewer()` actually calls, watched to fail
and fixed. Phases 3 through 5 are still design only.

## Waiting on you

**Nothing blocks the next piece of work.** Six things worth settling,
none urgent.

### 1. Who creates the `org_users` row — **answered**

**Provisioning does**, for the requester, who becomes the customer's
administrator (0117). `signup_requests` already names them, so there is
no bootstrap account to invent — and approval still gates provisioning,
which the administrator is a consequence of rather than a substitute
for.

Not built, and **its place in the order moved**. Decision 0117 put it
third behind email; decision 0126 made the **Cloudflare API half of
provisioning** the blocker in front of both, because provisioning is
where the `org_users` row is written and provisioning cannot yet create
anything.

### 2. Alerting on failed sign-ins

*"A lockout policy that generates no alert is half a control."* Attempts
are recorded and shown to the person on their next sign-in (ISO 27001
A.8.5), but nobody is **told**.

Waiting on email, which decision 0117 promoted from *"would be nice"* to
the gate on onboarding itself.

### 3. Do the party panels show enough?

Decision 0115 gave the seller and buyer their own panels, and most of
their fields default to `read`. If they look thin, that is configuration
(0114) rather than code — adjustable per customer without a deployment.

### 4. Two actions that sound like the same thing

Found twice on the first day of real use (decisions 0153, 0158).
*"Hold it for review"* wants `assign_task` and the vocabulary offers
`hold_until`, which holds until a **date**. *"Assign to the AP team"*
wants `assign_task` and the model chose `assign_org`, which assigns an
**operating unit** (0111).

Both are the same question: **does the compiler's prompt teach the
difference, or does the vocabulary stop sounding ambiguous?** A prompt
is cheaper and keeps the closed set small, which 0031 argues for.

### 5. Does the sources screen read right?

**Renaming is free** — `name` is display, `id` is the key, and nothing
references the name:

```
UPDATE process_stages SET name = 'Intake' WHERE id = 'received';
UPDATE process_stages SET name = 'AP Review' WHERE id = 'review';
```

**Removing Line Review used to need decision 0150's own versioning,
which now exists** (0349). It has a completed task against it, so
deleting the row directly would still fail on a foreign key or orphan
history — but a draft of the AP process can now genuinely drop it from
a new version's own membership, with existing instances finishing on
whichever version they started, exactly the mechanism decision 0150
designed. Nobody has actually done this yet; the mechanism blocking it
is what's gone.


Decision 0134 removed every success message from it: a retired source
shows *"Retired"*, a deleted one is gone, and the list is the answer.
**If an action now feels like nothing happened**, that judgement was
wrong and the message should come back.

### 6. Should the line comparison move into the panel?

*"Lines total 150.00 · differs by 30.00"* sits under the line table and
was **read as an exception** (0119). It is not: it is live feedback as
somebody types, where the panel reflects a stored verdict.

They are genuinely different, which is why they sit apart. **The
distinction was not obvious to the person looking at it**, which is
worth more than the argument for keeping them separate.

---

### 7. Columns that are empty on every invoice

Extraction reads a description and an amount per line and nothing else,
so `Line no.`, `Unit`, `Item net price`, `Quantity` and `VAT category`
are blank on every real document (decisions 0171, 0172).

**A column that never has a value teaches somebody to ignore columns.**
Either extraction learns to read them — `BT-152` in particular, which
two derived columns depend on — or a field with nothing in it stops
being shown.

### 8. What "how much has been keyed" should count

Decision 0175 removed a status reading *"0/4 fields known"* on every
document, counting four fields chosen when the screen was written.

The idea was right and the implementation was not. **A real version
counts the fields the current stage asks for**, which is a question
about field visibility rather than about a hardcoded list.

### And two data changes, not code ones

**The live Validation rule** reads *"assign a task to the AP team
requiring **AP.Review** permission"* where it should say `AP.Validate`.
The rule engine is doing exactly what the sentence says; **the sentence
needs recompiling** and taking through the activation gate. No deploy.

**And Approval spawns two tasks per invoice** — seventeen open requiring
`AP.Approve` and seventeen requiring `AP.Review`, against the same
stage. That may be parallel approvers by design (0074 describes how
multiple approval works) or a rule firing twice. **Nobody has
established which**, and the two readings have different fixes.

---

## Suggested next pieces

**The most immediate one: phase 3 of the document viewer**
(`docs/design/document-viewer.md`, decisions 0381–0382 built phases 1
and 2). The embedded XML in a structured PDF (Factur-X, ZUGFeRD)
becomes its own retained artifact, so those invoices get an XML tab
the way a bare-XML invoice already does. Phases 4 (the pop-out window)
and 5 (retiring the old preview and raw-file Expand) both wait on this
one.

**Built this arc, closing out most of what was named here before:
teams, most of the "user variable" fields, creating and managing an
org, and the org list's own tree ordering.** Reported live in one
request — "a UI for creating Users, allocating user variables,
allocating roles to user, and assigning users to teams. creating and
maintaining teams" — deliberately scoped down to one piece at a time
rather than built all at once (0328 onward), and each piece landed in
turn: teams (0332), the Access screen's own tabs (0333), user
properties (0334), org create/edit (0335), org tree ordering (0336).

**What is still genuinely new schema, not yet built**: a picture (no
image storage exists for anything user-related — the real lift here,
deliberately not started), a forename/surname split (today one `name`
field, and splitting it touches every place a name is already
displayed), and a business title. Cost-centre allocation *for a
person* is built (0334) — the field this note used to name as
missing.

**Rules and Sources as further Access tabs** were discussed and
deliberately scoped out of 0333 — Org Units, Roles, People, and Teams
are the four tabs today; a fifth and sixth would each need their own
scoping decision, not an assumption that they belong alongside the
other four.

**Teams have no org-scoping in the task-queue sense.** `org_teams.unit_id`
(0332) scopes who may *administer* a team's own definition and
membership; task assignment still names a team by id directly, with
nothing narrowing which teams a given screen offers based on the org
a task or document belongs to.

**1. Cost object approval** (decisions 0184, 0195) — **the frame is
built; nothing calls it.**

A **ledger** exists (Oracle's word; SAP's *controlling area*), legal
entities account in one, and a cost centre hangs beneath it with a
parent, an owner and a limit. `resolveApprovalChain` walks it in
decision 0184's **Limit** mode and is called by nothing.

**The next piece** is wiring it to `assign_task`, which still names one
team or one person.

*The original design note:* Cost object approval (decision 0184) — **designed, not built.**
An invoice line finds its approvers from its cost centre, and how many
it needs depends on a hierarchy: *"1, 2 or none or 6."*

**It has a name and two established shapes**, taken from SAP Concur and
Oracle Fusion rather than invented. **Level** walks every rung to the
top; **Limit** stops at the first person whose signing authority covers
the amount; and a step is one or the other, **never both**.

**Parallel across cost centres, serial within one** — which is what
*"serial line-level approval"* meant. Decision 0183's per-line tasks are
the parallel half and already work.

**The hierarchy is one of cost objects, not org units.** Escalation
climbs to a *parent cost object manager*, so a cost object carries a
default approver, a limit, and a parent of its own — which vindicates
decision 0031's separation for a reason it did not anticipate.

`org_authority_limits` is the signing authority, **written by a route
and read by nothing**, and `BT-133` is the line's cost centre. **The
join is missing**: a cost object has no approver, nothing walks a chain,
and completing a task advances nothing.

**The first question to answer** is whether the amount tested is the
line, the cost object's portion, or the invoice total — the sources
disagree, and it decides which approvals a split invoice needs.

**And the configuration screen that goes with it** (decision 0185).
Supervisory approval and cost object approval are **the same algorithm
over different trees**: start somewhere, walk up, stop when a signing
limit covers the amount. A third strategy is then a tree and a starting
fact rather than a rewrite — decision 0031's *"the vocabulary is closed,
and that is the feature"*, applied one level up.

`org_units` is already a tree and `org_users.unit_id` points into it, so
**the people hierarchy exists indirectly**. What no node of it has is a
manager.

**2. Unit-scoped configuration** (decisions 0192, 0196) — **rule sets
are scoped; nothing else is.**

**Update, this arc (0313–0331): roles now have a real UI, not only a
scoped assignment.** The Roles screen — read (0319–0323) and write,
including assignment (0326–0328) — is what closes that gap. **Teams
are scoped too now** (0332): every team belongs to exactly one org
(`unit_id NOT NULL`), with a real UI (0333) reached through the
Access screen's own Teams tab. **Still customer-wide, unchanged**:
settings.

A unit may override a stage's rule set, resolved by one walk in
`unit-config.ts`. A process was the wrong grain: France and Germany want
the same stages and different thresholds, so scoping the process would
duplicate seven stages to change one rule.

**Field visibility too** (decision 0197), per field so that restricting
one field in France cannot silently drop what the group said about every
other — decision 0143's trap, one layer along.

**Roles are scoped too** (decision 0199) — on the *assignment*, so one
*AP Manager* definition is held per org. **But applied in one place**:
fourteen permission checks exist and one is unit-aware, so a person
restricted to France cannot see German documents in the document
manager and can reach one by other routes. **That is not a boundary
yet**, and 0199 says so. **The count is stale as of this update**:
Suppliers (0358) and Purchase Orders (0375) have each since gained
real, permission-based scoping through the same `unitsWherePermitted`/
`scopedToChosenOrg` mechanism — more of the fourteen are unit-aware
now than when this was written, though nobody has re-counted the
full set since.

**And a stage may declare its permission** (decision 0200) — the
vocabulary was already right, since 0010 named permissions after
business activities and the activities are the stages. A rule asking for
something else is refused rather than quietly corrected. **No stage
declares one yet.**

**And delegated administration** (decision 0201): a role is granted in
an org by somebody who administers it, bounded above as well as below —
granting *everywhere* is refused, because it reaches further than the
granter holds.

**A regional manager needed no new mechanism**: a role is a list of
permissions and an assignment carries a unit, so *AP Manager (France)*
is the two together.

**And the org endpoints were ungated for ever**, not only at bootstrap
— decision 0010's reason holds while there is nobody, and stopped
holding the moment one person existed. Now authenticated once anybody
exists.

**And the task list is unit-aware** (decision 0202) — a German
validator is no longer shown French work, which was 0199's largest
recorded gap. **Claiming and completing are too** (decision 0203) — the last place the
boundary was a screen rather than a route. **Twelve of fourteen
permission checks still ignore the unit**, and those two are the ones
that matter most — the same stale count noted above; Suppliers and
Purchase Orders have each since joined the unit-aware side.

**Still customer-wide**: teams, settings.

**And the screen agrees with the route** (decision 0198) — which meant
loading the invoice before the fields, because its unit now decides
which are editable.

**An invoice can place itself** (decision 0204). A source chooses a
fixed org or `<Automatic>`, and `<Automatic>` reads the buyer's
identifiers off the document — decision 0036 added those columns in
September and nothing had ever read them.

**A match names a legal entity and an invoice needs an operating unit**,
so one department beneath it is unambiguous, several means *"the entity,
and no particular one"*, and none needs a department created. All three
are recorded in `org.unplaced`, **which no screen reads.** And
it is not a boundary — everybody sees every invoice.

*The original design note:* Unit-scoped configuration (decision 0192) — **designed, not
built**, and it touches almost everything.

**Two questions, not one.** *Must these units be hosted apart?* Then
they are separate **environments** — per-customer D1 and R2 exist for
isolation and residency (decision 0001). *May they share a database?*
Then this applies.

**The second is the case you have.** Residency splits are transatlantic;
a European group shares a database because it may, not as a compromise.

**And a contradiction worth knowing about**: `environments` has `UNIQUE
(customer_id, kind)`, so one production environment per customer — while
decision 0083 reasoned about *"a customer with EU and US instances"* and
built the sign-in screen an environment picker for it. **The interface
expects a shape the database forbids.** Harmless until a customer is
transatlantic, and recorded rather than lifted.

Four things carry a unit today: a person, an invoice, a source, and
which national rules apply. **Roles, teams, processes, rule sets and
field visibility are customer-wide**, so France and Germany share every
one.

The chosen shape is a nullable `unit_id` where null means *the group's
own* — so nothing migrates — and a resolver that walks up decision
0036's tree.

**The trap is the whole risk**: forgetting the unit does not fail, it
returns the group's answer. `resolveTenant` has a lint rule that makes
the equivalent mistake uncompilable; this has no equivalent, because the
column is nullable by design.

**Permissions have an answer now** (decision 0194): Oracle Fusion scopes
the **role** to a unit and lets a person hold several, so *AP Approver
(France)* and *AP Approver (Germany)* are two rows and a group treasurer
holds both. `org_user_roles` is already `(user_id, role_id)`, so this is
a column on `org_roles` and **no change to `hasPermission`**.

**And decision 0036 landed on Oracle's own model without knowing it** —
Legal Entity and Business Unit, with Oracle's older name for the second
being literally *Operating Unit*. Decision 0194 records what Oracle has
that this does not: a **ledger**, a **division** that can span legal
entities, a **department** separate from a business unit, and a shared
service centre serving several entities, which decision 0036's
invariant forbids.

**3. Measured pagination and annotation** (decision 0206) — **one piece
of work, by the operator's own choice.**

Both need to know where things are inside a rendered document, and both
need **same-origin delivery**: the document URL is minted on `vf-app`'s
origin and the viewer runs on `app.vibefinance-ai.com`, so the iframe is
cross-origin and the parent can read nothing.

**A same-origin iframe, not a shadow root** — that correction is in 0206
and the reason matters: shadow DOM isolates CSS and **not JavaScript**,
and this document is built as a string with an `esc()` on every
supplier-controlled value.

**And annotation here beats annotation on a photograph**, because a
field can carry its Business Term — an annotation anchored to `BT-48`
survives re-rendering, zoom and translation, where a coordinate on an
image does not.

**4. Coding — where a line is charged.** **The largest gap, and the one
the operator's own correction pointed at** (decisions 0225, 0226).

An invoice bills a company; **which department bears the cost is
per-line**, and routinely split — *"a purchase for stationery is booked
across multiple departments, cost centers and GL codes."*

`invoice_lines.cost_centre` has existed since decision 0007 and
`BT-133` since decision 0031. **Nothing assigns one.** A PO would carry
it, and without a PO the Coding stage does — and that stage does not
exist.

**5. A rule that reads the supplier fields.** All of them are now facts
a rule can test — hold (decision 0230), terms, match option and
tolerances (decision 0238) — and **no rule reads any of them.**

**That is deliberate.** The sentences are a customer's: *"if the
supplier is on hold, route this for review"*, *"if the match option is
three-way, visit Matching"*. **What is missing is a customer writing
one**, and the match option in particular still decides nothing — the
stages an invoice visits come from a process definition.

**6. Process configuration, versioned — built** (0349). Real version
control landed as described: `process_stage_versions (process_id,
version, stage_id, sequence)`, leaving all six foreign keys untouched
and making removing a stage "not in this version" rather than a
deletion that orphans history. An invoice finishes on the version it
started; rules still resolve on arrival. A draft is not new schema —
it is the rows already sitting at `processes.version + 1`.

**7. Email sending**, which decision 0125 evaluates. "Email" means three
different things — supplier contacts *out to strangers*, user
notifications *out to colleagues*, and a source which is *inbound* and
not sending at all.

Its order: **the sending mechanism** with the administrator's password
link (which blocks onboarding entirely), then **users**, then
**suppliers**. Sources are as far as they can go without item 1.

Two questions answered: a source's address lives on a **VibeFinance
domain**, and a user's role is a **job title**, so the column is named
`job_title` — a column called `role` beside a roles table is an
invitation to two answers about what somebody may do.

Still open: **which provider**, **where sending lives** (0091 says the
control plane never holds customer content), **whether templates sit in
D1** like `ui_strings`, and **what happens when sending fails**.

**8. BG-4 and BG-7 in the vocabulary.** The seller and buyer field lists
live in the viewer (0115). Recording business-group membership in
`shared`, as `INVOICE_LINE_FIELDS` does for BG-25, is the consistent
thing and a known shortcut until it is done.

**9. BG-23, the VAT breakdown.** Mandatory and **repeating** — one entry
per VAT category and rate, whose tax amounts must sum to BT-110. The
flat facts model cannot hold a repeating group (0112). A design
question, not an omission, and *"one of the most common causes of
validation errors"*.

**10. Despatch Advice (T16) — the two-way matcher is now built, and
this is what's left.** `po.matched`/`po.variance_pct`, and now real
line-level matching too (`po.line_matched` and the two line variance
fields), are computed live rather than declared and left uncomputed
(0370) — the gap this item used to name as blocking the matcher
itself is closed. What remains is exactly the goods receipt, the
missing third leg of three-way matching. BT-132 now exists, which is
what lets matching compare a line to an order line.

**11. Acting on `cbc:CustomizationID` beyond rendering.** Decision 0205
reads it to decide whether a document is Peppol BIS 3.0 and refuses the
rendering otherwise — which is the first thing to use it. **Nothing
routes or validates on it**, so a document from another profile is
processed as though it were this one. **Purchase orders now have their
own, separate ingestion path** (`POST /purchase-orders`, decision 0370)
rather than being detected automatically within `/sources/:id/capture`
itself — a real Order is matched against, but the underlying gap this
item names is still there: the capture pipeline itself still cannot
tell a Peppol Order from an Invoice by its own `cbc:CustomizationID`.

*The original note:* Reading `cbc:CustomizationID`. BT-24 is now read into the facts
(0112), so the discriminator is available; detection still does not use
it, and a valid Peppol Order sent to `/sources/:id/capture` is refused.

**12. `party.first_document`**, the **all-users task view**, a **screen
for placing an invoice** by hand, and **four more languages** —
`GET /ui-strings/keys` shows the gaps.

---

### Two habits this week earned

**A failed remote apply is not a no-op** (decision 0235). `wrangler`'s
file import does not roll back across a whole migration, so a failure
halfway leaves the database part-changed — **check the schema, not the
bookkeeping table**, before retrying.

**And replay runs against empty data.** A migration that cannot survive
a database with rows in it will pass every check here. The honest fix is
a fixture and it is not built.

### The citation check runs with the tests

**Nineteen comments cited two records nobody had written** — decisions
0188 and 0224, found by comparing citations against `docs/decisions/`
and not by anyone reading the code.

`npm test` now runs `scripts/check-citations.py` first. It names the
record and where it is cited, and **it was watched to fail** by deleting
decision 0224 and seeing it report eight references.

**The convention is that a citation can be followed.** Twice it could
not, and neither was noticed while writing three of the records in
between.

## Habits worth keeping

`docs/PROGRESS.md` has the longer list.

### The shape this project keeps finding

**A real mechanism, aimed at something that used to be true.** Not a
missing check — a working one, pointed slightly wrong.

| | The mechanism | What it was aimed at |
| --- | --- | --- |
| 0084 | A migration test | Existing rows, not new ones |
| 0093 | A standing invariant | Detection, where prevention was claimed |
| 0097 | `isAdminRoute` | Routes it never reached |
| 0100 | A lint rule | Output nobody read |
| 0103 | A counts test | A page that happened to hold the task |
| 0105 | A session test | The helper, not the routes calling it |
| 0109 | A keying screen | A line's columns, not its facts |
| 0110 | A vocabulary | Two of six mandatory line terms |
| 0112 | A vocabulary, again | Two of eight mandatory header terms |
| 0119 | A validation route | A block assembled by hand, which the validator had outgrown |
| 0120 | A keying form | A summary of five fields, once the form offered more |
| 0124 | A font stack | A face nobody's machine had installed |
| 0126 | A configuration screen | Listing sources, while the create route sat unreachable |
| 0131 | A proxy allow-list | Every path beneath `/sources/:id` but not the path itself |
| 0132 | A translation system | Every label, and none of the sentences the API sent |
| 0143 | A stage restriction | Three fields somebody listed, not the ones added later |
| 0144 | Field visibility | The screen, never the route — since September |
| 0152 | A visit timeline | Stages minutes apart, never a straight-through second |
| 0157 | An authoring flow | Somebody doing it in one sitting, never leaving halfway |
| 0158 | A read-back | A combinator, never a rule that is one condition |
| 0165 | A viewer | One caller, so its requirements read as facts |
| 0167 | A viewer | A task, never a document nobody is working on |
| 0170 | Extraction | A model that reads badly, never one confident about it |
| 0174 | A line save | Every field the screen holds being a field it sends |
| 0212, 0324–0328 | A proxy allow-list | Six routes, real and tested in `vf-app`, never once added to `vf-ui`'s own list of what it will forward |
| 0337, 0338, 0339, 0346, 0347 | A test file's own strings stub | The new keys a change actually introduced, not the ones the file already had — hit five separate times across one arc, each time cascading into several unrelated-looking failures traced back to the same missing key |
| 0341 | A `flex: 1` CSS rule | The row shape it was written for (0332's team-member picker), not the different shape a later decision (0334) put in the same class |

**And this table itself.** It was removed by a rewrite of the section
above it, and three later edits claimed to add rows to a table that was
no longer there — a scripted `replace` finds nothing and changes
nothing, silently. Rebuilt here.

---

**Check one layer against another.** Fifteen divergences found this way and
none any other way: a column with no vocabulary entry; a fact never
declared; settings reaching nothing twice over; a parser populating half
its fields; a constant contradicting its own contents; a storage layer
nothing called; a content type derived from half a detection result; a
migration checksum written and never compared — under a comment
asserting it *was* verified; and three derived fields nothing computes.
**Storage proves nothing about addressability; an admin route proves
nothing about effect; a passing unit test proves nothing about wiring.**

Decision 0067 makes one of these a standing check — and decision 0079
records what it does not cover.

**Watch every new check fail.** A test nobody has seen fail is a comment
that takes time to run. One fail-watch reordered detection in a way that
broke nothing meaningful and *proved the wrong thing*; only re-doing it
correctly showed the guarantee was real. And in decision 0078 a test was
written that asserted the **wrong** behaviour — which would have
defended the mistake against anyone who later tried to fix it.

**A survival test cannot catch a broken reference.** Rebuilding a
referenced table (0084) took three attempts. The second passed a check
that existing rows survived — and would have shipped a schema where
every NEW child row failed, because SQLite rewrites foreign keys to
follow a renamed parent and the rows being checked were copied before it
moved. **Insert after a migration, not just count.**

**Tests, `tsc` and the bundler read the module graph differently.**
A dependency installed at the repository root passed both test suites
and the typechecker, and failed the deploy outright (0089). Only one of
the three is the one that matters. `wrangler deploy --dry-run` is the
check.

**A standing invariant detects; it does not prevent.** Decision 0092
claimed one meant a cross-customer access grant could not be written. A
hand-written `INSERT` then wrote one against the live control plane —
suggested as a demonstration that the guard would refuse. Where a rule
spans tables and matters, **carry the discriminator and use composite
foreign keys** (0093): prevention that is visible in the schema and
survives a rebuild.

**A fail-watch that does not fail is information.** A case-sensitivity
test in 0090 passed with the protection removed, because it recorded
with mixed case and read with lowercase while the write path lowercased
anyway. The bypass ran the other way. Twice this session a test needed
correcting rather than the code.

**Ask what a query actually answers.** Decision 0080's rule survey
filtered on `approved_by IS NOT NULL`, returned seven rules, and read
past a count in the same output saying eight. No harm that time; had the
eighth been a different rule it would have been left firing at the wrong
stage.

---

## Reading order

**For a person:** Documents 1 to 4 in `docs/documents/` and as Word
editions, then `docs/PROGRESS.md`. The decision records are reference,
not reading.

**For a new AI session:** `docs/PROGRESS.md`, this file, then name the
task and the relevant decision numbers. The records are written to be
read cold — each states what was decided, what was rejected, and why.

**One-off configuration** lives in `docs/operations/` — SQL run once
against a named database, reviewed like code but not part of the
migration chain.

**Document shapes come from Peppol BIS 3.x** (decision 0082), not from
what an ERP exports and not from a shape invented here. One caveat that
is easy to get wrong: **only the invoice has Business Terms.** BIS
Billing is a CIUS of EN 16931; the other eleven transactions use UBL
element names, so "use Peppol throughout" must not be read as "use BT
codes throughout".
