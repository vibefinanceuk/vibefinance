# 0530 — The Matching stage's PO matching panel, phase 1

**Status: pushed (`eadde7b`), deployed, and both migrations (`vf-app` `0093`, `vf-licence` `0188`) applied, as confirmed by the operator on 28 September.** Its button did not appear on the live Matching task; decision 0531 fixes that.

## What was asked

> In the matching stage I would like to make available a UI, within
> which a user can view any automatic matching that has taken place
> with an existing purchase order, and furthermore correct, or search
> for a match purchase order from the information stored in the system.
> The UI should also indicate how much of a PO is used up / consumed.
> Could you mock-up a UI for availability in the Matching stage to
> achieve this?

The operator liked the mock-up, with one change: "Already invoiced" and
"This invoice" on the used-up bar were too alike (now grey and blue).
Asked how to launch it, it was split into four phases, and the operator
said: "lets proceed with phase 1".

The four phases:

1. **This decision.** The panel and its button, from data that already
   exists.
2. Saving a person's line pairing so the next match respects it.
3. Per-line consumption across invoices.
4. Suggestions for lines that carry no order line reference.

## What was built

### `vf-app`

`po-match-panel-route.ts`, three routes. `AP.Match` (the Matching
stage's permission) or `AP.Validate` may call them. POs are scoped the
way the Purchase Orders screen's are (0375): one outside the person's
units reads as not held.

- **`GET /invoices/:id/po-match`**, what the panel shows:
  - the PO the invoice's BT-13 names, with buyer, supplier (by the PO's
    seller VAT) and status in the Purchase Orders screen's own five
    values (0377);
  - **how much of the PO is used**: BT-112 summed over every *other*
    invoice naming it (the same sum as 0377's "Invoiced (Part/Full)"),
    this invoice's BT-112, and what is left, which goes negative when
    over;
  - each invoice line against the PO line its BT-132 names, with the
    verdict from `computePoLineMatch`, the function the Matching rules
    read, so the panel cannot disagree with the rules;
  - PO lines no invoice line names;
  - the tolerance in force (supplier, or the org default);
  - `referenceNotFound`, telling "names a PO we don't hold" apart from
    "names none";
  - `canRelink`: whether this person has the open task.
- **`GET /invoices/:id/po-candidates`**: the Purchase Orders screen's
  search (order number, seller VAT, line items), with three filters:
  this supplier (PO seller VAT = invoice BT-31), active only, and enough
  left for this invoice. Each result says why it fits (same supplier,
  enough left, same currency). Up to 25.
- **`POST /invoices/:id/po-link`** `{ orderNumber }`: sets BT-13
  through `handleKeyInvoiceFields`, so the checks keying already makes
  apply unchanged (BT-13 editable at this stage, the keying trail).
  Before that, it requires:
  - an open task at the current stage that is the caller's;
  - a PO that exists, is in scope, and is not closed.

  It then writes a `po_link` Timeline event.
- **`vf-app` migration `0093`** widens `task_action_events.action` to
  include `po_link`, rebuilt the same way as 0084 and 0086. `comment`
  holds the order number, and a standing invariant says it always does.

### `vf-ui`

- **`po-match.js`**: the panel, from the agreed mock-up:
  - the linked PO card and used-up bar (grey, blue, left; red when
    over);
  - the line table with each verdict in words;
  - PO lines not used;
  - search with this supplier and active switched on;
  - **Use this PO**, offered only when `canRelink`, and not for a closed
    PO.

  A re-link reloads the panel, and closing it redraws the document with
  its new BT-13.
- **The button** is in the viewer's action row on any task requiring
  `AP.Match`, the permission every standard matching rule's task
  carries (0474).
- **Timeline**: "{who} linked this to purchase order {po}", with the
  button's icon.
- **Proxy**: all three routes added to the allowlist, and to the
  proxy test's list of routes screens call.

### `vf-licence`

Migration `0188`: 60 strings in English and German. PO statuses reuse
`purchaseorders.status.*`.

## Found while building

**Line matching compares against the whole PO line.**
`computePoLineMatch` checks an invoice line's amount and quantity
against the PO line's full ordered amount and quantity. So an invoice
for 10 of a 20-unit PO line reads as a 50% amount difference, not as a
partial delivery. The panel shows the rules' verdict honestly, so a
part-invoiced line will show "Amount differs". **Phase 3 (per-line
consumption) is where this gets fixed.** It should compare against
what is left on the line, not the whole line.

## Not built in phase 1

- **Unlinking** an invoice from every PO. Keying refuses an empty
  value by design (0071), and it needs its own decision.
- **Pairing a line by hand, per-line consumption, suggestions**:
  phases 2 to 4.
- **Re-evaluating the Matching rules on re-link.** Nothing re-runs
  when BT-13 changes, as with any keyed edit (0072). The rules check
  again when the task is completed (0487).
- **Invoices counted as "already invoiced"** include every invoice
  naming the PO, whatever its state (discarded or returned invoices
  too), exactly as the Purchase Orders screen counts today. Excluding
  them belongs with phase 3.

## Verification

- **`vf-app`**, a full, unfiltered run: 127 files and 3093 tests, of
  which **3091 passed**. The two failures are the ones already known on
  untouched `origin/main` (0511): `capture-pdf`'s "writes the corrected
  value back" and `stage-permissions`'s "names exactly the permissions
  the code defines".
- **`vf-app` `po-match-panel.test.ts`**, 10 tests covering:
  - the view: PO, usage, line verdicts, unused lines, tolerance;
  - a PO not held vs. none named;
  - `canRelink` only for the task's owner;
  - 404;
  - search filters, item search and reasons;
  - re-link sets BT-13 and writes `po_link`;
  - closed, unknown and missing PO numbers refused;
  - someone else's task refused, with nothing changed;
  - BT-13 read-only at the stage refused through keying, with no event.

  The Timeline test **failed** without migration `0093` (the CHECK
  constraint).
- **`vf-ui`**:
  - `po-match.test.ts`: 8 tests;
  - `viewer.test.ts`: the button appears only on an `AP.Match` task,
    and the `po_link` Timeline line;
  - `index.test.ts`: the proxy allows all three routes.

  The viewer tests **failed** with the production files stashed. Browser
  1227/1228; the one failure is the known `typography.test.ts` `10px`
  gap. Worker 75/75.
- **`vf-licence`**: 320 tests. One login rate-limit timing test failed
  once while the `vf-app` suite ran alongside, and passed on its own.
  `string-coverage.test.ts` includes all 60 keys.
- **`apply_migrations.py --replay-only`**: 93 migrations, all
  assertions held.
- **A Playwright screenshot** of the real `po-match.js` and stylesheet,
  Day and Night.
