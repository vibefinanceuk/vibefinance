# Handover

**Written 4 September 2026, updated 10 September.**

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
| `origin/main` | `e3b8798` |
| vf-admin deployed | `e3b8798` · `https://admin.vibefinance-ai.com` · behind Access |
| vf-app deployed | `e3b8798` |
| vf-licence deployed | `e3b8798` |
| vf-ui deployed | `e3b8798` · `https://app.vibefinance-ai.com` |
| Domain | `vibefinance-ai.com` · **email intake receives real invoices** |
| `vf-app-poc` migrations | through `0049` |
| `vf-licence-poc` migrations | through `0052` |
| Tests | vf-admin 9 · vf-app 1300 · vf-licence 318 · vf-ui 44 Worker + 219 browser · shared 267 (+2 known pre-existing failures) |
| Decision records | 206 |

**Everything committed is deployed.**

**There are four Workers now.** `vf-app` per customer, `vf-licence`
shared, `vf-ui` shared — the customer's interface, its own deployment
because binding it to `vf-licence` would mean every UI change
redeploying the component that mints licence tokens for the whole fleet
(0099) — and `vf-admin`, the operator's, behind Cloudflare Access
(0186).

The two `shared` failures are time-expired JWT keys in the licensing
token tests, failing on `main` since before any of this work. Not new,
not related.

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

**Five screens**: Tasks, Sources, Rules, Documents, and the viewer that
serves every stage.

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

**Removing Line Review is not**, and decision 0150 is why. It has a
completed task against it, so deleting the row would fail on a foreign
key or orphan history. Versioning the membership removes it properly;
until then it stays.


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
yet**, and 0199 says so.

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
that matter most.

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

**4. Supplier and supplier site** (decision 0207) — **evaluated, and
there is nothing there today.**

A seller exists only as facts on an invoice, copied to
`supplier_vat_id` so duplicates can group. **No supplier table, no site,
no terms, no hold, no ERP identifier** — and `party.first_document` has
been in the vocabulary since decision 0031 with nothing computing it.

**Oracle's definition is the useful part**: a site is not an address, it
is *"the business relationship between a procurement business unit and
the supplier"* — so a site is `(supplier, operating unit)`, and decision
0036's tree is already the other half.

**Matching is decision 0204 pointed the other way**: `BT-34` and `BT-31`
instead of `BT-49` and `BT-48`, with the same three failures.

**We are the mirror** (decision 0208), which removes most of those
eighty attributes: no create, no merge, no vendor approval. A customer
supplies a spreadsheet and we hold the subset that changes what happens
to an invoice — terms, hold, match option, tolerances, status.

**The rule the operator described already fits the vocabulary**, save
one field: *"if the supplier is not matched, assign a task to the AP
team requiring AP.Review."* `supplier.matched` is what is missing.

**Matching is built** (decision 0209): a seller is matched on `BT-34`
then `BT-31`, and `supplier.matched` is a vocabulary field, so the
operator's rule is expressible today. **And the load is built** (decision 0211): a CSV with the customer's own
column names, refusing row by row with the row number, and **re-matching
every unmatched invoice** — which decision 0208 called part of the
feature rather than a refinement.

**It corrects the fact and not the queue.** An invoice whose supplier
now exists keeps its place; a rule that routed it on `supplier.matched`
is what should route it back.

**Two traps, one handled and one not.** A **stale mirror lies
confidently** — a supplier added to the ERP on Monday and loaded here on
Friday means four days of invoices routed for review, so an unmatched
supplier must be reported with the load date beside it. And **nothing
re-checks**: an invoice sitting in AP Review stays there after its
supplier is loaded, so **re-matching after a load is part of the
feature**, not a refinement — **and it is not built.**

**5. Process configuration, versioned** (decision 0150). Adding and
removing stages through a screen, with a version number an invoice
carries — so it is always apparent which shape of the process an item
ran under.

The detail that decides it: **version the membership, not the stages.**
A version on `processes` alone would be a label with nothing behind it,
because editing `process_stages` in place shows a v1 instance v2's
stages. `process_stage_versions (process_id, version, stage_id,
sequence)` leaves all six foreign keys untouched and makes removing a
stage *"not in this version"* rather than a deletion that orphans
history.

**An invoice finishes on the version it started**, and rules resolve on
arrival rather than on entry — which is already what
`rule-set-loader.ts` does. The asymmetry is deliberate: the path is
frozen because changing it mid-flight is incoherent, and the rules are
current because a threshold tightened this morning should apply to
invoices reaching Approval this afternoon.

**6. Email sending**, which decision 0125 evaluates. "Email" means three
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

**7. BG-4 and BG-7 in the vocabulary.** The seller and buyer field lists
live in the viewer (0115). Recording business-group membership in
`shared`, as `INVOICE_LINE_FIELDS` does for BG-25, is the consistent
thing and a known shortcut until it is done.

**8. BG-23, the VAT breakdown.** Mandatory and **repeating** — one entry
per VAT category and rate, whose tax amounts must sum to BT-110. The
flat facts model cannot hold a repeating group (0112). A design
question, not an omission, and *"one of the most common causes of
validation errors"*.

**9. Despatch Advice (T16).** The goods receipt, and the missing third
leg of three-way matching — **before the matcher, not after** (0082).
BT-132 now exists, which is what lets matching compare a line to an
order line.

**10. Acting on `cbc:CustomizationID` beyond rendering.** Decision 0205
reads it to decide whether a document is Peppol BIS 3.0 and refuses the
rendering otherwise — which is the first thing to use it. **Nothing
routes or validates on it**, so a document from another profile is
processed as though it were this one.

*The original note:* Reading `cbc:CustomizationID`. BT-24 is now read into the facts
(0112), so the discriminator is available; detection still does not use
it, and a valid Peppol Order sent to `/sources/:id/capture` is refused.

**11. `party.first_document`**, the **all-users task view**, a **screen
for placing an invoice** by hand, and **four more languages** —
`GET /ui-strings/keys` shows the gaps.

---

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
