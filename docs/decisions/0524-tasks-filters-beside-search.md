# 0524 — The Tasks list's Stage and Owner filters sit between Search and Rows

**Status: pushed (`2b81aee`) and `vf-ui` deployed, as confirmed by the operator on 27 September.** It
changes `vf-ui` only, with no migration and no string change.

## What was asked

> On the task screen, please can you move the Stages and Owner drop-down
> to be between the Seach and Rows controls, at the top of the list.

## What was decided

`searchAndPaginationRow` (in `tasks.js`) now places `filterBar()` —
the Stage and Owner selects — directly after the search box and before
"Rows". It previously sat after the paging controls, at the end of the
row. They narrow the list just as the search box does, so they now sit
beside it. The filters' own bottom margin is dropped when they are
inside the search row (`.searchrow .filters`), because the row sets the
spacing.

Nothing else changed: the options, their values, arriving from a
dashboard card with a filter already set (0254/0256), and resetting to
page 1 on change.

## What was verified

- **`tasks.test.ts`:** the search row reads search box, filters, then
  Rows, and the filters appear once on the page. This test **failed**
  with `tasks.js` stashed.
- **Browser suite:** 1210/1211. The one failure is the known
  `typography.test.ts` `10px` gap.
- **`npx eslint`:** clean.
