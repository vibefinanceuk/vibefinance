# 0345 — A Real Line Between Properties and Limits

**Status: built.** "Please can you place a horizontal line between
the Budget Holder, and Approval limit fields."

---

## The fix

A genuine `<hr>` between `propertiesForm` and `limitsSection` in
`openPersonPropertiesForm` — Budget Holder is the last field in the
properties grid; Approval limits is the first line of the section
after it. Styled with the same border colour (`var(--border)`) this
app already uses everywhere else a line divides one section from
another, rather than a new colour invented for this one spot.

## What has coverage

A real, structural test, not a visual one this project's own browser
suite could never verify — unlike decisions 0341, 0343, and 0344, all
of them pure CSS layout JSDOM cannot compute, this is a genuine DOM
ordering question JSDOM answers correctly: the divider element itself
exists, and sits after the properties grid and before the limits
section, not merely present somewhere in the popout. Probed directly:
removing the divider failed exactly this test.

`vf-app`: unchanged. `vf-ui`: 63 Worker (unchanged), 501 browser (was
500).
