# 0674: The Timeline in time order, with one way of writing a moment

**Status: built and tested locally, not yet pushed or deployed.** It
touches `vf-app` and `vf-ui`, with no migration. Deploy vf-app and
vf-ui.

## What was asked

Dan, 7 October 2026, with a screenshot of a document's Timeline / Chat:

> I've noticed that the messages are not being sequenced in
> chronological order. … Also, some messages are logged with strange
> timestamps - see 2026-10-07T15:37:19.973Z. I would like all messages,
> system, manual or otherwise to be logged in chronological order.

His screenshot showed, top to bottom: a rule that fired at 15:37:20, a
chat at 15:38:34, then *Received* at 15:37:19, the first thing that
happened, last.

## Why

**The Timeline was sorted as text, and its moments are written in two
forms.**

- **SQLite's `datetime('now')`** writes `2026-10-07 15:37:20`. That is
  UTC with no marker, and a space between date and time.
- **JavaScript's `toISOString()`** writes `2026-10-07T15:37:19.973Z`.
  The *Received* line takes its moment from the route message (0571),
  and task actions write theirs this way.
- **The sort compared the text**, and a `T` sorts after a space. So
  every ISO moment fell after every SQLite moment of the same day,
  whatever the time.
- **Milliseconds misordered moments too:** `15:37:20.848` sorted
  before `15:37:20`.
- **The Document viewer showed `at` exactly as sent**, which is why
  the ISO moment looked strange beside the others.

The receipt's Timeline (0658) already turned both forms into ISO, so
its days were not split this way. It still sorted text, and the
milliseconds case could still misorder it.

## What was built

### vf-app: one form, ordered as time

**`timeline-time.ts`:**

- `instant()` reads either form, and an offset if one is ever given, as
  UTC.
- `toIso()` writes every moment as `YYYY-MM-DDTHH:MM:SS.sssZ`.
- `byTime` orders by the instant itself; an unreadable moment goes
  last. At the same instant, the order written is kept.
- `chronological()` does both.

**Where it is used:**

- **The document's activity** (`activity-route.ts`) gathers every
  source as before, then calls `chronological()`. That covers received,
  stage completions, rule firings, chat, task actions, ended tasks, ERP
  exports, reminders and receipt-closed lines.
- **The receipt's Timeline** (`receipt-timeline.ts`) uses `toIso()`
  for each moment and `byTime` to order them.

Every `at` either Timeline sends is now in the one ISO form, so it
sorts correctly as text as well.

### vf-ui: one way to show it

**`timestamp.js` `stamp()`** shows a moment as `2026-10-07 16:37:19`,
in the viewer's own time zone:

- date first, then time to the second;
- no `T`, `Z` or milliseconds.

The Document viewer's Timeline (`activity.js`) and the receipt's
(`receipt-timeline.js`) both use it.

**Two visible differences:**

- **Times are in the viewer's own time zone now.** The Document viewer
  used to show the stored UTC time, an hour behind in British Summer
  Time.
- **The receipt's Timeline shows the same form as the document's.** It
  showed `7 Oct 2026, 16:37`, without seconds.

### Not changed

- **What is stored:** no migration, and old rows read correctly.
- **Other screens' dates**, such as ERP export history, documents and
  purchase orders. They are not timelines, and each already shows one
  form.

## Verification

- **`vf-app`:**
  - `timeline-time.test.ts` (new, 3 tests):
    - SQLite, ISO and offset moments all come out in the one form;
    - Dan's four kinds of moment come out in time order (received, the
      same second without milliseconds, the rule, the chat);
    - order is kept at the same instant, and an unreadable moment goes
      last.
  - `activity-route.test.ts` gains 1 test, Dan's case. The invoice
    arrives in SQLite form at 15:37:19, a claim is written in ISO form
    at 15:37:20.848, and a chat in SQLite form at 15:38:34. The feed
    comes out received, claim, chat, every `at` in the one form.
  - 8 expectations in `activity-route.test.ts` and 2 in
    `received-files.test.ts` now expect the ISO form.
- **`vf-ui`** browser `timestamp.test.ts` (new, 3 tests):
  - local time to the second, with no `T`, `Z` or milliseconds;
  - both forms of one moment show alike;
  - what cannot be read is given back as it is.
- **Screenshot** of the document's Timeline in Day and Night, with
  Dan's three moments in order.
- **Full runs**:
  - vf-app 3697, of which 3695 pass (the two known failures);
  - vf-ui browser 1628, of which 1627 pass (the known
    `typography.test.ts` 10px gap).
