# 0686: Line items must carry both keys

**Status: live** at `487b982`, pushed and deployed 8 October 2026. vf-app only, no migration.

## What was asked

Dan, 8 October 2026, after deploying 0685, wiping the runtime data and re-sending
the same PDFs:

> Still no line information unfortunately.

## What the invoices showed

Nine invoices, read through the app's API in Dan's signed-in browser. Every one:
`intake.read = pdf_images`, header read, `extraction.lineRows = 1` (3 on the
two-page invoice), `extraction.linesKept = 0` — and **no**
`extraction.lineProblem`. No invoice needed `intake.readFailure`: the 0685 retry
let the two-page invoice through.

No `lineProblem` means no amount was refused (0685). The single row was set aside
by the 0684 rule, as a row with no amount: it carried no `amount` key at all.

## Why

The schema sent to the model (`guided_json`) makes every top-level key
`required`. That was a measured fix: with only `_confidence` required, the model
left out six of fourteen properties. The line `items` schema had no `required`
list, so the same thing happened one level down: guided decoding produced
`lines: [{}]`, one empty object, on every scan.

## The fix

- `buildExtractionSchema`: line items now require `description` and `amount`.
  Both are nullable, so "required" asks for a key, never for an invented value.
- `extraction.lineProblem` also records the first row set aside (no amount, or no
  description) when no line is kept, e.g. `row 1: no amount: {}`. An empty line
  list now always says why.

## Tests

`test/pdf-read.test.ts`: the schema requires both keys; `lines: [{}]` records
`row 1: no amount: {}`.

## Next

Dan re-sends the PDFs. If lines are still missing, `extraction.lineProblem`
shows the row the model returned.
