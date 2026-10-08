# 0688: A scanned page's lines are asked for on their own

**Status: live** at `83b73dd`, pushed and deployed 8 October 2026. vf-app only, no migration.

## What happened

After 0686 (line items require `description` and `amount`) and 0687 (read
later), Dan re-sent the PDFs on 8 October 2026. Read through the app's API:

- Every attachment timed out, including single-page scans that were read in
  seconds before 0686. Each took about eight minutes: the call, then its 0685
  retry, both `AiError 3046`.
- Each invoice was kept for keying with `intake.readFailure` "the model did not
  respond in time", so the **header** was lost as well as the lines.

Before 0686 the model answered `lines: [{}]` quickly. Once every row had to
carry both keys, it had to write the line table out, and on these scans the
answer no longer came back in time. The cause of the slowness is not proven:
it may be a long table, or a runaway answer repeating rows. Nothing records
what the model wrote before it timed out.

## The fix

Two calls per scanned page instead of one:

1. **The header**: `buildExtractionSchema(..., { lines: false })`, the same
   fields as before without `lines`. Short, and read in seconds as before. The
   0685 retry still applies.
2. **The lines**, only once the header was read: `buildLinesSchema`
   (`{ lines: [...] }`, at most 25 rows, both keys required) and
   `buildLinesPrompt`, with `max_tokens` 2500 (`LINES_MAX_TOKENS`; 25 rows need
   about a thousand). The cap and `maxItems` bound how long a line answer can
   run.

Whatever happens to the lines call, the header stands. A time-out, an answer
cut off at the cap, or invalid JSON leaves the page with no lines, and
`extraction.lineProblem` says why: `lines not read: <reason>`. When the model
wrote something, the start of it is added (`; it began: …`). That shows what
the model actually produces for these tables, which nothing could show before.

The line-reading rules (0052, 0684, 0685, 0686) are now `readLineRows`, shared
by the one-call text read for digital PDFs (unchanged) and the new lines call.

`ExtractionModel.extract` takes an optional `{ maxTokens }`, and the Workers AI
adapter passes it as `max_tokens` (default 8192, as before).

## Tests

- `test/pdf-read.test.ts`:
  - the header schema has no `lines`;
  - the lines schema has `maxItems` 25 and both keys required, and its call is
    capped at 2500 tokens;
  - lines are read from the second call;
  - a lines call that times out keeps the header and records why;
  - a cut-off answer records how it began.
- Tests that counted model calls, or looked at the last schema, now allow for
  the second call: `pending-document`, `pdf-read`, `extraction` and
  `capture-pdf`.

## Next

Dan re-sends. Expected: headers read again in seconds. Lines either arrive, or
`extraction.lineProblem` shows what the model wrote.

## Confirmed live, 8 October 2026

Dan emailed three scans one per email. All three were read in the background
(0687), and every line total matches the invoice's net total exactly:

| Invoice | Lines | Line sum | Net (BT-106) | Validation |
| --- | --- | --- | --- | --- |
| 13017251 (023F88A6) | 1 | 2162.76 | 2162.76 | passed |
| 2157829 (023B684C, multi-page) | 70 | 2563.41 | 2563.41 | passed |
| 30098095 (0242C15A) | 1 | 186.24 | 186.24 | warning: BT-5 read as `EURO` |

The `EURO` warning is the model writing the currency's name instead of its ISO
4217 code. It is not a line problem.
