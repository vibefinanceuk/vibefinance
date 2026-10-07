# 0665: Suppliers — Load CSV, a CSV Template, and the last load inside the card

**Status: built and tested locally, not yet pushed or deployed.** It
touches `vf-app` (one route), `vf-ui` and `vf-licence`. It needs
**vf-licence migration `0303`** (strings) and no vf-app migration.
Deploy vf-licence, vf-app and vf-ui.

## What was asked

Dan, 7 October 2026:

> In the Suppliers screen, please could you update to the small icon and
> wording for the Load and New Supplier buttons. Please rename the Load
> button to 'Load CSV'. Please can we also provide a CSV Template button
> / icon, to download the supplier CSV template.

And while it was being built:

> Where it says "Loaded 25 days ago." above the Load a supplier file
> card - please can you move this inside of the Load a supplier file
> card, under the Choose file section. The text should read "Last
> supplier load occurred 25 days ago."

## What was built

### The card's actions (vf-ui `suppliers.js`)

The *Load a supplier file* card's head now holds **CSV Template**,
**Load CSV** and **New supplier**. All three are `compactLink`s (0662):
a 16px icon with its word, in the softer colour that brightens on hover
(0664).

- **Load CSV** is renamed from *Load* (`suppliers.loadcsv`), keeps its
  icon, and is still the primary.
- **A failed load no longer wipes the button.** It used to set
  `textContent` back to the label, which threw the icon away.

### CSV Template

**vf-app: `GET /suppliers/csv-template`** (Admin.Configure, as loading
is) answers `suppliers-template.csv`, which is a header row only.

- **The columns come from the load's own list.** `supplierTemplateCsv`
  takes them from `COLUMNS` in `load-suppliers.ts`, one per thing a load
  reads, under the first name the list gives it, so the template and the
  load cannot drift apart.
- **The order:** `erp_identifier` comes first, as the one required
  column. Then name, VAT, electronic address, country, terms, hold,
  matching and tolerances, discount, payment means, site, `org_unit`,
  what the site is for, address, email and phone.
- **There is no example row**, so loading the template unchanged
  creates nothing.

**vf-ui:** **CSV Template** (`download` icon) fetches the file and saves
it. It says so if it cannot.

### The last load, inside the card

- **The wording:** "Last supplier load occurred 25 days ago."
  (`suppliers.lastload`).
- **The place:** it moved from above the cards to inside *Load a
  supplier file*, under the file picker.
- **Unchanged:** it still turns amber after 30 days, and still says how
  many rows were refused. "No supplier file has ever been loaded" now
  sits in the same place.

### Words (vf-licence `0303`)

Four keys, in English and German: Load CSV, CSV Template, a failed
template download, and the last-load line.

## Verification

- **`vf-app`** `load-suppliers.test.ts` gains 2 tests:
  - **The template's columns:** `erp_identifier` comes first, with no
    column named twice, and they include name, VAT, country, terms,
    match option, org unit, pay site, email and phone.
  - **Filled in, it loads back:** the template's own header with one
    row is loaded, and the supplier is there.
  - **Who may download it:** Admin.Configure gets a `text/csv`
    attachment named `suppliers-template.csv` beginning
    `erp_identifier,`. AP.Supplier gets 403.
- **`vf-ui`** browser `suppliers.test.ts` gains 2 tests, and three
  existing ones now look for *Load CSV*:
  - CSV Template, Load CSV and New supplier are compact, each beginning
    with its icon, and CSV Template downloads `suppliers-template.csv`;
  - "Last supplier load occurred 25 days ago." sits inside the load
    card, after the file picker.
- **Screenshots** of the Suppliers screen in Day and Night.
- **Full runs**:
  - vf-app 3693, of which 3690 pass: the two known failures, plus the
    `index.test.ts` timeout under load (0657);
  - vf-ui browser 1615, of which 1614 pass (the known
    `typography.test.ts` 10px gap);
  - vf-ui worker 111 of 111;
  - vf-licence 362 of 362;
  - vf-licence migrations replay to 303.
