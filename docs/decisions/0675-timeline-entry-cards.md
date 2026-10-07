# 0675: The Timeline's entries — system events as coloured cards, chat as bubbles

**Status: built and tested locally, not yet pushed or deployed.** It
touches `vf-licence` (strings), `vf-app` (one field) and `vf-ui`. It
needs **vf-licence migration `0304`** and no vf-app migration. Deploy
vf-licence, vf-app and vf-ui.

## What was asked

Dan, 7 October 2026:

> Currently user comments are asserted in a dark blue box, with the user
> initials next to it. Would it be possible to also put system messages
> in a bubble, perhaps a slightly different shade or colour depending on
> the alert. You could also use a exclamation or another symbol to
> indicate this is a system alert and not a manual comment.

Two options were mocked up: **A**, every entry a bubble, and **B**, slim
cards for system events with chat kept as bubbles. Dan chose B:

> I really like B. With one small variation and that is that the Day
> colour scheme for the timeline / chat is also used for the night. I
> find the bolder darker colour to be too deep.

## What was built

### One look, in both Timelines (vf-ui `timeline-entry.js`)

The Document viewer (`activity.js`) and a receipt's Timeline
(`receipt-timeline.js`) both draw their entries with this module.

**A system event is a slim card** (`systemCard`):

- a 3px coloured left edge, and a symbol for its kind;
- a bold label (*Received*, *Rule fired*, *Email failed*), a dot, then
  the words as before;
- grey lines beneath, as before (the file it was read from, a comment,
  what happened to an email);
- **the time**:
  - `16:37` when the entry before it was the same day;
  - `2026-10-07 16:37` for the first entry, or when the day changes;
  - the whole moment, to the second, as its tooltip.

**A person's message stays a bubble** (`chatBubble`):

- their initials, their name, and the moment to the second (0674);
- an outline in the accent colour;
- **your own messages sit on the right**, in the accent's tint.

### Tones (`EVENTS`)

| Tone | Edge and symbol | For |
| --- | --- | --- |
| Information | blue, an inbox (or the action's own) | received; exported to the ERP |
| Needs attention | amber, a warning triangle (or the action's own) | a rule fired; stopped at a stage; returned; returned to supplier; chased; a reminder; an export undone |
| Done | green, a tick | a stage completed; registered; held-back lines released; a receipt closed a rule's task |
| Problem | red, an exclamation mark in a circle, on a faint red card | an email that bounced, was marked as spam or could not be sent; discarded; a line rejected; rejected; cancelled |
| A person's action | grey, the button's own icon | claimed; released; reassigned; routed to an approver; an order linked; a line paired; a line corrected or moved; a person added or removed |

- **A Return To Supplier whose email failed** is shown as a problem
  (*Email failed*), not something to notice.
- **New icons:** `inbox`, `tick` and `alertcircle`.

### Day's colours in Night too (vf-ui `app.css`)

- **`.tlfeed` sets the colour tokens its entries use back to Day's
  values.** The cards and bubbles are the same light shades in both
  themes.
- **The pane around them keeps its own theme:** the tabs, the people
  bar and the box to write in.

### Your own messages (vf-app)

- **`GET /documents/:id/activity` marks each comment `mine`** when the
  person looking wrote it (`handleGetActivity`'s new `viewerId`).
- **A receipt's comments already carried `mine`** (0658).

### Words (vf-licence `0304`)

28 labels (`timeline.label.<kind>`), in English and German.

### Not changed

- **What each entry says:** its words are as before.
- **Order:** time, from 0674.
- **The system alert** at the top of a document's Timeline ("This
  document could not be read automatically…").
- **The Conversations list on Tasks.**

## Verification

- **`vf-ui`** browser:
  - `timeline-entry.test.ts` (new, 6 tests):
    - a card's tone, symbol, words and time;
    - the date shown first and when the day changes, and only the time
      otherwise;
    - each kind's tone;
    - a caller's classes kept;
    - a bubble's initials and moment, with yours marked `mine`;
    - the stylesheet keeps Day's tokens in `.tlfeed`, and puts yours on
      the right.
  - `viewer.test.ts` gains 1 test: a document's received, bounced
    Return To Supplier and claim come out information, problem and
    action, and your own comment is `mine`.
  - The existing Timeline tests of both viewers pass unchanged.
- **`vf-app`** `activity-route.test.ts` gains 1 test: the viewer's own
  comment is `mine: true` and another's `false`, and with no viewer the
  key is left off.
- **`vf-licence`**: 362 of 362, and migrations replay to 304.
- **Screenshots** of a document's Timeline in Day and Night.
- **Full runs**:
  - vf-app 3698, of which 3696 pass (the two known failures);
  - vf-ui browser 1635, of which 1634 pass (the known
    `typography.test.ts` 10px gap);
  - vf-licence 362 of 362.
