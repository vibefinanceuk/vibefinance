# Handover

**Written 3 September 2026.** One page: where things stand, what is
genuinely blocked, what needs a decision rather than work, and what to
do next.

`docs/PROGRESS.md` is the map — what exists and what does not.
`docs/decisions/` is the authority on *why* anything is the way it is.
**This file is the starting point**, and it goes stale faster than
either, so check the dates.

---

## Where things stand

| | |
| --- | --- |
| `origin/main` | `a3c7efc` |
| vf-app deployed | `ff583d3` |
| vf-licence deployed | `f203ac0` (2 September; untouched since) |
| `vf-app-poc` migrations | through `0030` |
| Tests | vf-app 817 · vf-licence 153 · shared 149 (+2 known pre-existing failures) |
| Decision records | 73 |

Two `shared` failures are time-expired JWT keys in the licensing token
tests, failing on `main` since before any of this work. They are not new
and not related.

---

## What the system does end to end

Proven live on 3 September, following one real document the whole way:

1. A supplier PDF arrived at `POST /sources/ic-new/capture`.
2. Detection found a PDF header and **no embedded invoice** — so no
   structure this system can extract from.
3. It was **captured rather than rejected**: an invoice row carrying
   only provenance, a real process instance, and
   `intake.structure: ""` — the empty string, because an absent field
   cannot be tested by a rule.
4. The original was **retained** in R2 as `application/pdf`.
5. A rule the customer wrote in plain English — *"if validation has not
   passed, assign a task"* — fired and raised a task.
6. A person **keyed** six fields. Identity derived from the
   authenticated caller; a spoofed `keyedBy` in the body was ignored.
7. Keying reported the document **would now validate**.
8. A **five-minute signed URL** displayed the retained PDF in a browser
   with no `Authorization` header.

Everything above is live. What does not exist is any interface — step 6
and step 8 are `curl`.

---

## Blocked on nothing; waiting on you

These need a **decision**, not work. Each is cheap to act on once made
and gets more expensive the longer it sits.

### 1. `require_second_approval` — build it or remove it

Declared in the closed vocabulary, implemented nowhere. A customer
writing *"invoices over 10,000 require a second approval"* gets a rule
that compiles, passes the activation gate, fires on the right invoices,
and **has no effect** — while looking correct in every listing.

It is not merely unwired. Two tasks assigned to one team can both be
claimed by the same person, so a real second approval needs tasks to
relate to each other and the completion check to refuse the same
`completed_by`. That is a schema addition.

Leaving it declaring an intention it does not fulfil is the worst of the
three options. Decision 0064.

### 2. Is send-back a flow you need?

`onTaskCompleted` advances by sequence **without evaluating rules**, so
`route_to` cannot fire at the one moment a task completes. Send-back
therefore does not exist in any form — not because a task lacks an
outcome field, but because that moment is the one where no rule runs.

If it is needed, the shape is in decision 0064 section 5. If it is not,
say so and the parked-instance finding becomes much less urgent.

### 3. The retention period

Nothing expires anything, so today's answer is **"forever"** — a
decision by default rather than by choice. Document 1 section 6.4
records it as a genuine compliance question, and it is the kind that is
cheaper to answer before there is a lot of data than after.

### 4. Four questions before any UI exists

There is **no frontend in this repo at all** — Workers, D1 and R2, API
only. No framework, no build pipeline, no static asset serving, no
browser session handling. Before a line of UI is written:

- Served from the Worker, or deployed separately?
- A framework, or hand-written HTML?
- How does a browser authenticate, when the API expects a bearer token?
- What is the token layer for white-labelling?

The fourth is the one that is expensive to retrofit.
`docs/design/mockups/tokens.css` shows the shape: every colour a token,
so a customer livery is a substitution in one place.

---

## Suggested next three pieces

In this order, and each is self-contained.

**1. Discard.** Keying gave the operator one outcome; reject is still
the only alternative. Discard is the third, and decision 0055 section
5.5 argues it needs its own permission — keying introduces facts,
discarding removes a document from processing entirely. Someone trusted
to transcribe an amount is not automatically someone who should decide
an invoice never existed.

**2. Keyed lines.** Lines live in `invoice_lines` rather than
`facts_json`, so `provenance.keyed` covers header fields only and a
keyed line is indistinguishable from a parsed one. `line_sum` cannot run
without lines, so a keying flow that cannot add them produces documents
that can never fully validate.

**3. Retiring the legacy intake channels.** `ic-new` still exists with a
NULL structure, and the channel-addressed capture endpoints still bypass
detection entirely. Retiring them removes the NULL case, lets decision
0061's partial unique index become a total one, and is the natural
moment to split the extraction settings by structure as decision 0066
recommends — `conflictWinner` and `maxExtractedLines` are properties of
reading an image and are meaningless on an XML channel.

**Gated on the customer's integration moving first**, since it breaks
`/intake-channels/:id/capture-*`.

---

## Two habits worth keeping

Both earned their place repeatedly, and `docs/PROGRESS.md` has the
longer list.

**Check one layer against another.** Seven divergences were found this
way and none any other way: a column with no vocabulary entry, a fact
never declared, settings reaching nothing twice over, a parser
populating half the fields it should, a constant contradicting its own
contents, a storage layer nothing called, and a content type derived
from half a detection result. **Storage proves nothing about
addressability; an admin route proves nothing about effect; a passing
unit test proves nothing about wiring.**

Decision 0067 turns one of these into a standing check.

**Watch every new check fail.** A test nobody has seen fail is a comment
that takes time to run. One fail-watch this week *proved the wrong
thing* — reordering detection in a way that broke nothing meaningful —
and only re-doing it correctly showed the guarantee was real.

---

## Reading order

**For a person:** Documents 1 to 4 in `docs/documents/` and as Word
editions, then `docs/PROGRESS.md`. The decision records are reference,
not reading.

**For a new AI session:** `docs/PROGRESS.md`, this file, then name the
task and the relevant decision numbers. The records are written to be
read cold — each states what was decided, what was rejected, and why.
