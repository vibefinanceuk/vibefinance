# Handover

**Written 4 September 2026, updated 9 September.** One page: where things stand, what needs a
decision rather than work, and what to do next.

`docs/PROGRESS.md` is the map — what exists and what does not.
`docs/decisions/` is the authority on *why* anything is the way it is.
**This file is the starting point**, and it goes stale faster than
either, so check the dates.

**Read `docs/decisions/SUPERSEDED.md` before trusting an old record.**
Records are never rewritten to agree with later ones — what was decided,
and why it looked right then, is part of why the current answer is what
it is. That means **contradictions between records are real and neither
is wrong**; they are dated. That page is the map of which supersedes
which, and it exists because the trap has been fallen into twice.

---

## Where things stand

| | |
| --- | --- |
| `origin/main` | `061eae6` |
| vf-app deployed | `061eae6` |
| vf-licence deployed | `061eae6` |
| vf-ui deployed | `061eae6` · `https://vf-ui.vibefinance.workers.dev` |
| Domain | `vibefinance-ai.com` · **email intake receives real invoices** |
| `vf-app-poc` migrations | through `0043` |
| `vf-licence-poc` migrations | through `0048` |
| Tests | vf-app 1173 · vf-licence 318 · vf-ui 44 Worker + 203 browser · shared 267 (+2 known pre-existing failures) |
| Decision records | 182 |

**Everything committed is deployed.**

**There are three Workers now.** `vf-app` per customer, `vf-licence`
shared, and `vf-ui` shared — the interface, its own deployment because
binding it to `vf-licence` would mean every UI change redeploying the
component that mints licence tokens for the whole fleet (0099).

The two `shared` failures are time-expired JWT keys in the licensing
token tests, failing on `main` since before any of this work. Not new,
not related.

---

## What the system does end to end

Proven live, following one real document the whole way:

1. A supplier PDF arrives at `POST /sources/ic-new/capture`.
2. Detection finds a PDF header and **no embedded invoice** — no
   structure this system can extract from.
3. It is **captured rather than rejected**: an invoice row carrying only
   provenance, a real process instance, and `intake.structure: ""` —
   the empty string, because an absent field cannot be tested by a rule.
4. The original is **retained** in R2 as `application/pdf`.
5. It stops at **Validation**, where a rule the customer wrote in plain
   English raises a task.
6. A person **keys** the fields. Identity is derived from the
   authenticated caller; a spoofed `keyedBy` in the body is ignored.
7. Keying reports whether the document **would now validate**.
8. A **five-minute signed URL** displays the retained PDF in a browser
   with no `Authorization` header.
9. A person with the right permissions can **return** it to an earlier
   stage with a reason, **return it to the supplier**, or **discard** it.

**Every step above now has a screen.** `vf-ui` serves sign-in, the Task
Manager and the Validation viewer, so steps 6, 8 and 9 are things a
person clicks rather than `curl` invocations. This paragraph said the
opposite until 5 September.

Separately, **purchase orders** can be ingested from Peppol BIS Order
Only documents and read back. They are reference data rather than work:
nothing extracts from them, no rule evaluates them, and they never enter
a process instance. **Nothing matches an invoice against one yet.**

And **a person can now sign in**, proven end to end against production:

1. `POST /login` on `vf-licence` — email, password, environment.
2. The **progressive delay** is checked first, so somebody already
   throttled gets no free password verification (0090, 0094).
3. The password is verified against a credential held in the control
   plane, because `vf-licence` cannot reach a customer's `org_users`
   table at all (0091, 0092).
4. An **access grant** decides which instances that person may reach.
   The composite foreign keys make a cross-customer grant impossible to
   write (0093).
5. A **session token** comes back, scoped to one environment — one
   signing key serves the whole fleet, so without that scope a session
   for one customer would open another's data (0086).
6. `GET /whoami` on `vf-app` verifies it locally, with no network call,
   and returns the person's real record and every permission at once
   (0095).

**And then they see their work.** `https://vf-ui.vibefinance.workers.dev`
serves a **Task Manager**: one list across every stage, ownership as a
column, filters by stage and ownership, and buttons drawn from what each
task says the server will honour. A person can claim a task and release
it. **Refreshing holds steady** — the session lives in an `HttpOnly`
cookie the JavaScript never sees (0102).

**And they can key one.** A Validation task opens the viewer (0106): the
retained original beside the fields it should have yielded, opened in
its own window through a five-minute signed URL (0073). Saving reports
whether validation *would* now pass — advisory, because nothing
re-evaluates the rules (0072).

**In their own language, in the customer's livery.** Every visible word
comes from D1 in the control plane (0107) and every colour from a token
(0096), so a wording fix or a new language is rows rather than a
deployment.

**Showing the fields that customer chose.** Which fields appear, and
whether they may be edited, is configuration — per customer, restricted
further per stage, and *"approvers should approve data, not edit
data"* (0114). Currency, unit and VAT category are pickers drawn from
the standard's own code lists (0113).

**With the document beside them.** A PDF renders in a frame and an image
in an image — the browser's own viewer, which decision 0042 was read for
too long as ruling out (0123).

**And an exceptions panel that says what is wrong on arrival**, in
readable terms rather than check names, with every field a failure
involves highlighted and carrying its reason on hover (0119).

**And placed in the right part of the enterprise.** An invoice acquires
an operating unit at intake, from a rule the customer wrote or from the
source it arrived through, and a stage can refuse to let it past without
one (0111).

**There is a second screen now.** Sources — *where invoices arrive* —
lists them, creates them, gives an email source its address, and retires
or deletes one (0126, 0128, 0130). The navigation frame has carried a
single entry since 0108 waiting for exactly this.

**And a third stage uses the same screen as the second.** An approval
task opens the keying viewer, with the fields read-only because the
stage says so and Complete in place of Save (0142, 0143). *"Approvers
should approve data, not edit data"* is a **property of the stage**, not
a list of fields somebody has to keep complete.

**Enforced by the route, not the screen** (0144). Field visibility had
been a screen behaviour since September: a `curl` could always write a
read-only field, and the keying route now refuses one.

**Invoices arrive by email** (0146, 0147). A supplier sends to an
address a source owns, every attachment is captured, and each arrival is
logged with its outcome and its reason. A photographed invoice has been
read automatically and reached Payment-eligible **without a person
touching it** — and one the model could not read is retained, explained
on screen, and waits to be keyed (0161–0163, 0166).

**Rules have a face** (0149, 0153–0158). See what runs at each stage,
write one in a sentence, read the compiled rule back **in words rather
than as a condition tree**, confirm its worked examples, activate,
pause, revise. The product's own claim, reachable by a customer rather
than by `curl`.

**Documents are findable** (0164, 0165, 0167). Every invoice that has
arrived, searchable, with columns a person chooses — because until then
**every way into a document was a task**, and an invoice that went
straight through has none.

**And an invoice shows where it has been** (0151, 0152). The process as
chevrons at the head of the viewer, with how long each stage took and
every period a returned document spent there.

**And a person can now do all of that in a browser.**
`https://vf-ui.vibefinance.workers.dev` serves a sign-in screen that
fetches the customer's livery from `vf-licence` (0096), populates the
environment list from what that person may actually reach, and shows
their last sign-in with every failed attempt since. Proven working, not
just built.

`ALLOWED_ORIGINS` is set on both API Workers to the UI's origin, which
is what lets a browser read either response (0098). CORS is a browser
mechanism — every `curl` in this file works regardless.

**Every authentication failure returns the same message**, so an email
address cannot be used to enumerate accounts or environments.

Sessions and API keys **coexist**: a session is a person at a screen, an
API key is a service credential, and every live test in this project
uses one.

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

## What the last two days added

**Rules have a face** (0149, 0153–0158). See what runs at each stage,
write one in a sentence, read the compiled rule back in words, confirm
its worked examples, activate, pause, revise. The product's own claim,
reachable by a customer rather than by `curl`.

**Email intake receives real invoices** (0146, 0147, 0161–0163, 0166,
0168). A supplier emails a document, it is captured, read where it can
be, retained and explained where it cannot, and every arrival is logged
with a reason.

**Documents are findable** (0164, 0165, 0167). Every invoice that has
arrived, searchable, with columns a person chooses — because until then
**every way into a document was a task**, and a straight-through invoice
has none.

**An invoice shows where it has been** (0151, 0152). The process as
chevrons at the head of the viewer, with how long each stage took.

**And process versioning has its foundation** (0150, 0160). Every read
of a process's stages goes through a version's membership; nothing
creates a second version yet.

## Resolved since the last handover

**This list has moved.** It lived here and went stale — decision 0094's
conclusion sat in it as settled for days after decision 0117 corrected
it, which is the exact hazard `SUPERSEDED.md` was written to close.

**Two copies of the same history is one copy that lies.** It is all in
`docs/decisions/SUPERSEDED.md` now, which is where a reader is already
told to look before trusting an old record.

## Suggested next pieces

**1. The operator interface** (decision 0140) — **half built.** The
attribution is done: `admin_actions` records every privileged action,
refusals included, with a verified identity where one exists. **The
screen waits on the domain.**

Originally: Approving a customer is
a `curl` today, and **a decision made blind is a checkpoint in name
only**.

A fourth Worker — `vf-admin`, behind Cloudflare Access — because
`vf-ui`'s proxy **refuses admin paths outright** by design, and binding
an interface to `vf-licence` would redeploy the licence minter on every
UI change.

**The larger half is attribution, not authentication.** `decided_by` is
whatever the caller says, because the admin key is a shared secret —
honest, and it fails ISO 27001 A.8.15 and SOC 2 CC7.2, which want
privileged actions *attributable* rather than merely recorded. The
identity comes from a **verified** Access JWT instead, which is the
discipline decision 0010 already applies in `vf-app` and the control
plane has been the exception to.

And **seven routes are admin-gated where two record who acted**:
creating a licence, minting a credential and granting access to an
environment all record nothing.

**2. Process configuration, versioned** (decision 0150). Adding and
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

**3. Email sending**, which decision 0125 evaluates. "Email" means three
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

**4. BG-4 and BG-7 in the vocabulary.** The seller and buyer field lists
live in the viewer (0115). Recording business-group membership in
`shared`, as `INVOICE_LINE_FIELDS` does for BG-25, is the consistent
thing and a known shortcut until it is done.

**5. BG-23, the VAT breakdown.** Mandatory and **repeating** — one entry
per VAT category and rate, whose tax amounts must sum to BT-110. The
flat facts model cannot hold a repeating group (0112). A design
question, not an omission, and *"one of the most common causes of
validation errors"*.

**6. Despatch Advice (T16).** The goods receipt, and the missing third
leg of three-way matching — **before the matcher, not after** (0082).
BT-132 now exists, which is what lets matching compare a line to an
order line.

**7. Reading `cbc:CustomizationID`.** BT-24 is now read into the facts
(0112), so the discriminator is available; detection still does not use
it, and a valid Peppol Order sent to `/sources/:id/capture` is refused.

**8. `party.first_document`**, the **all-users task view**, a **screen
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
