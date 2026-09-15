# 0346 — The Side Nav, Grouped Under Headings

**Status: built.** "On the side menu I wondered if you could arrange
the links, perhaps under headings: Account Payable - Dashboard, Tasks
/ Documents Supplier Management - Suppliers / Configuration - Access,
Sources, Rules." Confirmed against a mockup first — "yes, this is
what I had in mind" — then built for real, and confirmed live that
permission gating already worked the way expected before writing any
of it.

---

## Real history, checked before building

This is not the first time the nav's own shape was reconsidered.
Decision 0274 built a single, collapsible "Vibe AP" folder — folder
icon, an expand/collapse chevron, indented children — wrapping five
of the app's six screens. Decision 0276 reverted it at the same
operator's own explicit request: *"the sub menu... looks bad... no
sub menu exists and the menu items beneath it are always displayed."*

What is built here is structurally different in the ways that
mattered to that reversal, not a quiet repeat of it: three parallel,
always-static headings rather than one collapsible folder; nothing to
expand or collapse; no indentation implying a hierarchy; every link
still exactly as always displayed as it was before. This is, in fact,
what decision 0276 itself asked to keep — flat, always-visible items
— with organisational labels added above them rather than a
navigation structure changed underneath them. Surfaced to the operator
directly before building, given the history, rather than assumed to
be obviously fine.

## The structure

`NAV_GROUPS` replaces the flat `SCREENS` array — three groups, each
naming its own heading key and the screens beneath it, in the exact
order given live: Accounts payable (Dashboard, Tasks, Documents),
Supplier management (Suppliers), Configuration (Access, Sources,
Rules).

**A heading with nothing unlocked beneath it is never shown.**
Confirmed directly before building, not assumed: every nav link was
already filtered out of the array entirely when its own required
permission was missing, not merely hidden — `unlocked(screen)`
already existed and already worked this way. Grouping surfaces a real
new case that never existed before: "Supplier management" holds
exactly one screen, gated to `AP.Supplier`. Rendering its heading
unconditionally would show an orphaned label over an empty gap for
anyone lacking that one permission. Each group's own screens are
filtered first; the heading itself is only added to the nav when at
least one of them survives that filter.

**Hidden entirely in the collapsed, icons-only nav** — the same
treatment `.navlabel` already gets there, since there is no room for
a text heading once the nav is folded to icons alone.

## What has coverage

The grouped order and every heading's own text, confirmed directly.
The empty-heading case named above, with its own dedicated test —
probed directly by removing the suppression, which correctly failed
exactly that test. Every existing test whose own expectations assumed
the old, flat order — in both `tasks.test.ts` and `rules.test.ts` —
updated to the new, grouped order rather than left to quietly drift
out of sync with what the nav now actually shows.

**A real, caught mistake, not silently worked around:** the new
`.navgroup` heading's own font size was first written as a hardcoded
`11px`, which failed this project's own standing test that no
stylesheet may hardcode a `font-size` outside its four defined steps
(`--text-sm/base/lg/xl`). Fixed by using `--text-sm` (12px, "labels,
captions, secondary detail" — exactly the role this heading plays)
rather than adding a fifth step or overriding the test.

`vf-app`: unchanged (frontend-only). `vf-ui`: 63 Worker (unchanged),
502 browser (was 500 before this decision — one old test replaced by
two new ones, net one test added).
