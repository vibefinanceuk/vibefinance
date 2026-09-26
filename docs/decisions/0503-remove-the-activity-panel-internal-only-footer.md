# 0503 — Remove the activity panel's "Internal only" footer

**Status: built and verified locally, not yet committed/pushed at the
time of writing.**

## What was asked

> Please can you remove the text at the bottom of the Timeline / Chat
> that reads "Internal only — not visible to the supplier."

## What was found

The line lives once, rendered by `activity.js`'s own `renderContent()`
at the foot of the panel, below the feed and the reply box:

```js
el("div", { class: "activityfoot", text: t("activity.internalonly") }),
```

The words come from `activity.internalonly` (`vf-licence` migration
`0078`), seeded when the activity panel itself was first built
(decision 0267). That decision's own record quotes the operator's
original request directly — *"the conversation should be internal
only"* — and a sibling migration (`0059_document_comments.sql`) is
explicit that this is a design property, not a label: comments have no
supplier-facing column and no visibility flag to toggle, so nothing
about *whether* a comment reaches a supplier changes here. This
decision only removes the sentence that said so out loud on the
screen.

No other place in the interface renders this string — `document-
window.js` reuses `activity.js` itself rather than duplicating the
panel, so removing the one render site is complete.

## What was decided

Remove the footer line and its now-unused CSS rule. Leave the
underlying design untouched — `document_comments` still has no
supplier-facing path, so removing the on-screen reminder does not
change what actually happens to a comment, only whether the panel
says so.

The seeded string (`activity.internalonly`, migration `0078`) is left
in place rather than deleted — this codebase does not rewrite old
migrations, and an unused seeded row is harmless. It is dropped from
`string-coverage.test.ts`'s own hand-maintained "keys the interface
uses" list, since the interface no longer does.

## What was built

- **`workers/vf-ui/public/activity.js`**: the `.activityfoot` div and
  its `t("activity.internalonly")` call removed from `renderContent()`.
- **`workers/vf-ui/public/app.css`**: the now-unused `.activityfoot`
  rule removed.
- **`workers/vf-licence/test/string-coverage.test.ts`**: `"activity
  .internalonly"` dropped from `KEYS_THE_INTERFACE_USES`.

## What was not built

No migration removing the seeded string row — it is simply no longer
referenced. No change to `document_comments`, its schema, or any
supplier-facing surface: the panel remains internal-only by
construction (decision 0267), this only removes the sentence saying
so.

## Verification

- `workers/vf-ui`: `viewer.test.ts` and `document-window.test.ts`
  (browser) — **250/250** passing, unchanged from before this change
  (confirmed via `git stash` — the same 287 unrelated unhandled-
  rejection warnings from an unstubbed `/collaborators` route appear
  identically with and without this change, a pre-existing condition
  of that test file, not a regression here).
- `workers/vf-licence`: `string-coverage.test.ts` **10/10**.
- `npx eslint` clean on every touched file.
