# 0676: The Timeline's system alert scrolls with the feed, and the entries line up with the box to write in

**Status: built and tested locally, not yet pushed or deployed.** It is
`vf-ui` only, with no migration. Deploy vf-ui.

## What was asked

Dan, 7 October 2026, with a screenshot of a document's Timeline / Chat
after 0675:

> Could we make the system alert at the top of the page part of the
> scrollable content. It appear to be fixed in position. Also, would it
> be possible to change the left of right border width on the entries,
> so that they align with the left side of the comment box a the bottom,
> and align with the right of the post button on the right at the
> bottom.

## What was built

### The alert scrolls with the feed

**Before**, the *System alert* ("This document could not be read
automatically…") sat in the pane above the feed (0271), so it stayed put
while the entries scrolled beneath it.

**Now it is the feed's first entry:**

- `viewer.js` builds it as before and hands it to `buildActivityTab`
  (`{ banner }`). `activity.js` puts it first in the feed each time the
  feed is drawn.
- Scrolling down takes it out of view, with the entries.
- **It takes the entries' Day colours** (0675), with its own Day text
  colour, so it reads on a light card in Night as well.
- Inside the feed, the feed's gap spaces it rather than its own margin.

### The entries line up with the box to write in

The feed (`.tlfeed`) is inset 14px on each side, the same as the row
holding the box and Post (`.activityinput`):

- a card's or bubble's left edge meets the box's left edge;
- its right edge meets Post's right edge.

This applies to both Timelines, the Document viewer's and a receipt's.

## Verification

- **`vf-ui`** browser `viewer.test.ts`:
  - the existing system-alert test now also checks the alert is the
    feed's first entry;
  - 1 new test: the stylesheet insets `.tlfeed` by 14px, matching
    `.activityinput`'s 14px.
  - The Timeline tests of both viewers pass: 313 of 313.
- **Screenshots** of a document's Timeline in Day and Night, at the top
  and scrolled to the end.
- **Full run**: vf-ui browser 1636, of which 1635 pass (the known
  `typography.test.ts` 10px gap).
