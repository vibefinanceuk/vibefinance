# 0624: Agents, slice 3: ageing, due soon, stuck work, options, highlights and comparison

**Status: built and tested locally, not yet pushed or deployed.** It
touches `vf-app`, `vf-ui` and `vf-licence`. It needs **vf-app migration
`0129`** and **vf-licence migration `0267`** (strings). Deploy vf-licence,
then vf-app and vf-ui.

## What was asked

Slice 3 of the six agreed with Dan on 4 October 2026
(`claude/agents-design.md`), after slice 2 (0623) went live and Dan
tested a scheduled email to a colleague (*"that worked"*; *"yes please"*
to slice 3). It carries out decision 14 of the design (first data:
outstanding payables, due soon and not yet payment-eligible, stuck work)
and the build order's "shape" step.

Dan had expected **Run now** to send to everyone chosen; it sends to the
author alone, by design (0623). This slice says so on the screen.

## What was built

### vf-app

- **Migration `0129`**: `agents.options_json` (default `{}`), and
  `agent_deliveries.totals_json`, what each person was sent.
- **Options per report** (`checkOptions`), each report taking only its
  own, defaults filled in, out of range refused in words
  (`option_invalid_<key>`):
  - outstanding payables: `minTotal` (only suppliers owing at least this,
    in their currency) and `highlightDays` (default 60);
  - due soon: `withinDays` (1–90, default 7);
  - stuck work: `olderThanDays` (1–365, default 5).
  Kept on the agent; kept when editing something else; reset to the new
  report's defaults when the report changes. `GET /agents` offers each
  report's option keys and defaults.
- **Outstanding payables, aged** against the due date (BT-9): *not yet
  due* (or no due date), *1–30*, *31–60*, *61–90*, *over 90* days past
  due, the total, and the oldest's days past due. Oldest first; rows
  whose oldest is past `highlightDays` are highlighted. With `minTotal`,
  only suppliers owing at least that, and the totals are theirs.
- **Due soon, not yet payment-eligible** (new, `AP.Analysis`): invoices
  in progress short of their exit stage, due today or within
  `withinDays`; organisation, invoice, supplier, stage, due date, days to
  due, total. Soonest first; due within two days highlighted.
- **Stuck work** (new, `AP.Analysis`): open tasks created more than
  `olderThanDays` ago, by organisation, stage and who has them
  (unclaimed said), with how many and the oldest's age. Oldest first;
  twice the limit highlighted.
- **Highlights** are a `_highlight` mark on a row, never a column, so
  the CSV is unchanged by them.
- **Compared with the last report**: each run carries `previous`, the
  totals this person was last sent for this agent (from
  `agent_deliveries.totals_json`), so a filtered copy is compared with
  that person's own last copy, not the author's.
- **Email**: the new columns and reports in English and German; the
  totals line says *up/down N since the last report* or *no change*;
  lines say the minimum amount and what a highlight means; highlighted
  rows bold and red.

### vf-ui

- **The form** shows the chosen report's options with their defaults and
  hints; none for a report without any.
- **Run now** is explained under the screen's heading: *Run now sends only
  to you, to try an agent. Everyone else gets theirs on the schedule.*
- **A note's table** highlights rows, says why, says the minimum amount,
  and compares the totals with the last report.

## Not built (later slices)

Plain words (slice 4); the AI summary (5); the agent's own page (6).
An email link to Documents at the report's filter still waits for
Documents filters these reports can name.

## Verification

- **`vf-app`** `agents-shape.test.ts`, 8 tests: options per report,
  defaults, rounding, refusals; options kept, offered and kept on edit;
  outstanding payables in every bucket (no due date as not yet due),
  oldest first and highlighted past 60 days; the minimum amount, said and
  highlighted in the email; due soon within 7 and 14 days, past due and
  already eligible left out, highlighted within two; stuck work by stage
  and person, unclaimed, too recent left out, highlighted at twice the
  limit; the comparison carried and said; up, down, no change and counts
  in words. `agents.test.ts` and `agents-email.test.ts` updated for the
  aged columns.
- **`vf-ui`** browser `agents.test.ts`, 2 new: options with defaults per
  report, none where a report has none, sent; the Run now line; a note's
  highlighted row, why, and the comparison.
- **`vf-licence`** 359 of 359; strings replay checks keys are lower case
  (it caught the first draft's camel-case option keys).
- **Full runs**: vf-app 3529, of which 3527 pass (the two known
  failures); vf-ui browser 1518, of which 1517 pass (the known
  `typography.test.ts` 10px gap), with the same 331 unhandled errors;
  worker 111 of 111; vf-licence 359 of 359. **Migrations** replay:
  vf-app 129, vf-licence 267.
