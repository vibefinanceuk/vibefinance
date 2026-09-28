# 0539 — The Coding pop-out becomes a card, with a per-line suggestion to accept; keying stops blanking an invoice's structured columns

**Status: built and tested locally, not yet pushed or deployed.** This
session has no push access, so it is delivered as a git bundle. It
touches `vf-app`, `vf-ui` and `vf-licence`, and needs **`vf-app`
migration `0097` (a one-off repair of existing rows; see below) and
`vf-licence` migration `0194`**. No schema change.

## What was asked

> The new matching pop-out looks really great, and actually now the
> former account coding pop-out looks a bit boring. I wondered if you
> could take a look at the UI, and perhaps improve it. At the same
> time, perhaps it makes sense to introduce Coding Suggestions at the
> same time?

Two mock-ups were shown (A: a card like the Match pop-out; B: fields
beside the supplier's coding history). The operator chose **A**,
**Accept all** rather than pre-filling, suggestions from **similar
lines first, then the supplier's usual coding**, and **"also apply to
the other uncoded lines", unticked**.

## What was found

- **Coding suggestions (0456/0457) had never worked on real data.**
  They looked up `keyed_fields.field = 'BT-133'` (and the other three
  coding fields), but keying records a line's field as
  `line.<n>.BT-133` (since 0109). Their tests seeded the same wrong
  name, so they passed.
- **Every keying save blanked the invoice's structured columns** (since
  0071). Keying handed `handleUpsertInvoice` only `facts` and `lines`,
  and it writes every column it is not given as NULL:
  `supplier_vat_id`, `invoice_number`, `currency`, `issue_date`,
  `total_with_vat` and `mandate_channel`. About two dozen readers use
  these columns (duplicate checks, supplier history, reports, and the
  new suggestions, which found no history because every coded invoice
  had lost its supplier). Found when a test keyed history through the
  real route.

## What was decided

- **The pop-out is a card** (option A), in the Match pop-out's style:
  - title "Line {n} coding", with the line's description and
    quantity × price = amount;
  - chips for the company, the supplier and, on a PO invoice, "Non-PO
    line";
  - one card per field, in a 2×2 grid, turning green with a ✓ once set;
  - the same shared results area (0458) and auto-focus (0459);
  - "Done" at the foot, and a hint that coding is kept on Save.
  Read-only fields show the entry's name as well as its id.
- **A suggestion per line** (`GET /invoices/:id/coding-suggestions` now
  returns `{ lines: { "<n>": … } }`), the whole coding set together:
  1. this supplier's earlier lines whose description is similar (the
     PO line suggester's Dice measure, 0.5 or more), when at least half
     of them agree;
  2. otherwise the supplier's usual coding, from at least 3 coded lines
     with at least half agreeing.
  It draws only on lines a person coded (a coding field in
  `keyed_fields` under its real name, not a 0537 removal), reads the
  coding each line ended with, and says how many lines it is drawn
  from, how sure, and one or two example descriptions. Values the save
  would refuse are dropped (0511). A PO invoice's lines are suggested
  only when marked Non-PO (0537).
- **Accept all, never pre-filled.** The suggestion box shows only when
  it would change a field this person may change. Accept all fills
  those fields; the box then says to save. 0457's pre-fill is gone.
- **Also apply to the other uncoded lines**, unticked. When ticked, the
  fields this person may change are copied, on close, to every other
  line that can be coded here and has no coding at all.
- **Keying keeps the structured columns.** What a person keyed wins
  (BT-31, BT-1, BT-5, BT-2, BT-112, `mandate.channel`); otherwise each
  column keeps its value.
- **Migration `0097` repairs existing rows.** It refills only NULL
  columns, from the fact capture set them from (BT-31, BT-1, BT-5,
  BT-2, BT-112), and never overwrites a value. `mandate_channel` is not
  kept in the facts and cannot be restored. To see how many invoices it
  will repair before applying it (read-only):

  ```sql
  SELECT count(*) FROM invoice_headers
  WHERE supplier_vat_id IS NULL AND json_valid(facts_json)
    AND json_type(facts_json, '$."BT-31"') = 'text';
  ```

## Not built / worth knowing

- Suggestions are deterministic (words and counts), not a trained
  model. Lines with no description fall straight to the supplier's
  usual coding.
- **`mandate_channel`** on invoices keyed before this change stays NULL
  (rules reading `mandate.channel` see nothing for them).
- The old `viewer.coding.heading` and `viewer.coding.suggested`
  strings are no longer used.
- Still open: the header PO match counts Non-PO lines (0537); matching
  ignores PO status.

## Verification

- **`vf-app`**:
  - `coding-suggestions.test.ts` rewritten (11): per-line sets that
    differ within one invoice, similar-then-supplier fallback and the
    thresholds, supplier scoping, only person-coded lines (not a
    supplier's own code, not a removal), history keyed through the real
    keying route, PO invoices' Non-PO lines only, 0511 drops, 404 and
    no supplier;
  - `key-fields.test.ts` (2): a save keeps every column; keyed BT-1 and
    BT-112 update theirs;
  - the router test in `index.test.ts` now seeds history in keying's
    real shape.
  All 13 new tests **failed** with the previous commit's
  `coding-suggestions.ts` and `key-fields-route.ts`.
- Migration `0097` checked on sample rows: NULL columns filled from
  facts (a text BT-112 of "150.50" becomes 150.5), a column that held a
  value kept, invalid JSON and non-numeric totals left alone.
  Replay: 97 migrations, all assertions held.
- **`vf-ui` `viewer.test.ts`**: the pop-out tests moved to the card
  structure; 0457's four pre-fill tests replaced by five (the
  suggestion shown and nothing filled; Accept all fills, marks and
  saves; nothing suggested is saved without it; no suggestion when it
  can't or wouldn't change anything; apply to others only when ticked
  and never over a coded line). 12 failed with the previous
  `viewer.js`; the two that passed check that nothing is filled
  without Accept all, which the old code also did because it could not
  read per-line suggestions.
- Browser 1259/1260 (the known `typography.test.ts` 10px gap). Worker
  75/75. `vf-licence` 320/320.
- **`vf-app`**, a full, unfiltered run: 128 files and 3134 tests, of which **3132 passed**. The two failures are the ones already known on untouched `origin/main` (0511).
- Day, Night and after-Accept screenshots checked by eye.
