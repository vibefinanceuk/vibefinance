# 0685: Line amounts as invoices print them, one retry, and why a read failed

**Status: live** at `9ac4f96`, pushed and deployed 8 October 2026. vf-app only, no migration.

## What was asked

Dan, 8 October 2026, after 0684:

> results seem better. items in validation and header information
> extracted. cannot see any line information though

## What the re-sent PDFs showed

Read through the app's own API in Dan's signed-in browser:

- every read invoice had `intake.read = pdf_images` and the original stored
  as `application/pdf` (0684 working);
- every one had `extraction.lineRows` of 1 (5 on the two-page invoice) and
  `extraction.linesKept` of 0. The model **did** return line rows, with an
  amount present, and every one was refused;
- the two-page invoice was kept unread four times in five, and one other
  once: the model did not answer in time (`intake.structure` empty).

## The fixes

### 1. A line amount is read as invoices print it — `lineAmount`

`coerce(value, "number")` accepts a plain number and a string such as
`£1,234.56`. The scans' line amounts arrived in shapes it refused, and one
refused amount discards the whole list (decision 0052: a partial list is
worse than none). `lineAmount` (`extraction.ts`) tries `coerce` first, then
also accepts:

- a currency code before or after: `GBP 579.84`, `579.84 GBP`;
- a currency symbol after: `579.84 £`;
- a credit written `(25.00)`, `25.00-` or `25.00 CR` (read as −25).

It still refuses prose (`about 25`, `see attached`) and a lone decimal
comma (`579,84`), which stays ambiguous without the invoice's locale. The
rule that one unreadable amount discards the list is unchanged.

### 2. Why lines were dropped is on the invoice — `extraction.lineProblem`

When no line is kept and an amount was refused, the first refused amount
is recorded: `row 1: amount "see attached"`. It is carried through
`mergePageResults` for a multi-page document. The next time lines go
missing, the invoice says why without a trace.

### 3. An unanswered page is asked once more

`extractInvoiceFromImages` retries a page once when the model call fails
with `ExtractionRefusal(unanswered)` (a Workers AI time-out). A second
failure falls back as before: the invoice is kept for keying.

### 4. Why a read failed is on the invoice — `intake.readFailure`

The keyed fallback in `source-capture-route.ts` now records the error
(up to 300 characters) as `intake.readFailure`.

## Tests

`test/pdf-read.test.ts`: amounts accepted and refused; a coded amount
kept as a line; `lineProblem` recorded; a page unanswered once is read on
the retry; a page never answered is kept with `intake.readFailure`.

## Next

Dan re-sends the PDFs; the new invoices are read through the API to check
`extraction.lineRows`, `linesKept`, `lineProblem` and `intake.readFailure`.
If amounts are still refused, `lineProblem` shows the exact shape.
