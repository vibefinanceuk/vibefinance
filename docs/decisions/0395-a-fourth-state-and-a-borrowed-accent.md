# 0395 — A fourth state, and a borrowed accent

**Status: built, not yet pushed.** First of four planned decisions,
this one adding tokens only — nothing in the app consumes them yet, so
nothing on screen changes.

---

## What was asked

The operator asked for a look at another product this team built,
e-invoicingcompliancecorner.com, to see what of its "boarding board"
visual language — bold condensed titles, an amber accent, an arrivals-
board tab treatment, and red/amber/green status colouring — might
carry over into vf-ui. A canvas of mockups (built and iterated with the
operator directly, outside this repository) narrowed a first full-theme
pass down to four specific pieces:

1. A bold condensed heading treatment for panel titles, in a single
   accent colour.
2. A full-width rule beneath every card title.
3. The Document/XML/Timeline & Chat tab row restyled as a segmented
   pill control, the shape of the reference site's own
   "Arrivals board / List view" toggle.
4. Red, amber and green on the validation screen's key fields and
   exceptions list — asked for directly: *"i also like the colouring
   of the red amber green fields in the arrivals board. that could be
   used to highlight exceptions in the validation screen."*

A fifth, explicit requirement ran across all four: *"i would like to
keep the day and night skins also across all pages also."* Every piece
had to work in both Day and Night time (decision 0139), not just Day.

Asked how best to build the four, the answer given and accepted:
tokens first, then the two genuinely global pieces (heading + rule)
together, then the tab row (narrow, independent), then the red/amber/
green severity work last — because that one is not simply a colour,
and needed a look at whether the underlying exception data already
carries a severity before promising a shape for it.

---

## What was built

Four tokens added to `tokens.css`, each with a Day value in `:root`
and, where the file's own existing convention calls for one, a Night
value in both of the file's two Night blocks (`@media
(prefers-color-scheme: dark)` and `:root[data-mood="night"]`, kept in
lockstep the same way every other paired token already is — decision
0139).

**`--heading-accent`** (`#854f0b` Day, `#f0c477` Night) — not a new
colour. These are `--text-warning`'s own two values, reused under a
name of their own rather than aliased with `var(--text-warning)`: a
heading and a warning are different concerns, and aliasing would have
let a future retuning of warning's own meaning silently retint every
panel title in the app. The reference site's raw `#c98a3a` was
measured against `--surface-2` and read under 3:1 in Day time — under
the app's own accessibility bar for large text. `--text-warning`'s
pair is already proven at 3:1 or better in both moods, since the app
ships it today.

**`--bg-danger` / `--text-danger`** (`#fbe4e1` / `#9c2b1f` Day,
`#3d140f` / `#f2a99a` Night) — a fourth semantic state, alongside the
existing accent/warning/success trio. `--bg-warning` has been carrying
two different claims on the validation screen: *look at this* and
*this is wrong*. A field that mismatches a linked purchase order is
not the same claim as one whose format merely could not be confirmed,
and colouring both amber meant a hard failure read no differently from
a note to double-check. Danger is the *stop* tier; warning keeps
*look at this*.

**`--border-danger`** (`#d64a36`) — Day only, not redefined in either
Night block. This follows the file's own existing choice for
`--border-warning` and `--border-success`, neither of which gets a
Night value either: a single value doing double duty in both moods. A
border is a thin line, not a fill or a body of text, and this file has
not so far treated borders as contrast-critical the way `--bg-*`/
`--text-*` pairs are.

---

## Tests

`test-browser/mood.test.ts`'s existing "says the same thing twice, and
they agree" test — the one that stops the file's two Night blocks
drifting apart — had its token list extended to cover
`--heading-accent`, `--bg-danger` and `--text-danger` (not
`--border-danger`, matching its own exclusion of `--border-warning`/
`--border-success`). Two new tests: that danger gets its own colours
in both moods rather than copying warning's, and that the heading
accent is `--text-warning`'s proven pair rather than the reference
site's raw, under-contrast orange.

Watched to fail first: `tokens.css` stashed, tests kept, run against
the pre-change file — 2 of 14 failed, exactly the two new assertions
(the duplication-check test passed vacuously, since neither Night
block had the new tokens yet to disagree about). Restored, reran,
14/14 passing.

Full suites: vf-ui 74 Worker + 686 browser (684 pre-existing + 2 new),
both passing. The browser run's pre-existing `document-window.test.ts`
stub-fetch error noise (unhandled rejections after its own tests
complete) was confirmed present on `origin/main` before this change
too — not introduced here. `eslint` clean. `scripts/check-
citations.py` does not scan `.css` files (its own `SUFFIXES` list is
`.ts`, `.js`, `.sql`, `.md`, `.py`), so the citations inside
`tokens.css` itself are not what it checks; this record exists so the
one citation it does scan, in `mood.test.ts`, resolves.

Touches `vf-ui` (`public/tokens.css`, `test-browser/mood.test.ts`)
only — no change to `vf-app`, `vf-admin` or `vf-licence`.

---

## What is not built

Nothing consumes any of these four tokens yet. No panel title uses
`--heading-accent`, no card has a rule beneath its title, the Document
tab row is unchanged, and no field or exception list uses
`--bg-danger`/`--text-danger`/`--border-danger`. Those are the next
three decisions in the sequence agreed with the operator — the two
global pieces (heading + rule) together first, since they touch every
screen and need the widest visual regression check; then the tab row,
narrow and independent; then the red/amber/green severity work, which
still needs an answer to whether "mismatch" and "needs review" already
exist as separate claims anywhere upstream of the validation screen,
or whether that distinction has to be added there first.

No dot/indicator token was added for the small coloured markers the
mockups used beside each field label — those can reuse
`--border-danger`/`--border-warning`/`--border-success` directly when
that piece is built; a dedicated `--dot-*` set was judged premature
before a real screen shows it is needed.
