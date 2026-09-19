# 0410 — Two empty cards, two different answers

**Status: built.**

---

## What was asked

Reported live, verbatim: *"A couple of things to investigate on the
dashboard - 1) My Priority Tasks is empty, even though I have 3 tasks
for my user. 2) The Possible Duplicates is empty, even though I have
emailed in the same invoice about 4 times."*

Both traced with read-only diagnostics against the real remote
database (`npx wrangler d1 execute vf-app-poc --remote`) before any
code was touched, per this project's own standing discipline. They
turned out to be unrelated, and only one of them was a bug.

---

## Possible Duplicates — a real bug

**What was found.** `possibleDuplicates()` (`dashboard-route.ts`)
counted invoices with:

```sql
CAST(json_extract(h.facts_json, '$."invoice.duplicate_confidence"') AS REAL) >= 0.5
```

`"invoice.duplicate_confidence"` is not a key the stored `facts_json`
ever carries. `mergeStructuredInvoiceFacts()` (`invoice-facts-
route.ts`) synthesises it from the dedicated `duplicate_confidence`
column, but only in memory, for the routes that read an invoice's
facts back (`index.ts`, for the invoice detail view and rule
evaluation) — never merged back into the stored `facts_json` itself.
`handleUpsertInvoice()` writes `facts_json` straight from the
caller's own facts and the score into its own column, separately. So
this query always read NULL and always counted zero, for every user,
regardless of scope, regardless of how real the duplicate was.

Confirmed against the operator's own data before touching anything:
of their five most recent invoices, two genuine resubmissions of
`INV-NW-1003` had `duplicate_confidence = 1` in the column — and the
row's own stored `facts_json` had no `"invoice.duplicate_confidence"`
key in it at all, printed and read directly.

**What was built.** The query now reads the column directly:

```sql
WHERE h.duplicate_confidence >= 0.5
```

Nothing else about the card changed — same threshold, same
`unitClause` scoping.

---

## My Priority Tasks — not a bug

**What was found.** All the operator's own open tasks had
`owner_user_id: null`, `owner_team_id: 'ap-team'`, `claimed_by: null`
— confirmed directly against the database. `on_my_clock` (the card
titled "My Priority Tasks") is deliberately scoped to work personally
assigned to, or personally claimed by, the person asking — not a
team's queue — decision 0180's own distinction, restated in this
card's own doc comment and covered by an existing, still-passing test
(`"leaves out a team queue"`). The card was doing exactly what it was
built to do.

What changed underneath it: decision 0401 renamed "On my clock" to
"My Priority Tasks" **and**, in the same change, deleted the card's
own subtitle — *"Assigned to me or claimed by me — not a team
queue"* — at the operator's own request, worded as removing the text
outright rather than rewording it. The new title reads as though it
ought to include a team's queue; the one line that used to say it
doesn't was gone. The behavior never changed. The explanation did.

Put to the operator directly, as a design question rather than
assumed: restore the explanation, widen the card to include the team
queue (a real behavior change, away from decision 0180), or leave it
as is. Answer: **restore the explanation.**

**What was built.** `dashboard.js`'s `on_my_clock` renderer reads
`dash.myclocksub` again — its `ui_strings` row was never deleted
(migrations here never delete one), so this is reading it again, not
reseeding anything. `dash.myclocksub` goes back into
`string-coverage.test.ts`'s `KEYS_THE_INTERFACE_USES`.

---

## Tests

`workers/vf-app/test/dashboard.test.ts` — three new tests under
`"possible duplicates reads the score that's actually stored"`: a row
scored `1` in its own column, with an empty `facts_json`, is counted;
a row scored `0.25` is not; a row with no score at all is not.
Fail-first verified: the first failed against the unfixed query
(`0` instead of `1`); the other two already passed, since zero was
already this query's default. Restored, all three pass. Full suite:
**1955/1955** (1952 + 3 new).

`workers/vf-ui/test-browser/dashboard.test.ts` — one new test,
`"explains why it's not the team queue"`, asserting the restored
subtitle text renders. Fail-first verified by stashing `dashboard.js`
alone — failed correctly against the unfixed markup, passed once
restored. Full vf-ui suite: **74/74 Worker, 716/716 browser** (715 +
1 new) — the same pre-existing 162-error batch of unhandled promise
rejections in `document-window.test.ts` (unrelated, confirmed
identical with and without this change, same as decision 0408's own
investigation) is present unchanged.

`workers/vf-licence/test/string-coverage.test.ts` — `dash.myclocksub`
back in `KEYS_THE_INTERFACE_USES`. Full suite: **320/320**.

`eslint` clean on every changed file. `scripts/check-citations.py`
clean once this record exists.

---

## What is not built

**No behavior change to `on_my_clock`.** The team-queue option was
offered and declined; the card still counts exactly what decision
0180 always meant it to.

**No general audit of other cards for the same `facts_json`-key
mistake.** `possible_duplicates` was the one reported and the one
checked. If another card reads a derived key through `json_extract`
the same way, it hasn't been looked for here.
