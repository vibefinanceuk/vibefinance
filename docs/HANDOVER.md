# Handover

**Written 4 September 2026, updated 6 September (three times).** One page: where things stand, what needs a
decision rather than work, and what to do next.

`docs/PROGRESS.md` is the map — what exists and what does not.
`docs/decisions/` is the authority on *why* anything is the way it is.
**This file is the starting point**, and it goes stale faster than
either, so check the dates.

---

## Where things stand

| | |
| --- | --- |
| `origin/main` | `862d8fd` |
| vf-app deployed | `862d8fd` |
| vf-licence deployed | `862d8fd` |
| vf-ui deployed | `862d8fd` · `https://vf-ui.vibefinance.workers.dev` |
| `vf-app-poc` migrations | through `0040` |
| `vf-licence-poc` migrations | through `0029` |
| Tests | vf-app 1051 · vf-licence 289 · vf-ui 44 Worker + 62 browser · shared 252 (+2 known pre-existing failures) |
| Decision records | 134 |

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

### 1. A custom domain

`vf-ui.vibefinance.workers.dev` works and looks like infrastructure. A
domain is a routing change plus two config values — the API addresses
are already configuration rather than compiled in, deliberately (0099).

It also unlocks a customer-specific backdrop, which can otherwise only
appear **after** the password is verified, because that is when the
customer becomes known.

### 2. Who creates the `org_users` row — **answered**

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

### 3. Alerting on failed sign-ins

*"A lockout policy that generates no alert is half a control."* Attempts
are recorded and shown to the person on their next sign-in (ISO 27001
A.8.5), but nobody is **told**.

Waiting on email, which decision 0117 promoted from *"would be nice"* to
the gate on onboarding itself.

### 4. Do the party panels show enough?

Decision 0115 gave the seller and buyer their own panels, and most of
their fields default to `read`. If they look thin, that is configuration
(0114) rather than code — adjustable per customer without a deployment.

### 5. Does the sources screen read right?

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

### And one data change, not a code one

The live Validation rule reads *"assign a task to the AP team requiring
**AP.Review** permission"* where it should say `AP.Validate`. The rule
engine is doing exactly what the sentence says; **the sentence needs
recompiling** and taking through the activation gate. No deploy.

---

## Resolved since the last handover

Recorded so nobody re-opens them:

- **`require_second_approval`** — removed, not built (0074). Parallel
  tasks already give multiple approvers; a rule at Review decides when
  further review is needed; separation of duties is RBAC.
- **Send-back** — built as returning (0075), plus discarding (0078).
  Three outcomes now exist: return to a stage, return to the supplier,
  discard.
- **The retention period** — configurable per organisation, with a
  report listing what has passed it (0077). A benchmark, not a purge:
  nothing is deleted.
- **Validating extracted codes** — built (0116). A document carrying
  `currencyID="EURO"` now fails validation with `code_list`, naming the
  code and the line it sits on. Closed lists are enforced; a working
  subset is not, so an unusual unit of measure is not rejected.
- **Who the first user is** — the requester (0117), which corrects 0094.
  There is no bootstrap account to invent, and approval still gates
  provisioning.
- **What a trial's ending looks like** — a second environment,
  configuration migrated, users not (0118). Every table is classified
  and a test enforces it.
- **How to test the browser code** — `jsdom`, in a second config
  (0121). Playwright remains open for what `jsdom` cannot see, which is
  anything visual.
- **Where the document is shown** — inline, by the browser (0123). The
  viewer frame with zoom and field highlighting is designed there and
  not built.
- **Which font** — Carlito shipped, metric-compatible with Calibri
  (0124). Naming it in a stack was not enough.
- **Where invoices arrive** — a source carries an address derived from
  the *customer*, not the environment, so it survives 0118's move to
  production without telling every supplier a new one (0126).
- **Whether every route accepts a session** — yes now, and a test reads
  the router to keep it so (0127). The same gap had been found twice
  before and fixed two routes at a time.
- **Deleting a source** — retires it where a document carries its name,
  deletes it where nothing ever used it, and *asks* where an address was
  issued but never used, because only a person knows whether it was
  shared (0130, 0133).
- **When the screen should speak** — only when it cannot show something
  (0134).
- **Discard vs return-to-supplier** — genuinely distinct.
  `returned_manually` means somebody is dealing with it; `archived`
  means nothing further is needed.
- **Is PO matching the next domain?** Purchase orders are built (0081).
  **Three-way matching is the target**, which is why Despatch Advice
  comes before the matcher rather than after — see below.
- **The four UI questions** (0083). Served from a separate `vf-ui`
  Worker; one shared UI rather than one per instance; authentication in
  the control plane and authorisation in the instance; branding set by
  the operator in `vf-licence` with the token layer in `vf-ui`. One
  instance at a time, **never merged**.
- **SAML or OIDC — parked** (0083 section 8), behind a deliberate seam:
  everything downstream consumes the session token and does not care how
  it was minted.
- **SSO is one path, not the path** (0083 section 7). Some customers
  will not integrate an identity provider, so local accounts are
  permanent rather than a bootstrap concern.
- **A person with no `org_users` row is refused, not created** (0088).
  No roles, no unit, nothing known about them — which is why
  **provisioning must create that row** for the requester (0117), rather
  than a first sign-in creating it.
- **Argon2id, not PBKDF2** (0089). Workers cap PBKDF2 at 100,000
  iterations where OWASP's minimum is 600,000, so native Web Crypto
  cannot meet guidance.
- **The credential lives in the control plane, `org_users` stays in the
  instance** (0091). Not a replication — one thing split by purpose,
  because `vf-licence` has only `CONTROL_DB` and cannot reach a
  customer's user table.
- **One password per customer, one grant per environment** (0092).
  `vf-licence` decides *if* you get access; `org_users` decides *what*
  you get access to.
- **Progressive delay, not lockout** (0090). Auditors accept it as
  equivalent under SOC 2 CC6.1, and it cannot be used to lock out a
  colleague.
- ~~**The bootstrap administrator was not needed** (0094).~~
  **Superseded by 0117** — see *"Who the first user is"* above. The
  conclusion was true as far as it went and reached the wrong
  destination: it left the customer with **no administrator of their
  own**. There is no bootstrap account to invent because the
  **requester** is the administrator, and `signup_requests` already
  names them.
- **Branding is five tokens, set by the operator, held in the control
  plane** (0096). The login screen needs a livery *before* an instance
  is chosen, so an instance cannot be the source.
- **CORS is an explicit allow-list, never a wildcard** (0098), and
  needs no `Allow-Credentials` because a bearer token is not
  "credentials" in the CORS sense.
- **`vf-ui` is its own Worker** (0099), on deployment frequency.
- **The session lives in an `HttpOnly` cookie**, not in JavaScript
  (0102). RFC 10017 is blunt that no browser API stores a token
  securely, so `localStorage` and `sessionStorage` were never the choice
  they appeared to be. `vf-ui` is a **backend-for-frontend**: it holds
  the token and forwards data calls, which also made CORS unnecessary.
- **One task table, filtered by stage** (0103) — never a table per
  stage. One UI per stage, chosen by what a task points at.
- **Locks do not expire** (0103, 0104). A browser closing is
  undetectable, so any automatic release leaks locks; a lease takes
  somebody's claim mid-thought. Explicit release instead, by the person
  or by `AP.TaskManage`.

---

## Suggested next pieces

**1. The Cloudflare API half of provisioning (0039).** This is now the
single largest blocker, and three separate things wait behind it.

Provisioning creates control-plane rows and **honestly reports
`infrastructureProvisioned: false`** — it does not create the D1
database, the Worker, or (since 0126) the **Email Routing rule**.

So: an email address can be reserved and **nothing delivers to it**; the
sources screen says *"Not receiving yet"* and will keep saying it; and
decision 0117's onboarding cannot provision anybody.

**Decision 0135 designs it**, and answers the three questions 0039 left
open. The important one: **the token does not live in `vf-licence`.** An
account-level write token can delete every customer's database and
replace any Worker, so a flaw in any route would become total account
compromise. It is a **script the operator runs**, like
`apply_migrations.py` — and decision 0038 already puts a person in this
loop at approval, so this is not friction being added.

Steps are ordered cheapest-to-undo first with the control-plane rows
written **last**, so a failure leaves the customer reading
`not-yet-deployed.invalid` rather than half-real.

**Three of five steps are built** —
`migrations/provision_infrastructure.py` creates the database, applies
the chain and creates the bucket, then **stops at the Worker deploy
rather than claiming success**.

**Decision 0136 unblocks that step**: the Worker's config is **data the
control plane already holds**. `environments` carries `worker_name`,
`d1_database_name` and `d1_database_id`, and it was being treated as a
file only because nothing had asked the manifest for it. `deploy-all`
becomes a loop rather than a design problem.

Two rules recorded there: **secrets never go in the manifest** —
decision 0009 is this project's own record of a private key in a
`wrangler.jsonc` var — and **a deploy must verify what it is about to
do**, because once a deploy reads the manifest, a changed
`d1_database_id` points one customer's Worker at another's database.

**Decision 0137 settles what a customer is asked.** The kind is not a
question — nobody trials in production, and 0118 provisions production
as a second environment. The **region is**, and is hardcoded to `eu`
today with no reasoning recorded anywhere. The name is
`{customer}-{kind}-{region}`, decided by the system.

One guard it adds: a **length check at approval**, because a long
company name plus `-production-eu` approaches Cloudflare's 64-character
limit, and that failure would otherwise arrive after the database
exists.

**2. The operator interface** (decision 0140). Approving a customer is
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

**4. Wire up the actions that now have icons.** `complete`, `release`,
`return`, `return_to_supplier` and `discard` render in the action row
and **do nothing** (0122). They were disabled as buttons too, but icons
advertise more confidently than a greyed-out word — which is a worse
state than before.

**Nothing confirms an irreversible action** either: discard and return
to supplier both end a task, and both are one click.

**5. Closed-value enforcement in the compiler.** A rule saying
*"currency is EURO"* compiles, activates, fires against nothing and
looks correct in every listing. `validateRule` has the list (0113) and
does not consult it. The pair to decision 0116, which now validates
documents.

**6. An Approval screen.** The Task Manager lists approval tasks and
cannot open them. Field visibility (0114) is what makes an approval view
differ from a keying one — the mechanism exists, the screen does not.

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

**10. Reading `cbc:CustomizationID`.** BT-24 is now read into the facts
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
