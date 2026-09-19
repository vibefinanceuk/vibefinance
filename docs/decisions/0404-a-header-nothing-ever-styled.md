# 0404 — A header nothing ever styled

**Status: code built and tested, not yet pushed.**

---

## What was asked

The operator's own report: *"Please can you update the format of the
font on the Invoice Line card, specifically the column headers for the
table of lines. I've noticed that the column headers are bold and
white. I would like the column headers to match the table font used in
the Tasks and Document Screens."*

---

## The investigation

`.linetable th` (`app.css`) set only `padding` — no `font-weight`,
`color`, or `font-size` of its own. Nothing else in the file targets
`.linetable th` either. Left unstyled, a `<th>` renders **bold** by the
browser's own default user-agent stylesheet, and its text colour is
whatever it inherits — here, `.panel`'s own `--text-primary`. At Night,
`--text-primary` is `#e8eef7` (`tokens.css`) — near-white. Bold and
white was never a rule anyone wrote; it was the default nobody
overrode, made visible by the dark theme.

The Tasks and Documents screens' own header style comes from `#shell
th`: `font-weight: 500`, `color: var(--text-secondary)`, `font-size:
var(--text-sm)`. A second rule, `.tablewrap th` (written for the
Documents table specifically, decision 0164), declares a *different*
`font-weight: 600` and `color: var(--text-muted)` — but both the Tasks
list and the Documents table render inside `#shell` (`document
.getElementById("shell")`, confirmed in `tasks.js` and `documents.js`),
and an id selector always outranks a class selector regardless of
source order. So `#shell th` wins for both screens, and
`.tablewrap th`'s own weight/colour have never actually applied to
anything — dead CSS, noted here rather than touched, since fixing it
was not asked for and risks changing a look the operator did not
report a problem with.

`.linetable` lives inside `#viewer`, a sibling `<main>` to `#shell`
(`index.html`), not a descendant of it — so `#shell th` was never in
scope to begin with, which is why the Lines table's headers were left
with nothing overriding the browser default at all.

---

## What was built

### `workers/vf-ui/public/app.css`

`.linetable th` gained the same three properties `#shell th` actually
renders with: `font-weight: 500`, `font-size: var(--text-sm)`,
`color: var(--text-secondary)`. Copied from the rule that genuinely
governs the Tasks/Documents header look today, not from `.tablewrap
th`'s own, overridden declaration. Text alignment and padding were left
alone — the operator's report was specifically about the font (bold,
white), not layout, and `.linetable th` already had its own padding
tuned for the table's tighter row height.

---

## Tests

CSS-only change; no new automated test (nothing in the suite asserts on
computed style). Full `vf-ui` browser suite re-run for a regression
check: **710/710 passing**, unchanged from before this change. `eslint`
does not lint CSS; `scripts/check-citations.py` clean.

---

## What is not built

**`.tablewrap th`'s own dead `font-weight`/`color` declarations** were
found but left as they are — real, but a different, unreported issue,
and correcting it risks a visual change to the Documents screen the
operator did not ask for.
