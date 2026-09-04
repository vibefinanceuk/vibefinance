# Handover

**Written 4 September 2026, updated again that evening.** One page: where things stand, what needs a
decision rather than work, and what to do next.

`docs/PROGRESS.md` is the map — what exists and what does not.
`docs/decisions/` is the authority on *why* anything is the way it is.
**This file is the starting point**, and it goes stale faster than
either, so check the dates.

---

## Where things stand

| | |
| --- | --- |
| `origin/main` | `9a672ae` |
| vf-app deployed | `79bbb74` |
| vf-licence deployed | `98dac9b` |
| `vf-app-poc` migrations | through `0034` |
| `vf-licence-poc` migrations | through `0008` |
| Tests | vf-app 871 · vf-licence 171 · shared 194 (+2 known pre-existing failures) |
| Decision records | 89 |

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

And **the authentication spine exists but nobody can use it.**
`vf-licence` mints a session token naming the environment it is for
(0086); `vf-app` verifies it and refuses anybody with no `org_users` row
(0088); passwords hash with Argon2id (0089). What is missing is a login
endpoint a person can reach — the development stub (0087) is the only
way to obtain a token, and it is deliberately disabled in production and
cannot mint for a production environment even when enabled.

---

## Waiting on you

**Nothing blocks the next piece of work.** One question is worth
settling before the login endpoint, and it matters more than the
algorithm choice did.

### Rate limiting, before local login goes in

**No hash is strong enough against unlimited attempts.** Argon2id at
OWASP parameters is built (0089); a login endpoint without rate limiting
would undo most of its value.

Two open parts:

- **Where the state lives.** `vf-licence` is a single shared Worker, so
  limiting there protects every customer at once — but per-email
  attempt counts need somewhere to live, and D1 means a write on every
  failed attempt. Cloudflare offers a rate-limiting binding that would
  avoid the storage question; **what it can key on has not been
  checked.**
- **Lockout has a real trade-off.** Too aggressive and anybody can lock
  out a colleague by guessing wrong five times — a denial of service
  wearing a security feature's clothes.

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

---

## Suggested next pieces

**1. Local login.** The authentication spine is built at both ends and
unreachable. This needs: rate limiting (see above), the login endpoint
in `vf-licence` beside the dev stub minting the same session token,
`password_hash` on `org_users`, and the **bootstrap administrator** —
per-environment, password set at provisioning and handed over, able to
do exactly one thing (create a named administrator) and self-disabling
once one exists.

**Reset needs email, and nothing in this system sends any.** An
administrator setting a password directly is the only reset available.

**2. The UI**, once local login works. Decision 0083 settled the
architecture; `docs/design/mockups/` has four screens as static HTML.
The Validation queue is the screen to build first — it exercises
listing, permissions and the stage model, and it is what somebody opens
each morning.

**3. Despatch Advice (T16).** The goods receipt, and the missing third
leg of three-way matching. `permissions.ts` has always described
`AP.Match` as *"3-way match against PO/goods receipt"*.

**Before the matcher, not after** (0082). Comparing invoice lines to
order lines is one correspondence problem; adding a despatch advice
makes it three-cornered, where a line can match what was *ordered* and
not what was *delivered*. A change of shape, not an increment.

**4. Reading `cbc:CustomizationID`.** Detection answers *what structure
is this*, not *what document is this*, so a valid Peppol Order sent to
`/sources/:id/capture` is refused. Non-trivial: it selects which half of
the system a document belongs to, since an order is reference data and
an invoice is work.

**5. `party.first_document`.** Declared and uncomputed (0079). Must be
computed **at capture and stored**, or re-running a rule set would give
a different answer as more invoices arrive — breaking the
reproducibility the interpreter rests on.

**6. Keyed lines**, **retiring the legacy intake channels** (gated on
the customer's integration moving off `/intake-channels/:id/capture-*`),
and **queue visibility** — ~35 tasks sit open and unclaimed at Approval
from testing, each blocking its instance, and nothing surfaces an ageing
queue.

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
