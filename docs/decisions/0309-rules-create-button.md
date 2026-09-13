# 0309 — Create rule, top right

**Status: built.**

---

## What was asked

> On the Rules page, there is a create rule button beneath the table
> of rules. Please can you move this button to the top right of the
> page, to the left of the Night / Day button (with the horizontal
> line as a break).

## What was built

Same mechanism decisions 0298, 0303, and 0305 already used: passed
into `topbar()`'s own `right` array, which renders before
`moodPicker`, landing left of Night/Day — and decision 0304's own
boundary line appears automatically, since `right` is no longer empty
for this screen.

**Rebuilt as `.actionlink`, not moved verbatim.** The button's old
home, a footer row beneath the rules table, could afford a standalone
`<button class="primary">` with icon and label side by side; a
compact row of topbar controls cannot — rebuilt in the shape every
other topbar button already uses, icon above label, same `compile`
icon and `rules.new` string ("Create rule") as before.

**Decision 0154's own reasoning is unchanged, not revisited.** Writing
the first rule at a stage creates the rule set, so the button was
never conditional on a stage already having one — true before this
move and, if anything, more obviously true now: present in the
topbar regardless of which stage is even selected, rather than folded
into one panel among several.

**The old `.newrule` CSS, genuinely dead, removed rather than left
behind.** `.newrule button svg` shared a combined selector with
`.composebar button svg` (compose.js's own worked-example bar, still
live); only the `.newrule` half of that selector was removed, and
`.newrule { margin-top: 16px; }` — with no more markup left to select
— dropped entirely.

## What has coverage

Decision 0154's own two tests already checked the button exists
regardless of whether a stage has rules, via an unscoped
`document.querySelectorAll("button")` — both kept passing through this
move without needing an edit, since neither ever checked position. A
new, dedicated test does: confirms Create rule sits inside `.topbar
.right`, ahead of whichever mood button is showing, with decision
0304's own divider present, and that nothing remains at the old
`.newrule` location. Probed directly — removing the button from the
topbar fails exactly this test.

vf-ui: 49 Worker, 396 browser (was 395). No migration.
