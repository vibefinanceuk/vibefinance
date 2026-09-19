# 0400 — Three tiers for the fourth piece

**Status: built, not yet pushed.** The fourth and final piece of the
four-piece sequence 0395 opened: red, amber and green on the
validation screen's key fields and exceptions list, deferred by 0395,
0396, 0397 and 0398 pending the one open question each of them left
for it — whether "mismatch" and "needs review" already exist as
separate claims upstream of the validation screen's data model.

---

## What was asked

0395's own record of the request: *"i also like the colouring of the
red amber green fields in the arrivals board. that could be used to
highlight exceptions in the validation screen."* Told to continue to
this last piece, the answer was: investigate first, then ask.

---

## The investigation

The question every prior decision in this sequence deferred: does a
distinction between "this disagrees" and "this merely needs a human
look" already exist anywhere upstream of the validation screen? It
does not. `validateInvoiceFacts()` (`workers/vf-app/src/validation.ts`)
produced one flat list of `failures`/`invalidCodes`, no severity of
any kind, and `viewer.js`'s own exceptions panel painted every one of
them with the same single `.failing` class — one amber, not three
colours. The hidden exceptions panel (its `<div id="exlist">` still
built but never mounted since an earlier decision) confirmed the same:
nothing already there to repurpose.

That meant building the distinction rather than finding it, and three
scope questions genuinely needed the operator's own answer rather than
a guess:

- **Backend scope.** Wire the existing PO three-way-match
  (`po-matching.ts`, already computing `po.matched`/`po.variance_pct`
  against real purchase-order rows) into the validation/exceptions
  pipeline, so a red tier means something checked against a source of
  truth outside the document — or keep this piece CSS-only, styling
  the six existing checks alone. **Answered: wire it in.**
- **Exceptions panel.** Bring the hidden panel back, now that it would
  show something richer — or leave it hidden. **Answered: leave it
  hidden.** (Its markup, and the panel's own CSS, are still kept in
  step with the new severity classes — see "What was built" — so
  nothing about this choice is a shortcut that would need redoing if
  it's ever unhidden.)
- **Green state.** What "confirmed, not just untouched" means for a
  field. **Answered: use your own judgement.**

The mapping built from those answers, and the reasoning behind it:

- **Danger** — the new `po_mismatch` check alone. It is the only check
  compared against something outside the document itself (a linked
  purchase order), rather than the document's own numbers disagreeing
  with each other.
- **Warning** — the original six checks, unchanged in what they test.
  A document's own arithmetic or codes disagreeing with itself is real,
  but it is not the same class of problem as contradicting an external
  record.
- **Ok (green)** — a check ran against this field and it agreed. Built
  as `confirms`, `ValidationFailure`'s deliberate positive twin (see
  below) — **not** given to `total_missing` on a pass: presence is not
  agreement, and a green dot on a field that was merely *there* would
  be a claim the check never made.

A `po.matched === false` reading needed one more distinction before it
could safely mean "danger": `po-matching.ts` deliberately conflates "no
PO was ever referenced" with "a referenced PO genuinely disagrees" —
both read `matched: false`. Painting every invoice with no PO red would
have been wrong for the (likely large) majority of invoices with
nothing to match against. The new check instead gates on
`po.variance_pct !== undefined` — a real comparison happened — before
it says anything at all.

---

## What was built

### Backend — `workers/vf-app/src/validation.ts`

- A new `"po_mismatch"` check, added to `VALIDATION_CHECKS`, comparing
  `po.matched`/`po.variance_pct` (header) and `po.line_matched`/
  `po.line_variance_pct` (per line) from `po-matching.ts`'s own facts —
  the module's existing, tolerance-aware, always-recomputed-fresh
  comparison, never a second implementation of matching logic.
- `ValidationSeverity = "danger" | "warning"`, and a required
  `severity` field on every `ValidationFailure` — all six original
  checks tagged `"warning"`, the new one `"danger"`.
- `ValidationConfirmation` — deliberately its own interface, not
  `ValidationFailure` with `passed: true` bolted on: it carries no
  `value` and no `severity`, because a confirmation is a different
  kind of claim ("this agreed") from a failure ("this disagreed, and
  here is how badly"), not the same claim with the sign flipped.
  Reported as `confirms` on `ValidationResult`, alongside the existing
  `involves`, by the same checks that report failures — so the two
  can't drift apart the way a separately-computed mapping could.
- `invoice-facts-route.ts` and `key-fields-route.ts` both now merge
  fresh PO-match facts (`mergePoMatchFacts`) into what they validate,
  and both pass `confirms` through to the response alongside `involves`.
  **`key-fields-route.ts` wires header-level `po_mismatch` only** — see
  "What is not built".

### Frontend — `tokens.css`, `app.css`, `viewer.js`

Four new, mood-invariant tokens (`--severity-danger-bg/-text`,
`--severity-warning-bg/-text`, `--severity-ok-bg/-text`, and
`--severity-value-text`, a fixed dark value-text colour) — never
redefined for Night, the same "one value doing double duty in both
moods" technique `--border-danger`/`--border-warning`/`--border-success`
already used. Built new rather than reusing the general
`--bg-warning`/`--text-warning`/`--bg-success`/`--text-success` tokens,
directly on the operator's own correction to the first mock-up: *"can
you use the paler 'day' colours for the night scheme also?"* Those
general tokens carry separate, deliberately darker Night values and are
used in roughly fifteen other places across the app (status labels,
stat tiles, rule states) — redarkening them for this request would have
changed all of those too. `--severity-value-text` exists because the
field backgrounds no longer flip with Night, so `--text-primary` (which
does flip, to a light colour) would have gone invisible against them —
caught by re-screenshotting the corrected mock-up, not assumed.

`markFields()` was rewritten from a single `.failing` class into an
explicit three-pass paint, least urgent first: `confirms` (ok), then
`warning`-severity exceptions, then `danger`-severity exceptions last —
so a field two checks disagree about always ends up at its worst tier,
deterministically, rather than depending on which entry the backend
happened to list first. A `.kf` field also gets a small coloured dot
beside its label (`.kf-dot`); a `.linetable` cell does not, since it
has no label for a dot to sit beside. `exceptionRow()` (the hidden
panel's own row builder) carries a matching `.exrow.danger` class, kept
in step even though nothing currently renders it.

### A pre-existing bug, found while verifying this one

Screenshotting the real integrated markup (not just the mock-up) for
Day/Night sign-off surfaced a real, pre-existing off-by-one in the
line-cell marking logic, unrelated to this decision's own new code but
directly in the path of what it was trying to show: `lineRow()` lays a
line out as `[...lineFields.map(cell), removeButtonTd]` — no leading
row-counter column (an earlier decision removed the last one) — so a
field at `lineFields` position `index` sits at `row.children[index]`.
The marking code read `row.children[index + 1]`, silently marking the
field *after* the named one, or, for the last line field, the remove
button's own cell (invisible in CSS, since nothing targets it, but it
did hijack the button's tooltip). This bug pre-dates decision 0400 —
the old single-tier `.failing` version carried the identical `+ 1` —
and had simply never been looked at closely enough to notice, because
nothing before this change screenshotted a line cell. Fixed as part of
this decision, `row.children[index]`, with its own fail-first
regression test.

---

## Tests

`workers/vf-app/test/validation.test.ts` — 15 new tests across three
`describe` blocks: severity tagging on all seven checks, `confirms` for
the five checks that produce it (and its deliberate absence for
`total_missing`), and `po_mismatch` header/line pass-fail behaviour
including the no-PO-data skip and rule-engine reachability. Fail-first
verified (10/15 failed correctly against the pre-change code, 5 passed
vacuously — checks unaffected by this change, as expected). Full
vf-app suite: **1936/1936**.

`workers/vf-licence/test/string-coverage.test.ts` — `check.po_mismatch`
added to `KEYS_THE_INTERFACE_USES`; migration `0124` seeds it, en and
de. Full vf-licence suite: **320/320**.

`workers/vf-ui/test-browser/viewer.test.ts` — the existing exceptions-
panel tests updated from the old single `.failing` class to the new
`.warning`/`.danger` tiers (the fixture's `involves` entry now carries
`severity: "warning"`, matching `vat_arithmetic`'s real tagging). Five
new tests: a `po_mismatch` failure marked danger with the right
tooltip; a confirmation marked ok with its dot; danger winning a field
over an ok confirmation on the same field regardless of array order;
the line-cell off-by-one regression (asserts the *named* field's own
cell is marked, not its neighbour or the remove button); and the
post-save handler re-reading `confirms`, not only `loadInvoice()`.
Fail-first verified throughout — each new/changed assertion confirmed
failing for the right reason against the pre-change file, then passing.

Visually verified against the real integrated markup (not the
standalone mock-up) with Playwright: a repro page importing the real
`viewer.js`/`app.css`/`tokens.css` and opening an actual invoice with a
mixed danger/warning/ok result set, screenshotted in both Day and
Night. Purchase order and Total with VAT (both named by the `po_mismatch`
failure) render pale red with dark, legible text; Net before VAT, VAT
amount, and both line amounts (confirmed by `vat_arithmetic`/`line_sum`)
render pale green; every tier stays visually identical between Day and
Night, per the operator's own correction. The repro file was a
temporary `_repro_severity.html` under `public/`, deleted after use —
nothing shipped from it.

Full suites: vf-app 1936/1936, vf-licence 320/320, vf-ui 709 browser +
74 Worker (708 pre-existing + 1 net new — one test removed for the
`.failing`→tier rewrite, six added; five for the new tiers, one the
off-by-one regression). `eslint` clean across every touched file.
`scripts/check-citations.py` clean once this record was written (it
had flagged 0400 as cited-but-unwritten beforehand — eight references
in `key-fields-route.ts` alone, from its own explanatory comment about
the header-only PO gap below).

The pre-existing `no stub for /api/documents/:id/activity` /
`/api/invoices/:id/pages` "Unhandled Rejection" noise seen while
running `viewer.test.ts` (fire-and-forget fetches inside
`buildActivityTab`/`pageViewer` that a handful of test fixtures don't
stub) was confirmed present against the file with none of this
decision's changes applied, test file included — not introduced here,
the same kind of pre-existing async noise `document-window.test.ts`
and `dashboard.test.ts` already carry (0397's own record notes the
latter).

---

## What is not built

**`key-fields-route.ts` wires header-level `po_mismatch` only.** Its
`lines.results` is the raw `invoice_lines` DB row shape — `facts_json`
still an unparsed JSON string column, never structured — passed to
`validateInvoiceFacts` behind a pre-existing `as never` cast. That means
`line["BT-131"]` (and now `line["po.line_matched"]`, etc.) is always
`undefined` through this specific re-keying endpoint, so line-level
`line_sum` and line-level `po_mismatch` alike silently never fire on
this path — a gap that pre-dates this decision and is out of its scope
to fix. Header-level `po_mismatch` works correctly here (merged with an
empty lines array); both header- and line-level `po_mismatch` work
correctly through `invoice-facts-route.ts`'s on-arrival path and every
real stage visit, both of which hold genuinely parsed line facts. Left
as an explicit code comment at the call site rather than silently
patched over or silently ignored.

**The exceptions panel stays hidden.** The operator's own choice
(above), not an oversight — its markup and CSS were kept current with
the new severity tiers regardless, so nothing here would need redoing
if a later decision brings it back.

This closes the four-piece sequence 0395 opened. `SUPERSEDED.md` does
not need an entry for it: 0395's own speculative reasoning about what
a red/amber/green mapping might look like is borne out by what was
actually built here, not contradicted by it.
