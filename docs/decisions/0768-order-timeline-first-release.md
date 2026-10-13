# 0768: An order's Timeline loads after its first release

**Status: live.**

- vf-app: `order-timeline.ts`.
- vf-ui: `order-timeline.js`, `receipt-timeline.js`.

## What was asked

Dan, 13 October 2026: *"please can you look at the purchase orders - number 690000314. The
Timeline / Chat just says loading, but never loads. I wondered if there was a load issue, or
missing an index?"*

## What was wrong

Neither a slow load nor an index. Dan signed in to the browser pane, and the order's Timeline was
read there, read-only:

- **The server answered in 550ms**, with 200 and all 9 entries.
- **The page failed while drawing them.** An order released for the first time from Checking
  carries, as its release's `changes`, the summary its load recorded (`{ lines: 4, status: "active"
  }`). That is a count of lines, not a list of what changed.
- **`changeLines` then looped over `4`.** It threw *"number 4 is not iterable"*, confirmed against
  the page's own module in the browser. The throw stopped the whole feed, which stayed at
  *Loading…*.

Every order released for the first time from Checking was affected. The Timeline tests released
orders without that summary, so they never met it.

## What changed

- **vf-app:** a release carries what it changed, and never a first load's summary (an event of
  kind `loaded`).
- **vf-ui:** `changeLines` reads only lists as lists, and a status only as `{ from, to }`. So orders
  released before this deploy, whose entries are already like that, draw too.
- **vf-ui, for every Timeline (orders and receipts):** an entry whose words cannot be made is drawn
  with its label alone. The rest of the feed is still drawn, rather than stopping at *Loading…*.

## Tests

- **vf-ui browser** `order-timeline.test.ts`:
  - 690000314's own entries draw, with `changes: { lines: 4, status: "active" }` on the first
    release;
  - an entry that cannot be described is drawn plainly, and the next one still is.

  Both fail on the code before this change.
- **vf-app** `order-timeline.test.ts`: a first release has no `changes`. This also fails on the code
  before.
- **Related suites pass:** the full vf-ui browser suite, except the known `typography.test.ts` gap,
  and vf-app's order and receipt Timelines, orders out, confirmation, order sharing and orders (7
  files, 149 tests).

## To deploy

Deploy vf-app and vf-ui. No migrations. 690000314's Timeline loads once vf-ui is deployed; vf-app
stops sending the summary.
