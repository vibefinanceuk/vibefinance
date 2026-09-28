# 0543 — GL codes allowed per cost centre, and the invoice's project reference as a suggestion

**Status: built and tested locally, not yet pushed or deployed.** This
session has no push access, so it is delivered as a git bundle, together
with 0542. It touches `vf-app`, `vf-ui`, `vf-licence` and `shared`
(vocabulary and the UBL parser), and needs **`vf-app` migration `0100`
(apply before deploying `vf-app`) and `vf-licence` migration `0198`**.

## What was asked

The second item from the coding discussion: "linking GL codes to cost
centres" (can this department incur this type of expense?) and "using
the project reference printed on the invoice as a suggestion". For the
links the operator chose **only where links exist**: a cost centre with
none accepts any GL code.

## What was decided

- **GL codes per cost centre.** A new many-to-many table,
  `cost_centre_gl_codes` (migration `0100`). The existing link mechanism
  holds one value per list type per entry, and one GL code is used by
  many cost centres, so it couldn't carry this.
  - **AP Setup**: the Cost Centre form has a "GL codes" list (choose
    several); the list shows them, or "Any" when there are none. Saved as
    `glCodes` on `PUT /cost-centres/:id`; an empty list removes every
    link.
  - **The Coding pop-out** narrows the GL code search by the line's cost
    centre, where it has links (`filter.cost_centre`), alongside company
    and commodity.
  - **Saving** a GL code the line's cost centre isn't linked to is
    refused (`wrong_cost_centre`, "is not allowed for the line's cost
    centre"), and the GL code is re-checked when only the cost centre
    changes. A line whose GL code stops being allowed once links are
    added is flagged (0511). A project-coded line has no cost centre, so
    it is unaffected.
- **The invoice's project reference (BT-11).**
  - The UBL parser now reads `cac:ProjectReference/cbc:ID` as BT-11, a
    new vocabulary field ("Project reference", read-only by default).
    Only UBL is parsed here; a CII invoice's project isn't read yet.
  - **Suggestions**: when BT-11 matches an active project, by id or by
    name and ignoring case, that project is suggested for every line that
    can be coded, even with no supplier history. Anything else history
    suggests (commodity, GL code) is kept; under the either/or rule
    (0540) the named project replaces a suggested cost centre. The
    pop-out says "The invoice names project “PRJ-…”: Leeds fit-out", with
    no confidence meter. A closed or unknown project is never suggested.
    It is still only a suggestion: nothing is filled until Accept all.

## Not built / worth knowing

- No bulk import of GL links (CSV); they are set per cost centre.
- From the discussion, still to come: the supplier "needs a project"
  setting (the operator chose "required at Complete") and split coding.

## Verification

- **`vf-app`**:
  - `gl-cost-centre-links.test.ts` (7): links set, listed and emptied;
    an unknown GL code or a non-list refused; search narrowed for a
    linked cost centre and open for one without; a save refused for a GL
    code not allowed, accepted for one allowed or with an unlinked cost
    centre; re-checked when only the cost centre changes; flagged once
    links are added.
  - `coding-suggestions.test.ts` (3): the named project by id and by
    name, even with no supplier; kept history plus the named project,
    with the cost centre replaced; closed or unknown projects never
    suggested.
  With the previous `coding-validation.ts`, `coding-list-route.ts`,
  `ledger-route.ts`, `key-fields-route.ts` and `coding-suggestions.ts`,
  9 of these 10 **failed**. The one that passed checks that a closed
  project is never suggested, which the old code also did because it
  never read BT-11.
- **`shared`**: `ubl-parser.test.ts` reads BT-11 from
  `cac:ProjectReference` and leaves it absent otherwise. `shared` 296/299;
  the same 3 fail on untouched code.
- **`vf-ui`**: `coding-lists.test.ts` (GL codes shown as a list or "Any",
  and saved); `viewer.test.ts` (the GL search carries
  `filter.cost_centre`; the invoice-reference wording without a meter).
  All 3 **failed** with the previous files. Two older cost centre form
  tests now wait for the form, which fetches the GL codes before it
  opens, and one expects `glCodes: []` in its request.
- Strings: `vf-licence` 0197 (14 rows) and 0198 (12, including the
  `field.bt-11` label the coverage test requires) checked on a replay.
  Migrations: `vf-app` replay 100, all assertions held.
- Browser 1277/1278 (the known `typography.test.ts` 10px gap). Worker
  75/75. `vf-licence` 320/320.
- **`vf-app`**, a full, unfiltered run for 0542 and 0543 together:
  131 files and 3163 tests, of which **3161 passed**. The two failures are the ones already known on untouched `origin/main` (0511).
- Day and Night screenshots of the Coding pop-out with an over-budget
  project checked by eye.
