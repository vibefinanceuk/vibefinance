# Handover

**Written 4 September 2026, updated 5 September.** One page: where things stand, what needs a
decision rather than work, and what to do next.

`docs/PROGRESS.md` is the map — what exists and what does not.
`docs/decisions/` is the authority on *why* anything is the way it is.
**This file is the starting point**, and it goes stale faster than
either, so check the dates.

---

## Where things stand

| | |
| --- | --- |
| `origin/main` | `d2f044d` |
| vf-app deployed | `d2f044d` |
| vf-licence deployed | `d2f044d` |
| vf-ui deployed | `d2f044d` · `https://vf-ui.vibefinance.workers.dev` |
| `vf-app-poc` migrations | through `0038` |
| `vf-licence-poc` migrations | through `0021` |
| Tests | vf-app 988 · vf-licence 289 · vf-ui 42 · shared 241 (+2 known pre-existing failures) |
| Decision records | 115 |

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

**And placed in the right part of the enterprise.** An invoice acquires
an operating unit at intake, from a rule the customer wrote or from the
source it arrived through, and a stage can refuse to let it past without
one (0111).

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

**Nothing blocks the next piece of work.** Four things worth settling,
none urgent.

### 1. A custom domain

`vf-ui.vibefinance.workers.dev` works and looks like infrastructure. A
domain is a routing change plus two config values — the API addresses
are already configuration rather than compiled in, deliberately (0099).

It also unlocks a customer-specific backdrop, which can otherwise only
appear **after** the password is verified, because that is when the
customer becomes known.

### 2. Who creates the `org_users` row

A person can hold a credential and an access grant and **still be
refused** by the instance (0088) — deliberately: no roles, no unit,
nothing known about them. Today the row is created by hand, and the
refusal does not yet say *what* is missing.

### 3. Alerting on failed sign-ins

*"A lockout policy that generates no alert is half a control."* Attempts
are recorded and shown to the person on their next sign-in (ISO 27001
A.8.5), but nobody is **told**. This needs email, and **nothing in this
system sends any** — the same gap blocks password reset and expiry
warnings.

### 4. Do the party panels show enough?

Decision 0115 gave the seller and buyer their own panels, and most of
their fields default to `read`. If they look thin, that is configuration
(0114) rather than code — adjustable per customer without a deployment.

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
  No roles, no unit, nothing known about them — and it makes the
  bootstrap administrator load-bearing.
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
- **The bootstrap administrator was not needed** (0094). The operator
  holds the admin key and creates the first credential at provisioning,
  so the self-disabling account 0083 designed was never built.
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

**1. Validate extracted codes.** Decision 0113 built the standard's code
lists and **nothing checks a document against them**. A supplier's UBL
carrying `currencyID="EURO"` is non-conformant and is stored happily.

The subtlety is already recorded: refuse against a **closed** list,
accept against a **working subset**. `isClosedList` exists for exactly
this — UN/ECE Rec 20 carries the common units, so a document using an
unusual one must not be rejected.

**A dropdown stops a person entering a bad code; this stops a document
carrying one.**

**2. Closed-value enforcement in the compiler.** The other half. A rule
saying *"currency is EURO"* compiles, activates, fires against nothing
and looks correct in every listing. `validateRule` has the list now and
does not consult it. Listed as proposed since Document 2.

**3. Email.** Blocks alerting on failed sign-ins, password reset,
licence expiry warnings and every notification. Still the
most-referenced missing capability in these records.

**4. An Approval screen.** The Task Manager lists approval tasks and
cannot open them. Field visibility (0114) is what makes an approval view
differ from a keying one — the mechanism exists, the screen does not.

**5. BG-4 and BG-7 in the vocabulary.** The seller and buyer field lists
live in the viewer (0115). Recording business-group membership in
`shared`, as `INVOICE_LINE_FIELDS` does for BG-25, is the consistent
thing and a known shortcut until it is done.

**6. BG-23, the VAT breakdown.** Mandatory and **repeating** — one entry
per VAT category and rate, whose tax amounts must sum to BT-110. The
flat facts model cannot hold a repeating group (0112). A design
question, not an omission, and *"one of the most common causes of
validation errors"*.

**7. Despatch Advice (T16).** The goods receipt, and the missing third
leg of three-way matching — **before the matcher, not after** (0082).
BT-132 now exists, which is what lets matching compare a line to an
order line.

**8. Reading `cbc:CustomizationID`.** BT-24 is now read into the facts
(0112), so the discriminator is available; detection still does not use
it, and a valid Peppol Order sent to `/sources/:id/capture` is refused.

**9. `party.first_document`**, the **all-users task view**, a **screen
for placing an invoice** by hand, and **four more languages** —
`GET /ui-strings/keys` shows the gaps.

---

## Habits worth keeping

`docs/PROGRESS.md` has the longer list.

**Check one layer against another.** Nine divergences found this way and
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
