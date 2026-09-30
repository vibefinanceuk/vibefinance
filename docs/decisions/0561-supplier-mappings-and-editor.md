# 0561 — Routes phase 2, slice 2: supplier mappings and the mapping editor

**Status: built and tested locally, not yet pushed or deployed.** This
session has no push access, so it is delivered as a git bundle. It touches
`shared`, `vf-app`, `vf-ui` and `vf-licence`, and needs two migrations:

- **`vf-app` `0111`**, applied before deploying `vf-app`;
- **`vf-licence` `0212`**.

## What was asked

Phase 2, slice 2: store supplier mappings, versioned and able to carry
functions (Fx). The editor was planned as slice 3. On 30 September 2026
Dan chose to build slice 2 with the editor's basics, so he can test it
end to end:

- store and run mappings with functions;
- map by hand from a kept sample in the editor he approved;
- publish, then reprocess.

AI proposals stay slice 4, and testing across several samples stays
slice 5.

## What was decided

### The engine (`shared/ingestion/mapping-engine.ts`)

A mapping is `{root, linesPath, lines: [{target, source, fx, say,
origin}]}`:

- **root** is the document's root element, which is how a mapping is
  recognised.
- **linesPath** is where the invoice lines repeat.
- **lines** says which element becomes which EN 16931 Business Term.

Paths run from the root, without namespace prefixes (for example
`Rechnung/Kopf/Datum`). An attribute is written `@nr`. A line's sources
are relative to its lines, for example `Menge`. Values are read as
written, so `00088240` stays as it is and `29.09.2026` is not read as a
number.

`describeXml` gives the editor's left-hand column:

- every element with a value, a sample, and how often it occurs;
- the groups that repeat;
- every group a person may choose as the lines.

An invoice with a single line has nothing that repeats. Its line group is
then recognised by the usual names (Position, Posten, Line, Item and so
on), and the person can choose another.

`applyMapping` gives the facts and lines, then checks them against EN
16931:

- BR-01 is not required, because a supplier's own XML declares no
  specification.
- A seller or buyer country code stands in for the postal address.
- Each Business Term must end up as the right kind of value. A date must
  be ISO, and a number must be a number. A value that is not says so, and
  names the function that would read it ("decimal comma", "read date").

### The functions (`shared/ingestion/mapping-functions.ts`)

The functions are a closed vocabulary, like the rule language. There are
19:

- dates: read date, write date;
- numbers: decimal comma, number, round, multiply;
- text: trim, upper case, lower case, first letters, last letters,
  remove prefix, replace, remove spaces;
- codes: country to code, code to country, unit of measure;
- fixed values: if empty use, always.

A chain has at most five steps. Every function is pure, with no loops and
no calls out. A value a function cannot handle gives a reason in words,
never an exception.

Two functions use limited lists, stated in the code:

- **Countries:** the EU and EEA, the UK, Switzerland, and the ten largest
  partners outside them, in English and German. This is not the whole of
  ISO 3166.
- **Units:** the common ways an invoice names a unit, mapped to their
  UN/ECE Recommendation 20 codes.

Anything outside these lists is refused, not guessed.

### Functions in plain words (`function-compiler.ts`)

Functions are compiled from plain words the way rules are (0002, 0007),
through the same Workers AI `CompilerModel`:

- The model may answer only with functions from the list. Its answer is
  validated before use, and anything else is a refusal in words.
- The worked examples are computed by our code, over every value that
  element holds in the sample. The model never writes them, so they
  cannot flatter it.
- Nothing is saved until the person accepts it.

### Storage and versions (migration `0111`)

- `supplier_mappings` holds the route, the name, the root element, and
  who the mapping is for (`senders`):
  - an address, or `@domain`;
  - empty means anyone;
  - a new mapping is for the sender's domain.
- `supplier_mapping_versions` holds each version's definition and the
  kept message part it was drawn from.
- There is at most one draft and one live version:
  - Saving edits the draft, made from the live version where there is
    none.
  - Publishing retires the live version and makes the draft live.
- Each message part records:
  - `xml_root`;
  - `mapping_id` and `mapping_version`: which mapping and version read
    it, or tried to.

### At intake

An XML attachment whose root is not `Invoice`, `CrossIndustryInvoice`,
`CreditNote` or `CrossIndustryDocument` is a supplier's own XML. It is
read through the live mapping on the receiving route that matches its
root and its sender. Where several match, one that names the sender
comes before one for anyone, then the most recently published.

- **No mapping:** the attachment fails at translation with its root
  kept. The Route monitor says "A supplier's own XML, and no mapping reads
  it yet" and offers **Map this format**.
- **A value it cannot read:** the attachment fails, giving the mapping,
  the version, the term, where the value came from, the value and why. For
  example: `BT-2 (from Rechnung/Kopf/Datum): "2026-09-30" is not a date
  written dd.MM.yyyy`. The monitor offers **Open the mapping**.
- **Read:** the invoice is captured like any other, with `intake.format =
  supplier_xml` and the EN 16931 facts from 0560. The part records the
  mapping and version.

The sender is passed from the email and from the message when it is
reprocessed. A new `supplier_xml` format appears on the Routes screen's
Receiving formats panel.

### The editor (`vf-ui/public/mapping-editor.js`)

The editor follows the approved mock-up:

- The sample's elements are on the left, grouped, with sample values.
  Elements not yet used are dimmed.
- The Business Terms are on the right, invoice then line, each with its
  name. Required terms without a source are marked "Needs a source".
- A curved line is drawn for each mapping, with an Fx where a function
  applies.

Working in it:

- Choose an element, then a term, or the other way round. A line's term
  from outside the lines, or a document term from inside them, is refused
  in words.
- Choose a mapped term to see:
  - where it comes from, and its sample;
  - its function, and what was said;
  - a box to say what should happen, then **Understand**, the steps and
    the worked examples, then **Accept**;
  - Remove function, and Remove line.
- A term the document never carries takes a fixed value.
- The Mapping panel sets the name, who the mapping is for, and where the
  lines repeat.
- **Try on the sample** shows the values read, the lines, anything it
  could not read, and the EN 16931 checks.
- **Publish** is refused while the draft cannot read its own sample, and
  says which values are the problem. Once published, the editor offers to
  **Reprocess** the failed messages on the route with that root.
- Every change saves the draft.

The ways in:

- the Route monitor's **Map this format** or **Open the mapping**;
- the Routes screen's new **Supplier mappings** panel. For each mapping
  it shows its live and draft versions, what it read in the last 30 days,
  and the failed messages waiting.

### Permissions

Everything is under `Admin.Configure`, like Routes. Reprocessing from the
editor uses the Route monitor's own endpoint and permission
(`Integration.Monitor`). Where the person lacks it, the editor says so.

Strings for all of this are in English and German, in `vf-licence`
`0212`. They cover the 34 Business Terms and 19 functions by name, and
the monitor's explanations for the two new failures.

## Not built

- **AI proposing the lines**, with confidence and a threshold. This is
  slice 4. The `origin` on each line is already there for it.
- **Several samples, and comparing with the live version.** This is
  slice 5.
- **Plain-language rules** for the whole document, such as "ignore lines
  with a zero quantity". The mock-up showed them; they are not built.
- **Supplier CSV.** Only XML is mapped.
- **Look-ups in the customer's own lists.** The function is not in the
  vocabulary yet.
- **Destination mappings** (EN 16931 out to an ERP layout). The engine
  reads in only.

## Verification

- **`shared`**: `mapping.test.ts`, 20 tests.
  - Every function, including refusals and a failed date.
  - Chains, and what `validateChain` refuses.
  - `describeXml`: paths, attributes, repeats, and a single line
    recognised by its name.
  - `applyMapping` on a supplier's own XML:
    - it gives the same facts and lines UBL would;
    - EN 16931 checks pass, and BR-01 is not required;
    - each kind of problem is reported in words;
    - the wrong document is refused;
    - a missing term is reported as the EN 16931 failure it causes.
  - Compiling a function: the prompt, the examples computed by our code,
    and refusals, including a name outside the vocabulary.
  - The whole package: 345 tests pass. The three failures existed before
    this change and are unchanged.
  - With the official CEN and KoSIT material, `ingestion/` passes 328 of
    328.
- **`vf-app`** `supplier-mappings.test.ts`, 12 tests:
  - a supplier XML fails with its root kept;
  - a mapping is drawn from it: its route, root, lines group and sender
    domain;
  - UBL is refused as a sample;
  - an invalid draft is refused;
  - the draft is tried on its sample;
  - publishing is refused when empty, or when the draft cannot read its
    sample;
  - publishing names the waiting messages, and reprocessing delivers them
    through the mapping;
  - the next invoice is read directly, and another sender's is not;
  - a value it cannot read fails in words, with the mapping recorded;
  - editing a live mapping makes version 2, and publishing it retires
    version 1;
  - a function is compiled against the sample's values;
  - sender matching.

  `index.test.ts`: through the real router, every endpoint needs
  `Admin.Configure`, and 404, 405 and missing-sample cases are covered.
- **`vf-app`** full, unfiltered run: 141 files and 3291 tests, of which
  **3289 passed**. The two failures are the ones already known (0511).
- **`vf-ui`**: the new browser test `mapping-editor.test.ts` (11 tests)
  uses the real strings. It covers:
  - the layout;
  - drawing lines, with a line's term relative to the lines;
  - the scope refusal;
  - compiling, the examples, and Accept saving the function;
  - a refusal;
  - a fixed value;
  - Try;
  - Publish then Reprocess;
  - a refused publish;
  - the drawn lines and Fx;
  - the Route monitor's **Map this format** and its explanation, opening
    the editor.

  `routes.test.ts` adds the Supplier mappings panel opening the editor,
  and the new format row. `index.test.ts` checks that every new path is
  proxied.

  Worker tests: 75 of 75. Browser tests: 1349 of 1350; the one failure is
  the known `typography.test.ts` 10px gap.
- **Migrations**: `vf-app` replays 111; `vf-licence` replays 212.
- **Screenshots**, checked by eye in Day and Night:
  - the editor with a function being understood;
  - Try;
  - the Route monitor offering to map;
  - the Routes screen's Supplier mappings panel.
