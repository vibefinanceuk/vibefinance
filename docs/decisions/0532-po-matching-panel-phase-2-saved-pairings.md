# 0532 — The PO matching panel, phase 2: a line paired by hand is kept, and header-only keying no longer deletes lines

**Status: pushed (`6b151a2`), deployed, and both migrations (`vf-app` `0094`, `vf-licence` `0189`) applied, as confirmed by the operator on 28 September.**

## What was asked

After 0531 was confirmed live: "Lets move onto phase 2". Phase 2 of the
four agreed at 0530 is to let a person pair an invoice line with a PO
line by hand, and keep that choice so the next match respects it.

## What was decided

- **Pairings live in their own table** (`invoice_line_po_pairings`,
  `vf-app` migration `0094`), never written over the supplier's BT-132.
  BT-132 is what the supplier sent, and it is hidden by default (0164),
  so keying it was not an option either.
- **A pairing is applied as the line's order line reference at
  evaluation** (`po-pairings.ts`, `applySavedPairings`), before
  `mergePoMatchFacts`, in every path that knows which invoice it is
  evaluating:
  - `loadLiveInvoiceFacts`: every re-evaluation after a task completes,
    and the 0487 re-check;
  - the invoice read path (`handleGetInvoice`), for the validation
    verdict;
  - the stage-visit route;
  - the panel.

  The rules, the invoice screen and the panel all see the person's
  choice. Stored line facts are never changed.
- **A pairing belongs to the PO it was made against.** `order_number`
  is stored with it, and it applies only while the invoice's BT-13
  names that PO. Re-linking (0530) leaves it stored but inert; linking
  back brings it back.
- **`POST /invoices/:id/po-pairing` `{ lineNumber, poLineNumber }`**
  saves a pairing; `poLineNumber: null` clears it, so the line falls
  back to the supplier's BT-132. It needs the same things re-linking
  does: an open task at the current stage that is the caller's, an
  invoice linked to a PO held here and in scope, and a real invoice
  line and PO line. Each save or clear writes a `po_pair` Timeline
  event (`comment` is `"<invoice line>:<PO line>"`, with the PO line
  empty when cleared). Migration `0094` widens `task_action_events`
  for it, with standing invariants for both new shapes.
- **The panel** gives each invoice line a picker for its PO line, to
  the person whose task it is. The first option is "The invoice's own
  reference (line N)", or "Choose a PO line…" when there is none; then
  every PO line. The resolved PO line's name is shown under the picker,
  and a saved pairing reads "Paired by {who} · the invoice says line
  {ref}". A save reloads the panel, and closing it redraws the
  document, as a re-link already did.
- **Timeline**: "{who} paired invoice line {line} with PO line
  {poline}" and "{who} cleared the pairing for invoice line {line}".
- **`vf-licence` migration `0189`**: 9 strings in English and German.
- **Proxy**: the new route added, with its entry in the proxy test.

## Found, and fixed here: header-only keying deleted every line

Testing that a pairing goes inert on re-link showed the invoice's
lines had disappeared. `handleKeyInvoiceFields` passed no `lines` to
the invoice writer when none were sent, and the writer replaces the
whole line set, so an absent set meant an empty one.

- The viewer's own Save always sends every line, so nothing on screen
  hit this.
- **0530's "Use this PO" keys BT-13 alone, so re-linking a live invoice
  deleted its lines.** The operator was told immediately not to use it
  until this is deployed.

**Fixed:** an absent `lines` now writes the stored lines back
unchanged (number, description, amount, cost centre and facts).

**Also noted, not changed:** the same writer sets the structured header
columns (`supplier_vat_id`, `currency`, `invoice_number` and others)
from its arguments, which keying does not pass. Evaluation reads
`facts_json` first (`mergeStructuredInvoiceFacts`), so no behaviour
depends on this today. It is worth its own look.

## Not built

- **"Not on this PO"** (marking a line as belonging to no PO line, such
  as freight). The standard "PO line not found" rule would still fire,
  so it needs a fact the rules can read; its own decision.
- **Re-evaluating the Matching rules on save.** As with re-linking, the
  rules check again when the task is completed, and only if the stage
  re-checks on Complete (0487). The live Matching stage has "re-verify
  on complete" off.
- Phases 3 (per-line consumption, and matching against what is left on
  a line) and 4 (suggestions).

## Verification

- **`vf-app`**, a full, unfiltered run: 127 files and 3103 tests, of
  which **3101 passed**. The two failures are the ones already known on
  untouched `origin/main` (0511).
- **`vf-app` `po-match-panel.test.ts`**, 5 new tests:
  - pairing a line with no reference: the panel and
    `loadLiveInvoiceFacts` both see it, `po.line_reference_found`
    becomes true, stored facts are untouched, and a `po_pair` event is
    written;
  - overriding a supplier reference, then clearing it back;
  - a pairing goes inert on re-link and returns on linking back;
  - refusals: someone else's task, an unknown PO line, an unknown
    invoice line, and a missing field, with nothing saved;
  - refusal when no held PO is linked.
- **`vf-app` `key-fields.test.ts`**: header-only keying keeps both lines
  exactly (description, amount, cost centre, facts). It **failed** with
  `key-fields-route.ts` stashed.
- **`vf-ui`**:
  - `po-match.test.ts`: 4 new tests (picker options and starting value;
    save, reload and redraw on close; clearing; no picker without the
    task);
  - `viewer.test.ts`: both Timeline lines.

  4 of the 5 **failed** with `po-match.js` and `activity.js` stashed.
  The fifth, no picker without the task, passes either way, as
  expected. Browser 1233/1234 (the known `typography.test.ts` gap).
  Worker 75/75.
- **`vf-licence`**: 320/320.
- **`apply_migrations.py --replay-only`**: 94 migrations, all
  assertions held.
- **A Playwright screenshot** of the real panel with a saved pairing.
