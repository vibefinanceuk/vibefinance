# 0722: The expanded document window's right-hand column has its own tabs

**Status: live** at `4300d78`, pushed and deployed 10 October 2026. vf-ui (`viewer.js`
`initDocumentWindow`, `app.css`). No migration.

## What was asked

Dan, 10 October 2026: *"In the expanded image view of the document. Please can you show the
document / attachment tab on the left, but on the right show the Timeline / Chat, Supplier as
two tabs. Also, would it be possible to make the width of the right panel (timeline / chat)
slightly wider."*

## What changed

Since 0721 the Supplier tab landed among the document's tabs in the expanded window (0394 took
only Timeline / Chat out to the right). Now:

- **Left**, in the card's heading: Document and Attachments.
- **Right**, a tab row of its own: Timeline / Chat and, when offered (0721), Supplier.
  Timeline / Chat shows first.
- Each side switches only its own panes. `buildDocTabs()`'s shared `select()` toggles every
  pane, so the window gives each button its own side's switch.
- The right column is **32%** of the width (was 25%); the document 68%.

The embedded viewer on the task screen is unchanged: one row of tabs.

## Tests

vf-ui `document-window.test.ts`: the two tab rows, each switching only its own side, the
Supplier pane on the right. The existing window tests pass, the first now checking the
heading's tabs only.
