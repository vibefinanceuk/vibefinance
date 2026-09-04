# Handover

**Written 4 September 2026, updated the same afternoon.** One page: where things stand, what needs a
decision rather than work, and what to do next.

`docs/PROGRESS.md` is the map — what exists and what does not.
`docs/decisions/` is the authority on *why* anything is the way it is.
**This file is the starting point**, and it goes stale faster than
either, so check the dates.

---

## Where things stand

| | |
| --- | --- |
| `origin/main` | `85843a7` |
| vf-app deployed | `79bbb74` |
| vf-licence deployed | `f203ac0` (2 September; untouched since) |
| `vf-app-poc` migrations | through `0034` |
| Tests | vf-app 859 · vf-licence 153 · shared 165 (+2 known pre-existing failures) |
| Decision records | 82 |

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

Everything above is live. What does not exist is any interface — steps
6, 8 and 9 are `curl`.

Separately, **purchase orders** can be ingested from Peppol BIS Order
Only documents and read back. They are reference data rather than work:
nothing extracts from them, no rule evaluates them, and they never enter
a process instance. **Nothing matches an invoice against one yet.**

---

## Waiting on you

### 1. The UI architecture — proposed, awaiting review

**Decision 0083 answers the four questions** and is written for review
before any code. The short version: customers' own SSO terminates at
`vf-licence`, which mints a session token instances verify locally;
authentication is central and authorisation stays per-instance; there is
**one shared UI** rather than one per instance; and it lives in its own
`vf-ui` Worker rather than bound to `vf-licence`, on deployment-frequency
grounds.

Two things need your decision inside it: **SAML or OIDC** (SAML in a
Worker is genuinely awkward, and most enterprise IdPs speak both), and
widening `UNIQUE (customer_id, kind)` in the control plane, which
currently **blocks a customer having both an EU and a US production**.

The original four questions, for context:

There is **no frontend in this repo at all** — Workers, D1 and R2, API
only. No framework, no build pipeline, no static asset serving, no
browser session handling. Four screens are mocked as static HTML in
`docs/design/mockups/`, and nothing renders from real data.

- **Served from the Worker, or deployed separately?** From the Worker
  means one deployment, one origin, and no CORS. Separately means a
  proper build pipeline and CDN, and a second thing to configure per
  customer.
- **A framework, or hand-written HTML?** The mockups are hand-written
  and readable. A framework buys component reuse and brings a build step
  into a repo that has none.
- **How does a browser authenticate?** The API expects a bearer token
  and a browser has nowhere good to keep one — the same problem the
  pop-out window had, solved there with a short-lived signed URL
  (decision 0073). A session cookie is the usual answer and would be a
  second auth mechanism alongside the bearer token.
- **What is the token layer for white-labelling?** The expensive one to
  retrofit. `docs/design/mockups/tokens.css` shows the shape: every
  colour a token, so a customer livery is a substitution in one place.

**The API is ready for it.** Capture, keying, returning, discarding,
signed document URLs and the stage/task model are all live and
exercised. What a screen would need already exists behind `curl`.

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

---

## Suggested next pieces

**1. The UI**, once the four questions above are answered. It is the
only thing standing between a working system and a usable one, and
nothing else is blocked on it.

**2. Despatch Advice (T16).** The goods receipt, and the missing third
leg of three-way matching. `permissions.ts` has always described
`AP.Match` as *"3-way match against PO/goods receipt"*, and two thirds
of that data did not exist until purchase orders landed.

**Before the matcher, not after** (decision 0082). Comparing invoice
lines to order lines is one correspondence problem; adding a despatch
advice makes it three-cornered, where a line can match what was
*ordered* and not what was *delivered*. That is a change of shape, not
an increment, and building the matcher twice is the expensive way to
arrive at the same place.

**3. Reading `cbc:CustomizationID`.** Detection answers *what structure
is this*, not *what document is this*, so the XML branch assumes an
invoice — and a valid Peppol Order sent to `/sources/:id/capture` is
refused. Peppol supplies the discriminator itself and nothing reads it.
Non-trivial, because it selects which half of the system a document
belongs to: an order is reference data, an invoice is work.

**4. `party.first_document`.** Declared and uncomputed (0079). Three
questions decide it: identify a party by what (`BT-31` is absent on
exactly the documents where "first from this supplier" matters most),
first ever or first since when, and — the substantial one — it must be
computed **at capture and stored**, because computing it at evaluation
would change the answer as more invoices arrive and break the
reproducibility the interpreter rests on.

**5. Keyed lines.** Lines live in `invoice_lines` rather than
`facts_json`, so `provenance.keyed` covers header fields only and a
keyed line is indistinguishable from a parsed one. `line_sum` cannot run
without lines.

**6. Retiring the legacy intake channels.** `ic-new` still exists with a
NULL structure, and the channel-addressed capture endpoints still bypass
detection. Retiring them lets decision 0061's partial unique index
become total, and is the moment to split extraction settings by
structure (0066). **Gated on the customer's integration moving off
`/intake-channels/:id/capture-*` first.**

**7. Queue visibility.** ~35 tasks sit open and unclaimed at Approval
from testing, each blocking its instance. Nothing surfaces an ageing
queue, and nothing surfaces abandoned pending documents either. For AP,
where late payment has real cost, that is a gap worth naming.

---

## Three habits worth keeping

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
