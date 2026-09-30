# 0568: Routes phase 2, slice 3: look-up lists, and the reason's capital letter

**Status: built and tested locally, not yet pushed or deployed.** It
touches `shared`, `vf-app`, `vf-ui` and `vf-licence`, and needs two
migrations:

- **`vf-app` `0113`**, applied before deploying `vf-app`;
- **`vf-licence` `0218`**.

## What was asked

After supplier CSV (0565), Dan chose **look-ups** next in slice 3:

- for **units** and **a supplier's codes**, first;
- with the lists **shared**: kept once on the Routes screen, and usable by
  any mapping.

The gap that led here was found with `Rechnung_88251.csv`: the unit
function did not know "Rolle".

He also asked for the reason on a failed file's card to start with a
capital letter, as in "…version 2: The file holds 2 invoices (88252,
88253). One invoice per file is read."

## What was decided

### Lists (`vf-app` `0113`, `lookup-lists-route.ts`)

A list has a name and two columns:

- **From**: the value as the supplier writes it;
- **To**: what it becomes.

A value is found whatever its case or surrounding spaces. Each entry
stores `key` (trimmed, lower case) beside `from_value` as it was typed.
Only one active list may have a given name.

**Saving.** The whole list is saved at once, as a table is edited. D1 runs
the batch as one transaction, so the list is replaced whole or not at all.
Wholly empty rows are ignored. These are refused, naming the row:

- a row with only one side filled in;
- a From that appears twice;
- more than 5000 entries.

**Retiring** keeps the entries, and the name is then free for a new list.
The response names the mappings that still use the list.

**The Routes screen** lists each active list, with how many entries it has
and which mappings use it. A mapping uses a list if its live version or its
draft looks a value up in it.

**Versioning.** Lists are not versioned with a mapping. A list is read as
it is when an invoice is read, and the help says so.

The endpoints are:

- `GET` and `POST /lookup-lists`;
- `GET` and `PUT /lookup-lists/:id`;
- `POST /lookup-lists/:id/retire`.

All need `Admin.Configure`, like supplier mappings. They are proxied by
`vf-ui`, with its allowlist test.

### The `look_up` function (`shared`)

`look_up(list, otherwise)` joins the closed vocabulary:

- `list` is the list's id.
- `otherwise` says what happens to a value that is not in the list:
  - `refuse`: it is a problem, "\"Beutel\" is not in the list Units";
  - `keep`: it is passed unchanged to the next step.

**The functions stay pure.** A caller loads the lists a mapping names into
a context (`FnContext`), and `applyChain` and `applyMapping` pass it
through. A retired or missing list is left out, so `look_up` says "the
look-up list … is not available: it may have been retired". It never
reads an old list.

**Units.** The usual chain is look up in Units, otherwise keep it, then the
units function. Its list comes first, and the built-in words after. For
that, the **units function now accepts a code it does not know**, when it
is written as a code is: two or three capital letters or digits, such as
`RO` from a list. Words it knows still come first, so `ST` is still a
piece (H87), and `Beutel` is still refused.

**Compiling** ("look the unit up in Units"):

- The prompt lists the customer's lists by id and name, with up to three
  entries each. With no lists, it says `look_up` cannot be used.
- A list the model names that the customer does not have is refused:
  "There is no look-up list …. Make it on the Routes screen first."
- The worked examples run through the real lists.

**Saving a draft** refuses a look-up naming a list that does not exist or
is retired.

Capture, Try, Publish (which tries the draft), read again (0566, including
its first check) and compile all load the lists they need.

### In the interface

- **Routes screen:** a *Look-up lists* panel, and a name box with **New
  list**. A new list opens straight away.
- **A list's pop-out** (`lookup-lists.js`, a new module), titled
  "Look-up list: Units":
  - the name;
  - which mappings use the list;
  - the rows, each editable and removable;
  - **Add a row**;
  - a box to paste many rows, with a tab, `;` or `,` between From and To,
    then **Add the pasted rows**;
  - **Save**, with a refusal shown inside the pop-out;
  - **Retire this list**, which asks first, naming the mappings that still
    use it.
- **Mapping editor:** a look-up step shows the list by its name, and what
  happens otherwise, for example "look up in Units (otherwise keep it)".

### The reason's capital letter

The card now starts the reason after the colon with a capital. `vf-app`'s
reason for a file holding several invoices is now two sentences: "the
file holds 2 invoices (…). One invoice per file is read".

### Strings and help

`vf-licence` `0218` adds 40 keys in English and German, none with a `;`
(0565's lesson). The mapping editor's help gains *Look-up lists*, and the
Routes help gains a section on them.

## Not built

- **Look-ups in lists the app already has** (suppliers by VAT number, cost
  centres, GL codes). Dan did not choose it for now.
- **A list per supplier.** Lists are shared, as chosen. A supplier's codes
  go in a list named for them.
- **Importing a list from a file.** Pasting rows from a spreadsheet covers
  it for now.
- **Versions of a list.** A list is read as it is at the time.

## Verification

- **`shared`**: `lookup.test.ts`, 8 tests. They cover:
  - finding a value whatever its case or spaces;
  - `refuse` and `keep`, and keep followed by the units function reading
    both list codes and its own words;
  - a missing list;
  - validation, including `otherwise`;
  - which lists a chain and a mapping name;
  - a CSV's units through a list, naming the line whose unit neither
    knows;
  - the prompt with lists and with none;
  - worked examples through the list;
  - a list the model invented, refused.

  The whole package: 367 pass. The three failures existed before this
  change.
- **`vf-app`** `supplier-mappings.test.ts`, 3 new tests:
  - lists made with a name; a taken name refused; saved whole, trimmed,
    with blank rows ignored; a duplicate, an empty To and an empty From
    refused without changing anything; listed with counts; retired, after
    which saving is refused and the name is free again;
  - a draft naming an unknown list refused; Try reading "Rolle" as RO
    through the list; `usedBy` naming the mapping; `lists` on the mapping;
    an invoice delivered; and, with the list retired, the next one failing
    in words;
  - the compiler offered the lists, with worked examples through them.

  `index.test.ts` checks the look-up endpoints through the real router,
  and that they need `Admin.Configure`. The CSV test gains the new
  wording. Full, unfiltered run: 141 files and 3312 tests, of which
  **3309 passed**. Two failures are the ones already known (0511). The
  third was the supplier mappings router test: with the look-up requests
  added, it timed out at 5 seconds under the full run's load. The look-up
  checks were moved into a test of their own, and `index.test.ts` then
  passed 232 of 232.
- **`vf-ui`**:
  - `lookup-lists.test.ts`, 5 tests using the real strings: the panel;
    making a list, which opens it; editing and pasting (tab, `;` and `,`),
    saving the whole list, a refusal inside the pop-out, then removing a
    row and saving; retiring, naming the mappings that use the list;
    reading pasted rows.
  - `mapping-editor.test.ts`: a look-up step by its list's name, and the
    0566 test with the capital letter.
  - All of these fail against the interface before this change, and the
    proxy test fails without the allowlist entries.
  - Full browser suite: 1372 of 1373 pass. The one failure is the known
    `typography.test.ts` 10px gap. Worker tests: 75 of 75.
- **`vf-licence`**: 322 of 322 pass, with `0218` loaded and its keys
  covered.
- **Migrations**: `vf-app` replays 113; `vf-licence` replays 218.
- **Screenshot** of the Routes screen's panel and a list's pop-out,
  checked by eye.
