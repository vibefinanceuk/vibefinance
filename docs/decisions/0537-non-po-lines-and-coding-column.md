# 0537 — Coding gets its own column; a PO invoice's line is either PO-matched or a Non-PO line coded by hand

**Status: built and tested locally, not yet pushed or deployed.** This
session has no push access, so it is delivered as a git bundle. It
touches `vf-app`, `vf-ui`, `vf-licence` and `shared` (vocabulary), and
needs **`vf-app` migration `0096` (apply before deploying `vf-app`) and
`vf-licence` migration `0193`**.

## What was asked

After deploying 0536, with a Night screenshot of the Coding icon lying
over the Match chips:

> I'm seeing some overlap with the coding icon though. Could we create
> a separate column for the Coding icon, and implement some behaviour.
> Typically, if an invoice line is matched to a PO line. The invoice
> line will pick-up the coding information obtained from the PO when it
> was created. [...] if an invoice line is PO matched, it need not be
> coded manually by a user, so the coding icon can be read-only. If
> however, we have a line that cannot be matched, maybe it is transport
> costs, or freight added, it may be necessary to treat that line as a
> Non-PO invoice line, and update the account coding. The PO Matched
> Line, and Non-PO Account Coded line are mutually exclusive.

Storing coding on PO lines was explicitly left for another time. Asked
four questions, the operator chose: an **explicit** Non-PO choice at
Matching; a Non-PO line **no longer fails** line matching; Non-PO lines
**must be coded** at a coding stage; pairing a coded line **clears** its
manual coding.

## What was decided

- **The overlap.** `.linetable` is `table-layout: fixed`, and 0536 gave
  the Match column `width: 1%`, so it was a few pixels wide and the
  chip spilled into the next cell. It now has a fixed width (116px,
  ellipsis for a long translation) and **Coding has its own column**
  (64px), apart from the ×. The actions cell is no longer
  `display: flex` either.
- **A Non-PO line is an explicit choice at Matching.** The PO line
  picker ends with "Non-PO line (code manually)". It is stored in
  `invoice_line_po_pairings` with `kind = 'non_po'` and no PO line
  (migration `0096` rebuilds the table so `po_line_number` can be
  null). One row per line, so a PO line and a Non-PO marker cannot both
  exist. Like a pairing, it applies only while the invoice names the
  PO it was made against. It overrides the supplier's own BT-132.
  - The Match chip is grey "Non-PO" (no dot), with its own legend line;
    the panel and pop-out say "Marked Non-PO by {who}".
  - The Timeline says "{who} marked invoice line {n} as a Non-PO line"
    (`po_pair` with comment `n:non-po`).
- **Resolved for the rules.** At evaluation a Non-PO line loses BT-132
  and carries `po.line_non_po: true`; every other `po.line_*` fact is
  left absent, and `is`/`is_not` never fire on an absent fact, so the
  standard line matching rules leave it alone. `po.line_non_po` is a
  new vocabulary fact, so a rule can route such lines on purpose (for
  example to approval above an amount). It takes nothing from any PO
  line's consumption (0533), this invoice's or another's.
- **Coding only on a Non-PO line of a PO invoice.**
  - **Coding column:** on a PO invoice, the Coding button is dimmed and
    its pop-out read-only, with a note: "Matched to PO line {n}. Its
    coding comes from the purchase order." or, for a line with no PO
    line, "To code it, mark it as a Non-PO line at Matching." A Non-PO
    line is codable as usual. A Non-PO invoice is unchanged.
  - **Server:** keying coding on a PO invoice's line that is not marked
    Non-PO is refused (`422 coding_on_po_line`). Only what the save
    changes, so a supplier's own BT-133 resent untouched never blocks it.
  - **Required at a coding stage** (narrowing 0514): on a PO invoice,
    Complete needs every editable coding field filled on each Non-PO
    line, and never on any other line.
  - **Checked only where it applies:** `coding.line_invalid` (0511) is
    empty on every line of a PO invoice except Non-PO lines, so a
    supplier's invalid BT-133 on a PO-matched line is no longer flagged.
- **Mutually exclusive, enforced.** Pairing a line with a PO line, or
  clearing a pairing, removes any coding a person keyed on it: each
  field goes back to what the document held before anyone keyed it
  (the supplier's BT-133, or nothing), recorded in `keyed_fields`. The
  panel says "Line {n} now has a PO line, so the coding keyed on it was
  removed", and the Timeline adds "(manual coding removed)". Coding
  nobody keyed is left alone; it is ignored on a PO-matched line.
  Coding suggestions skip these removals.

## Not built / worth knowing

- **Coding from the PO line** is not stored or shown, as agreed. When
  it is, the read-only pop-out is where it belongs.
- **The header match still counts a Non-PO line.** `po.matched`
  compares the invoice total (BT-112) with what is left on the PO, so a
  large freight line can still push the header over tolerance. A
  possible follow-up is to leave Non-PO lines out of that comparison.
- **Found in passing, not fixed:** coding suggestions
  (`coding-suggestions.ts`) look up `keyed_fields.field = 'BT-133'` on
  lines, but keying records a line's field as `line.<n>.BT-133`, so on
  real data they may never find anything. Worth checking separately.
- Still open from 0534: matching ignores PO status.

## Verification

- **`vf-app`**, new tests:
  - `po-match-panel.test.ts` (6): marking Non-PO over a real supplier
    reference leaves only `po.line_non_po` among the line's `po.line_*`
    facts, the summary says `nonpo`, the panel offers no suggestion and
    the Timeline reads `2:non-po`; a Non-PO line takes nothing from the
    PO; keying coding on a PO line is refused until the line is Non-PO;
    `coding.line_invalid` only on Non-PO lines; pairing a coded Non-PO
    line restores the supplier's BT-133 (facts, `cost_centre`, trail,
    `3:4:coding-cleared`), and a second pairing clears nothing; clearing
    removes coding that only a person put there.
  - `index.test.ts` (1): Complete on a PO invoice is refused for an
    uncoded Non-PO line only, and allowed once the marker belongs to a
    different PO.
- **`vf-ui`**, new tests: `po-match.test.ts` (4: the picker option and
  what it posts, the resolved row, the coding-removed notice, the grey
  chip and pop-out note); `viewer.test.ts` (3: Coding in its own
  column, read-only with reasons on PO lines, unchanged on a Non-PO
  invoice) and the Timeline wording. **All 9 failed** with the previous
  commit's `viewer.js`, `po-match.js`, `activity.js` and `app.css`.
- `vf-app` migration replay: 96 migrations, all assertions held.
  `vf-licence` 0193's assertion (22 rows) checked against a replay.
- Browser 1257/1258 (the known `typography.test.ts` 10px gap). Worker
  75/75. `vf-licence` 320/320. `shared` 295/298; the same 3 fail on
  untouched code (licence token and table-classes).
- **`vf-app`**, a full, unfiltered run: 128 files and 3132 tests, of which **3130 passed**. The two failures are the ones already known on untouched `origin/main` (0511). All 7 new `vf-app` tests **failed** with the previous commit's source restored.
- Day and Night screenshots of the line table checked by eye: Match and
  Coding in their own columns, nothing overlapping.
