# 0534 — PO matching, phase 4: a suggested PO line for an invoice line with none

**Status: pushed (`71e7e14`), deployed, and migration `vf-licence` `0191` applied, as confirmed by the operator on 28 September.**

## What was asked

After 0533 was confirmed live: "yes, please proceed with phase 4". The
last of the four phases agreed at 0530: suggest a PO line for invoice
lines that arrive with no usable reference.

## What was decided

- **Scored, not guessed.** `po-suggest.ts` scores an invoice line
  against each line of the linked PO, from 0 to 100, and gives its
  reasons:
  - **The same item code** (BT-155 seller's item id, or BT-157
    standard id, against the PO line's own) is near-certain: at least
    95.
  - **Otherwise it is weighted:**
    - 60%: description, the words shared between BT-153/BT-154 and the
      PO line's name and description (a Dice coefficient; lower-cased,
      a plural "s" dropped, stopwords ignored);
    - 25%: unit price, full within 1%, half within 10%;
    - 10%: fit, the quantity not over what is left on the PO line after
      other invoices (0533's consumption);
    - 5%: the same unit.
  - **Below 50 nothing is suggested.** There is no AI model in this: the
    same inputs always give the same suggestion, and each reason can be
    checked on screen.
- **Only where needed.** A line gets a suggestion only when no PO line
  is in force: no reference, or one the PO does not have, and no saved
  pairing (0532).
- **Accept is an ordinary pairing.** It posts to 0532's
  `POST /invoices/:id/po-pairing`, so everything a pairing does follows:
  the rules read it, the Timeline records it, and it can be cleared.
  Nothing is ever paired without a person choosing it. Only the person
  whose task it is sees Accept.
- **The panel** shows "Suggested: line 4, Desk organiser (80% match:
  similar description · same price · fits what is left) [Accept]"
  under the line's picker.
- **The PO search** adds "{n} of {total} lines look alike" to each
  result's reasons: how many of this invoice's lines would get a
  suggestion against that PO. It is scored only for the POs returned,
  one query each.
- **`vf-licence` migration `0191`**: 8 strings in English and German.

## Worth knowing

- **BT-155 and BT-157 are not in the fact vocabulary today**, so the
  item-code reason fires only if a line's stored facts carry them. The
  description, price and fit reasons work on what every line has.
- The weights and threshold are constants in `po-suggest.ts`, so they
  are easy to tune once real invoices show how they behave.

## Verification

- **`vf-app`**, a full, unfiltered run: 128 files and 3121 tests, of
  which **3119 passed**. The two failures are the ones already known on
  untouched `origin/main` (0511).
- **`vf-licence`**: 320/320.
- **`vf-app` `po-suggest.test.ts`**, 7 tests of the scoring itself:
  - the weighted score and its reasons (80 for the panel's own
    example);
  - the same item code near-certain whatever the words;
  - price within 10% and a quantity past what is left;
  - a unit price derived from amount and quantity;
  - the best of several lines;
  - nothing below the threshold, or with no PO lines;
  - word handling.
- **`vf-app` `po-match-panel.test.ts`**, 2 new tests:
  - a suggestion on the line with no reference, none on matched lines,
    and none once the line is paired;
  - "lines alike" counts per searched PO.

  Both **failed** with the route stashed.
- **`vf-ui` `po-match.test.ts`**, 4 new tests:
  - the suggestion box text;
  - Accept posting the pairing;
  - no Accept without the task;
  - "2 of 3 lines look alike" in the search.

  All 4 **failed** with `po-match.js` stashed. Browser 1240/1241 (the
  known `typography.test.ts` gap). Worker 75/75.
- **`apply_migrations.py --replay-only`**: all assertions held.
- **A Playwright screenshot** of the real panel with a suggestion.
