# 0403 — The check the line table never got

**Status: code built and tested, not yet pushed.**

---

## What was asked

The operator's own report, on the Documents viewer: *"The format / shape
of the fields in the Invoice Header card seem square, whereas the format
/ shape in the Invoice lines card see rounder. I prefer the rounded edge
of the Invoice lines, and wondered if that could be applied to the
Invoice Header fields."*

---

## The investigation

A static read of `app.css` found nothing that could explain a shape
difference: one global, unscoped rule (`input:not([type="checkbox"])
:not([type="radio"]), select { border-radius: var(--radius); ... }`)
covers every `<input>` and `<select>` in the app, and neither `.kf`
(header) nor `.linetable` (lines) overrides it anywhere. A live fetch of
the deployed `app.css` confirmed that rule is present, verbatim, in
production too — this was never a repo/deploy drift.

The operator, asked directly whether the square fields were specifically
the dropdown/code fields (a live theory about unstyled `<select>`
elements ignoring `border-radius`, since the app never resets one) or
every field, answered: **every field**. That ruled out the `<select>`
theory — a dropdown-only explanation cannot account for plain text and
date fields looking square too.

The operator's own next message named the real axis: *"I think this may
be related to whether the field is locked or editable."* Confirmed
looking at `field()` (`viewer.js`, decision 0114): a locked field renders
as a `.readonly` `<div>` — deliberately not a box at all (*"A greyed-out
box invites clicking and reads as broken; plain text says the value is
information rather than something to change"*), so there was no border
or radius to compare in the first place. An editable field renders a
real `<input>`/`<select>`, which does inherit the global rounded-corner
rule. The "square vs. round" the operator saw was flat text next to a
genuine box, not two boxes with different corners.

That still left the actual question open: *why* was the Header locked at
all, on a stage — Validation — the operator expected to be able to
correct fields on? A read-only diagnostic (`check-header-lock/
01-diagnose-visibility.sh`, three tables: `process_stages.read_only`,
`stage_field_visibility`, `field_visibility`) came back **empty on every
row that would explain it**: the Validation stage is not blanket
read-only, no per-field stage restriction exists for it, and the
customer-level defaults leave every header field `edit`. Per
`resolveFieldVisibility` (`field-visibility-route.ts`), the Header
*should* have been editable.

The remaining variable is client-side, not data-driven:
`canEditAnything` (`viewer.js`, decisions 0142/0288) additionally
requires `task.ownership === "mine"` — *"a document can be opened in
read-only mode, when it is not claimed, however in order to act on the
document in Edit mode, it must be claimed."* The operator confirmed the
invoice in question was not claimed by them. That explains the Header
correctly: `field()` already checks `!canEditAnything` alongside the
field's own visibility (line 328), so an unclaimed document's header
correctly renders read-only regardless of what the fields are
configured to allow.

**It does not explain why the Lines were editable.** `lineRow()`'s own
`cell()` function, which decides whether a line-table cell renders an
`<input>` or a `.readonly` div, checked only `spec.visibility === "read"`
— never `canEditAnything`. So on the same unclaimed document, the Header
correctly went read-only and the Lines incorrectly stayed real, editable
inputs. The operator's own words, once the mechanism was in view: *"So a
couple of things here - because the invoice was not claimed by my user,
then the line items should also not appear in edit mode."*

This is the same shape of bug `read-only-stage.test.ts` already
documents once, for a different gate: *"an approval stage was configured
with three header fields set to `read`, and line fields stayed editable
— so a Save button appeared on an approval screen and the amounts on a
line could be changed."* That earlier bug was fixed at the data layer
(`resolveFieldVisibility` deriving read-only from a stage property rather
than an enumerated list, so it necessarily covers every field including
lines). This one is the same failure mode at the *client* layer: a check
added to `field()` for the claim gate and never carried to `cell()`.

---

## What was built

### `workers/vf-ui/public/app.css`

`.readonly` gained `background: var(--surface-0)` and
`border-radius: var(--radius)`, plus horizontal padding (`8px 11px`,
matching an input's own) so there is actually a box for the radius to
apply to. `--surface-0` — a step more muted than an input's own
`--surface-1` — keeps a locked field reading as a flatter, non-clickable
fill rather than something to click into, per the operator's own choice
among three options (a subtly-filled rounded box, a rounded outline with
no fill, or leaving it as bare text). No border was added, and nothing
about decision 0114's own reasoning changes: a locked field is still
inert text, just text that now shares the app's one visual language for
corners with every editable field, wherever `.readonly` is used —
Header, Lines, and the header-fields pop-out alike.

### `workers/vf-ui/public/viewer.js`

`lineRow()`'s `cell()` now renders read-only when `spec.visibility ===
"read"` **or `!canEditAnything`** — the same second condition `field()`
already carried. An unclaimed (or someone-else's-locked) document now
renders every line field as text, exactly as it already renders every
header field, and a Save button was already absent in this case (decision
0288's own existing check), so this closes the one remaining path by
which such a document could still be edited and, had a caller reached
the save endpoint directly, saved.

---

## Tests

`workers/vf-ui/test-browser/viewer.test.ts` — one new test, beside the
existing "stays read-only for an unclaimed task even when the stage
permits editing" test it mirrors: an `ownership: "available"` task with
one line seeded asserts `.linetable input` is absent and `.linetable
.readonly` is present. Fail-first verified (stashed `viewer.js` alone,
confirmed the new test failed with a real `<input type="number"
value="60">` in the DOM, restored the fix, confirmed it passes).

Full `vf-ui` browser suite: **710/710 passing** (709 on `main` before
this change). The suite's pre-existing ~160 unhandled-rejection warnings
(an unstubbed `/api/documents/:id/activity` fetch that several tests in
this same `describe` block already trigger, `npm test`'s exit code
already nonzero on `main` for the same reason) are unaffected in kind —
the new test triggers one more instance of the same pre-existing gap,
not a new one. `eslint` and `scripts/check-citations.py` clean.

---

## What is not built

**The `/api/documents/:id/activity` stub gap** in
`test-browser/viewer.test.ts`'s `stubFetch` helper, which every test in
this describe block already surfaces as an unhandled rejection on `main`.
Pre-existing, out of scope here, and flagged rather than fixed in
passing.

**No server-side check was added or audited** confirming the save
endpoint itself would reject a line edit posted for an unclaimed
document, independent of what the UI shows. The client-side fix removes
the only path the UI offered to construct such an edit; whether the API
also refuses one sent directly was not investigated as part of this
decision.
