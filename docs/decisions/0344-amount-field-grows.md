# 0344 — The Amount Field Grows, So Set Lands at the Right Edge

**Status: built.** "Much better, however, you can now widen the
amount field so that the set button is aligned with the right end of
the fields above" — reported live, with a real screenshot, as the
one remaining piece of decision 0343's own fix.

---

## The gap

Decision 0343 fixed the currency field growing too wide by giving it
its own fixed width. The amount field beside it already had a fixed
width of its own (decision 0341). With both fixed, neither this row's
two fields nor its own "Set" button (which has never had a `flex`
rule at all, just its own natural width) carried any `flex-grow` —
nothing in the row claimed the leftover space once both fields took
their own fixed share. A flex container does not distribute unclaimed
space on its own; it sits empty after the last element, which is
exactly why Set landed short of where the fields above it end.

## The fix

`flex: 1` on the amount field — the same "grow to fill" decision 0341
first gave the currency field, before decision 0343 corrected it
there specifically because the currency field's own neighbor (the
amount field) had nothing to grow into space for it. Here, with the
currency field now fixed and nothing else in the row competing, the
amount field growing is the right call rather than a repeat of the
same mistake: exactly one element in the row should claim the
leftover width, and this is the one built to hold whatever length of
number a person types into it, not a fixed vocabulary the way the
currency field's own options are.

## What has coverage

None added. The same limitation named in decisions 0341 and 0343:
JSDOM does not compute real CSS layout, so no automated test here
could verify what the screenshot verified directly. Every existing
test still passes unchanged, confirming this was purely a visual fix
with no behavior to break.

`vf-app`: unchanged. `vf-ui`: 63 Worker (unchanged), 500 browser
(unchanged) — CSS only.
