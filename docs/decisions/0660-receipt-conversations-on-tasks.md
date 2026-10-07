# 0660: Conversations on Tasks

**Status: built and tested locally, not yet pushed or deployed.** It
touches `vf-app`, `vf-ui` and `vf-licence`. It needs **vf-app migration
`0147`** and **vf-licence migration `0302`** (strings). It ships in the
same bundle as 0659.

## What was asked

Dan, 7 October 2026:

> When adding a user to the chat, they will receive an email, but
> otherwise would not know that they have been added. I would like to
> see similar behaviour to the Agents alert in the task manager which
> launches a new section. We could also have a section indicating that
> the user has been added to a Chat here. Could you mock-up how that
> would look?

I sent a mock-up of a **Conversations** section at the top of Tasks in
Day and Night. Dan: "Yes, I really like the mock-up". Then, while it was
being built:

> Can you give the message window in the Tasks page a maximum height,
> and introduce a scroll bar on message if it exceeds 3 or 4 messages in
> depth. This means the user can still see tasks that they need to work
> on.

## What was built

### Catching up (vf-app migration `0147`)

**`goods_receipt_reads`** holds, per receipt and person, when they last
caught up (`seen_at`). Two things move it on:

- opening the receipt's Timeline / Chat (`handleGetReceiptTimeline`
  marks it);
- **Done** on the section.

### What is new for a person (`GET /receipt-conversations`)

**Who sees a receipt here** is the same group the email reaches (0658):

- people added by name, or as members of a team that was added;
- whoever added people;
- whoever has written in the conversation;
- the holder of the receipt's open task, once there are messages.

A receipt they may not see (`receiptAccess`) is left out.

**A row is shown when either:**

- **they were added** (by name or through a team, by someone else) after
  they last caught up. The row says by whom, through which team, and
  when; or
- **others wrote** after they last caught up (or after they were added,
  if they never have). The row says how many.

**Each row carries:**

- the receipt number;
- the organisation, supplier and orders (`receiptContext`, 0659);
- the latest message, cut at 280 characters.

**Order:** newest first, at most 50.

**`POST /receipt-conversations/:id/done`** catches the person up. A
receipt they cannot see gets 404.

Both routes are open to any signed-in person.

### The section (vf-ui `receipt-conversations.js`)

It is built as the agents' section is (0622), from the agreed mock-up.

**Where it appears:**

- **At the top of Tasks**, above the agents' notes.
- **At the top of Goods Receipts** for someone who holds only
  Warehouse.Collaborate (0658), who has no Tasks screen.

It is hidden when nothing is new.

**Each row has:**

- the title *Goods receipt WH-S-1002 · Acme UK Ltd*;
- a pill saying **Added to chat** or **New messages**, with **New
  messages: n** beside it;
- who added them, when, the supplier and the orders;
- the latest message, quoted;
- **Open:** catches up, then opens the receipt's pop-out on its
  Timeline / Chat;
- **Done:** catches up without opening it.

**Spacing:** 16px below the section, so it does not touch the task
search (Dan, from the mock-up).

**Height:** about four rows show; more scroll inside the section
(`max-height: 23rem`), so the tasks below stay in view, as Dan asked.

**The menu count** sits on Tasks, or on Goods Receipts for the
Warehouse:

- `setNavBadge` in `tasks.js` keeps it, so a menu drawn again keeps it
  too;
- with the menu collapsed it is a dot.

The vf-ui proxy passes both paths.

### Words (vf-licence `0302`)

Thirteen keys, in English and German.

## Verification

- **`vf-app`** `receipt-timeline.test.ts` gains 3 tests:
  - **Added, then caught up, then new messages:**
    - Wendy, added by Sam after his question, sees *added by Sam*,
      no new messages, and his question quoted. Sam sees nothing;
    - opening the Timeline clears it;
    - her reply is new for Sam (who added her), until he presses Done.
  - **Through a team:**
    - it says *Warehouse*, with 2 new messages;
    - Will (in the team but unable to open receipts) sees nothing;
    - after Done, one new message brings it back without *added*;
    - once the team is removed it is gone, and Done gets 404.
  - **Through the router** with Wendy's key: listed, Done, empty
    afterwards, and 401 signed out.
- **`vf-ui`** browser `receipt-conversations.test.ts`, 5 tests:
  - **The rows:**
    - newest first;
    - pills *New messages* / *New messages: 2* and *Added to chat* /
      *New messages: 1*;
    - the quote, the supplier and orders, and *added you (through the
      Warehouse team)*;
    - the menu count is 2.
  - **Done** takes a row off, and the count goes to 1. **Open** posts
    Done and opens the receipt.
  - **Nothing new:** the section is hidden and there is no count.
  - **Seven rows:** the list scrolls, with a maximum height of 23rem,
    and the section has 16px below it.
  - **The Warehouse:** the section is on Goods Receipts, with the count
    there.
- **Screenshots** of Tasks with two conversations, and with seven
  (scrolling), in Day and Night. These led to the menu count sitting
  inside the item rather than off its edge.
- **Full runs**, with 0659:
  - vf-app 3691, of which 3688 pass: the two known failures, plus the
    `index.test.ts` timeout under load (0657);
  - vf-ui browser 1610, of which 1609 pass (the known
    `typography.test.ts` 10px gap);
  - vf-ui worker 111 of 111;
  - vf-licence 362 of 362;
  - migrations replay to vf-app 147 and vf-licence 302.
