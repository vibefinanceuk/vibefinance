# 0547 — A supplier site can be project-only expenditure

**Status: built and tested locally, not yet pushed or deployed.** This
session has no push access, so it is delivered as a git bundle. It
touches `vf-app`, `vf-ui`, `vf-licence` and `shared` (vocabulary), and
needs **`vf-app` migration `0101` (apply before deploying `vf-app`) and
`vf-licence` migration `0202`**.

## What was asked

From the coding discussion: a supplier "needs a project" setting. The
operator chose **required at Complete**, agreed the design (a tick on
the supplier, the Coding pop-out opening on Project), and summed it up
as "a supplier level flag deciding whether the supplier site is project
only expenditure". Each supplier record here is one ERP supplier site,
so the setting is per site: two sites of one supplier can differ.

## What was decided

- **Storage.** `suppliers.project_only` (migration `0101`, off for
  every existing site). It is VibeFinance's own setting, not the ERP's:
  the supplier load names every column it writes, so a reload leaves
  it as set. Changes are recorded in the supplier field history (0427).
- **Suppliers screen.** A "Project-only expenditure" tick in the site's
  pop-out, with a note saying a load leaves it alone. Saved through
  `PUT /suppliers/:id` as `projectOnly`. If only the tick changed, the
  "the ERP is the master" warning is not shown, since nothing the next
  load overwrites was touched. The list shows "Project only" in the
  Purpose column, beside Pay and Procurement.
- **Read live.** `supplierProjectOnly` reads the attached supplier's
  setting now, not as it was when the invoice was captured (the same
  choice 0422 made for a supplier's hold).
- **Complete at a coding stage** (`codingGapsForTask`), under "one or
  the other" (0540) and where the stage lets a person set the project:
  every coded line needs a project (`project_required`, "Project · is
  required: this supplier's spend is project-only"), and a line holding
  a cost centre is told to use a project instead (`project_only`). The
  project is still checked against its list (0511). Saving is never
  refused. Under "both allowed" the project is already required
  wherever it is editable (0513), and a cost centre stays optional.
- **The Coding pop-out**, under "one or the other": the card shows
  Project alone, with no Cost centre | Project switch, and says "This
  supplier's spend is project-only: code the line to a project." A cost
  centre the line already holds (the supplier's own BT-133, say) is
  named: "Choosing a project removes cost centre CC-410." Project is
  focused on open. The line's Coding button only turns green once it
  has a project and no cost centre.
- **Suggestions.** For these sites, only earlier lines that carried a
  project are examples to follow, and a cost centre is never suggested.
  The invoice's own project reference (0543) still wins.
- **For rules.** `supplier.projectOnly` (boolean), merged live wherever
  the PO facts are; absent when no supplier is attached.

## Not built / worth knowing

- No bulk setting (for example a column in the supplier load file);
  it is set per site on the Suppliers screen.
- The pop-out names a held cost centre by its id, not its name.
- Split coding, the last item from the coding discussion, is still to
  come (mock-up first).

## Verification

- **`vf-app`**:
  - `index.test.ts` (2): through the router, a project-only site's line
    needs a project by name, a cost centre is refused alongside it, a
    mistyped project is still `not_on_list`, then it completes; with the
    setting off, a cost centre alone completes.
  - `load-suppliers.test.ts`: set, recorded in the field history, listed,
    kept through a reload that rewrote the name, and a non-boolean refused.
  - `coding-suggestions.test.ts`: only project-carrying history, and no
    cost centre suggested.
  - `supplier-project-only.test.ts` (3): `supplier.projectOnly` read live;
    absent with no supplier; `supplierProjectOnly` on `GET /invoices/:id`.
- **`vf-ui`**: `viewer.test.ts` (4): Project alone with no switch and a
  note, focused on open; a held cost centre named, and choosing a
  project removes it; the green cue refused with a cost centre alone and
  given with a project. `suppliers.test.ts` (3): the list's "Project
  only"; the tick saved on its own without the ERP warning; sent with the
  details when they change.
- With the previous production files, 11 of the 14 new tests **failed**.
  The 3 that passed check behaviour that should not change (the setting
  off, no supplier attached, a project-coded line's green cue).
- Migrations: `vf-app` replay 101, all assertions held; `vf-licence`
  0202's assertion (14 rows) checked on a replay.
- Browser 1287/1288 (the known `typography.test.ts` 10px gap). Worker
  75/75. `vf-licence` 322/322. `shared` 298/301, the 3 known failures.
- **`vf-app`**, a full, unfiltered run: 132 files and 3184 tests, of
  which **3182 passed**. The two failures are the ones already known on
  untouched `origin/main` (0511).
- Day and Night screenshots of the pop-out for a project-only site
  holding a cost centre checked by eye.
