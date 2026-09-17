# 0379 — Parent Org and Tax Identifier in the Org Units table, and a clearer label

**Status: built.** Two small, related requests on the Access screen's
Org Units tab: rename the recorded title "VAT ID" to read "Tax
Identifier," and show Parent Org and Tax Identifier as real columns in
the table itself, not only inside the edit form.

---

## Both fields already existed — this is the table catching up to the form

`openUnitForm()` has read `existingUnit.parentUnitId` and
`existingUnit.vatId` since decision 0335 first built org unit
management. `unitRow()`, the table's own row renderer, never showed
either — a person had to open a unit to learn who its parent was or
whether it carried a tax identifier at all. No backend change was
needed: `/api/org/overview` already returns both fields on every unit,
since the same `units` array feeds both the table and the form that
opens on a row's own click.

**The parent's own name, not its raw id.** A table showing `u1` beside
a child unit would tell a person less than the id already not telling
them anything — `unitRow()` now looks the parent up by id against the
same module-level `units` array `unitDepth()` already walks one link
at a time for indentation, and shows a dash for a unit with no parent
at all, the same "a real absence, not a blank cell" treatment this
table already gives everything else.

---

## The rename

`roles.vatid` is now "Tax Identifier" (English) and "Steuerliche
Identifikationsnummer" (German, in place of "USt-IdNr.," which named
the EU-specific VAT number rather than the more general concept the
new English wording asks for). One key, one meaning, read from both
places it always was: the edit form's own label and, now, the table's
new column header — never two names for the same field drifting apart
the way decision 0236 already warned against.

A new migration (`0119`) updates the existing key's own value rather
than editing migration `0102` in place, which is already applied.

---

## Tests

`access.test.ts` — 5 new tests: both new column headers present, a
child unit's own row showing its parent's real name rather than a raw
id, a top-level unit showing a dash in both new columns, a unit's own
tax identifier appearing when one is on file, and the edit form's own
label reading "Tax Identifier" rather than the old "VAT ID." One
existing test's own fixture string was updated to match.

vf-app: unchanged — no backend change was needed. vf-ui: 72 worker
tests (unchanged), 626 browser tests (was 621). vf-licence: 320 tests,
unchanged — migration `0119` updates an existing value, adding nothing
new to assert on.
