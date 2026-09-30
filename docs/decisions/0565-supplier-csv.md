# 0565: Routes phase 2, slice 3 (first part): a supplier's own CSV

**Status: built and tested locally, not yet pushed or deployed.** It
touches `shared`, `vf-app`, `vf-ui` and `vf-licence`, and needs
**`vf-licence` migration `0216`**. There is no `vf-app` migration.

## What was asked

Slice 3 of phase 2 has three parts: plain-language rules for the whole
document, supplier CSV, and look-ups in the customer's own lists. On 30
September Dan chose to build **supplier CSV first**. Before that, he had
confirmed the supplier XML flow works end to end in the live app:

- 88240 was read after its mapping was published and it was reprocessed;
- 88241 was read automatically;
- 88242 failed on its date, as intended.

## What was decided

### A CSV is read as a small XML document (`shared/ingestion/supplier-csv.ts`)

A CSV becomes

```xml
<CSV>
  <First><Rechnungsnr>88250</Rechnungsnr>...</First>   the first row
  <Row><Rechnungsnr>88250</Rechnungsnr>...</Row>       every row
</CSV>
```

so the mapping engine, the editor, functions, Try, Publish, Reprocess and
the EN 16931 checks all work on it unchanged:

- a whole-invoice term reads a column from `CSV/First`;
- a line term reads a column from `CSV/Row`, where the lines repeat.

Nothing new had to be taught to the engine except one rule, below.

**Reading the file:**

- **Quotes:** quoted cells, doubled quotes, and separators or line breaks
  inside quotes are all read correctly.
- **Separator:** `;`, `,`, tab or `|`, guessed as the one that splits the
  first rows into the same number of columns, more than one.
- **Column names:** the first row is taken to hold them when none of its
  cells looks like a number or date and all are different.
- **Lines to skip:** a title or blank lines at the top can be skipped.
- **Encoding:** UTF-8, or Windows-1252 as Excel saves "CSV" on a German or
  British Windows machine. A BOM is dropped.
- **Column names as elements:** each name is made safe as an element
  (`Menge (Stk)` becomes `Menge_Stk`), and duplicates are numbered. The
  editor still shows the name as written.
- **Empty cells:** an empty cell is left out, so a term mapped from it is
  missing, as an empty XML element is.

The separator, whether there are column names, and the lines to skip are
stored in the mapping's definition as `csv`, so they are versioned with
it. A CSV mapping's root is `CSV`, and only a CSV mapping may carry
`csv` (`validateMapping`).

### A whole-invoice amount drawn from the lines is their sum

A supplier's CSV carries amounts on every row and often no totals. So in
`applyMapping`, a whole-invoice term of kind *number* whose source is
inside the lines is their **sum**. For example, BT-106 from `CSV/Row/Netto`
is the Netto column added up:

- Each row's value goes through the line's functions first (a decimal
  comma, say).
- The rows are then added, and the sum is rounded to the most decimals any
  row had, so 91.20 + 4.75 is 95.95.
- A row it cannot read is a problem on that row.

This holds for XML too. The editor now accepts a line element for a
whole-invoice amount, and says so in the detail panel ("every line's
value is read, then added up"). A whole-invoice text or date term still
needs an element outside the lines.

### One invoice per file

A CSV whose invoice number (the column BT-1 is mapped from) differs
between rows holds several invoices. It is refused, naming them, for
example: `lagernord.de CSV v1: the file holds 2 invoices (88250,
88252); one invoice per file is read`. Reading them as one would make an
invoice nobody sent.

### Intake

**Attachments.** A CSV attachment is accepted as:

- `text/csv`, `application/csv` or `text/comma-separated-values`;
- `application/vnd.ms-excel` (how Outlook labels a `.csv`), `text/plain`
  or `application/octet-stream`, but only with a `.csv` file name.

A CSV is text, so besides base64 it is also accepted quoted-printable,
or as it is.

**Detection** tries CSV last (`structured_csv`), as the loosest test:

- the file is text, not XML or PDF;
- it has at least two rows that one separator splits into the same number
  of columns.

The test is recorded in `attempted` only when it matches, so an
undetected document's attempts read as they always have.

**Channel.** A CSV is read on the process's structured-data channel,
`structured_xml` (`channelStructure`). `intake_channels` keeps its three
structures, with no table rebuild.

**Capture** goes through `captureThroughMapping`, as a supplier's XML
does:

- The part records `format = supplier_csv` and `xml_root = CSV`.
- The facts carry `intake.format = supplier_csv`.
- Near misses (0563) name the CSV mapping, for example "reads CSV files on
  this route, but is not for …".

**Choosing a mapping.** Every CSV has the same root. Where one sender has
several live CSV mappings, the one whose columns are all in the file comes
first.

**Storage.** The original is kept as `text/csv`, and a **table rendering**
(`csv-render.ts`) is stored beside it as the `generated_rendering`, as
0205 does for XML. The viewer then shows the rows, not a download. The
rendering shows at most 500 rows.

### The editor, the monitor and Routes

**Mapping editor:**

- The heading reads "CSV file → EN 16931 invoice".
- The left column shows **First row · the whole invoice** and **Every row
  · each line**, with each column's name as written in the file.
- The Mapping card shows **Separator**, **Column names** ("The first row
  holds them") and **Skip at the top**, in place of Lines repeat at. A
  change saves the draft and reads the sample again, so the columns follow
  it.
- Stored words hold no `;` (0013), so the separator names are words, and
  the interface adds the character.

**Route monitor:**

- A failed CSV is shown as "A supplier's CSV", with its own explanation
  ("no mapping reads it yet", or "its mapping could not read it", which
  covers a missing column and several invoices) and **Map this format**.

**Routes:**

- The Receiving formats panel has a *A supplier's CSV* row.
- The Supplier mappings panel shows a CSV mapping as a CSV.

**Help:** the mapping editor's help gains *A supplier's CSV*. The Routes
help and the Route monitor's heading mention CSV. All of it is in English
and German: 31 keys in `vf-licence` `0216`, and 2 updated.

## Not built

- **Several invoices in one file**, grouped by invoice number. Each is
  refused in words for now. Grouping means one attachment making several
  invoices, which the message part does not yet carry.
- **Excel files (`.xlsx`).** Only CSV.
- **Units the function does not know.** For example, `Rolle` is refused
  by "unit of measure", as before. A look-up in the customer's own lists
  (the third part of slice 3) is the place for such words.
- **Plain-language document rules** and **look-ups**, the rest of slice 3.

## Verification

- **`shared`**: `supplier-csv.test.ts`, 14 tests. They cover:
  - parsing (quotes, separators and line breaks inside quotes, blank lines);
  - guessing the separator and column names;
  - UTF-8 and Windows-1252;
  - telling a CSV from XML, a PDF, binary and a single line;
  - element names, including odd, empty, duplicate and `xml…` names;
  - skipping lines;
  - refusals in words;
  - counting invoices;
  - the engine on a CSV: described groups, a single row's line group, the
    facts, lines and totals added up passing EN 16931, an empty cell, a
    row's amount it cannot read, and `csv` options only on a CSV mapping.

  The whole package: 359 pass. The three failures existed before this
  change.
- **`vf-app`** `supplier-mappings.test.ts`, 7 new tests. They cover:
  - a CSV failing as one no mapping reads;
  - Outlook's labelling with quoted-printable, bytes, and Windows-1252
    (a `.txt` is not taken);
  - drawing a mapping with the separator and column names guessed, bad
    options refused, and changed ones read with;
  - publish, reprocess, amounts added up, the table rendering beside the
    original, and the next CSV read directly;
  - two invoices refused;
  - the near miss for another sender;
  - of two CSV mappings for one sender, the one whose columns fit.

  `detect-structure.test.ts` has 2 new tests. All 9 fail against the code
  before this change. Full, unfiltered run: 141 files and 3306 tests, of
  which **3304 passed**. The two failures are the ones already known
  (0511).
- **`vf-ui`**: `mapping-editor.test.ts` has 4 new tests using the real
  strings. They cover:
  - the columns by name, and the two groups;
  - the CSV options saving and reloading;
  - a whole-invoice amount from the rows, with the note, while a text term
    is still refused;
  - the monitor for a failed CSV.

  `routes.test.ts` gains the new format row. All 5 fail against the
  interface before this change. Full browser suite: 1363 of 1364 pass. The
  one failure is the known `typography.test.ts` 10px gap. Worker tests: 75
  of 75.
- **`vf-licence`**: 322 of 322 pass, with `0216` loaded and its keys
  covered. The first run failed on a `;` in stored words: it splits a
  statement, and the separators' names and two help lines had one.
- **Migrations**: `vf-licence` replays 216. `vf-app` is unchanged at 112.
- **Sample files** for Dan, checked against the engine:
  - `Rechnung_88250.csv` (UTF-8) reads cleanly and passes EN 16931;
  - `Rechnung_88251.csv` (Windows-1252) also reads cleanly and passes;
  - `Rechnungen_88252_88253.csv` holds two invoices, and is refused.
- **Screenshot** of the editor on a CSV mapping, checked by eye: column
  names, the two groups, BT-106 drawn from the Netto column with its note,
  and the CSV options on the Mapping card.
