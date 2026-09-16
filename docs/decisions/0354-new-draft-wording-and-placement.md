# 0354 — "New draft," and Both Buttons in the Card's Own Head

**Status: built.** Reported live, two small corrections on decision
0353's own screen: *"rather than 'Start Draft', could you reword to
read 'New draft'? Also, please could the New Draft and Add stage
button be moved in to the card above, to be consistent with other
screens."*

---

## The wording

`action.startdraft`'s own displayed value, "Start draft," becomes
"New draft" — matching "New process" on the same screen, and "New
person," "New org," and every other `action.new*` label already used
elsewhere in this app. The string's own key stays exactly what it
was: this codebase's own established precedent (decision 0039's own
"Write a new rule" → "Create rule," same key, `rules.new`, both
times) is that a key is a stable, internal identifier, not required
to match whatever text it currently displays.

**A new migration, not an edit to the one decision 0353 already
shipped.** `0108_start_draft_strings.sql` was already applied to the
live database by the time this was reported; editing it in place
would silently rewrite what an already-applied migration says it did.
`0109_new_draft_wording.sql` restates the value with a plain `UPDATE`,
the same shape decision 0039's own wording change already used.

## The placement

"New draft" and "Add stage" move into the same `.cardhead` the panel's
own heading already sits in — the shape `processListPanel`'s own "New
process" button, and the draft panel's own Add stage/Publish/Discard
row, both already use. Before this, the two buttons sat in a second,
separate row beneath the panel — the one place on this screen that
had not yet matched that pattern, now brought into line with it.

## What has coverage

A new test confirms the actual, structural claim directly — both
buttons genuinely sit inside the same `.cardhead` element the panel's
own heading is in, not merely present somewhere on the page — probed
by reverting to the old, separate-row layout and confirming that
exact test fails. Every existing test referencing the old "Start
draft" text was updated to "New draft" rather than left to pass on
stale wording by coincidence.

`vf-ui`: 69 Worker (unchanged), 534 browser (was 533). `vf-app`
untouched — this was a wording and layout change only, no backend
route or schema involved. `vf-licence`: 320 (unchanged in count; the
new migration restates a value, adding no new row).
