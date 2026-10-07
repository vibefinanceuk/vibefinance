# 0658: A goods receipt's Timeline and Chat, with the Warehouse

**Status: built and tested locally, not yet pushed or deployed.** It
touches `vf-app`, `vf-ui` and `vf-licence`. It needs **vf-app migration
`0146`** and **vf-licence migration `0300`** (strings). Apply both, then
deploy vf-licence, vf-app and vf-ui.

To bring the Warehouse in, an administrator gives warehouse staff a role
holding the new **Warehouse.Collaborate** permission. A Warehouse team
in Access Control lets AP add them all at once.

## What was asked

Dan, 7 October 2026, after 0657:

> I think this UI would benefit from a Timeline / Chat, like we have
> implemented in the Invoice viewer. This logs all decisions, and
> changes. Also provides an opportunity for AP to add the Warehouse
> team to the chat and resolve any discrepancy.

His answers to the questions asked:

| Question | Dan's answer |
| --- | --- |
| Who can be added | **People or a whole team.** Everyone added sees that receipt and posts, through a new Warehouse.Collaborate permission, without AP.Receive. |
| Notifications | **Email when added, and on each new post.** |
| Slicing | Two slices: 0657 first, then this one. |

While this was being built he added:

> The Timeline / Chat should be a panel on the right of the page, same
> as the invoice viewer / Document window. the pop-out can be widened
> to accommodate this.

## What was built

### Tables (vf-app migration `0146`)

The tables are receipt-specific. Each keeps a real foreign key to
`goods_receipts`, as `document_comments` and `invoice_collaborators` do
to invoices.

| Table | Holds |
| --- | --- |
| `goods_receipt_events` | What the receipt's own columns cannot say, as `kind`, `actor_id`, `line_number` and `detail_json`. `kind` is an open list with no CHECK, so a new kind needs no rebuild. |
| `goods_receipt_comments` | The conversation. |
| `goods_receipt_collaborators` | A person or a team (a CHECK makes it exactly one), with who added it and when. Removing sets `removed_at` and `removed_by` and keeps the row. Partial unique indexes allow each person or team in once at a time. |

### Warehouse.Collaborate (`permissions.ts`)

"See a goods receipt you or your team were added to, and post to its
chat." It is granted to nobody. Like Procurement.Collaborate, it is
checked against the receipt's own collaborators and is never derived.

**Who may do what** (`receiptAccess`):

| Who | Read and post | Add and remove people |
| --- | --- | --- |
| AP.Receive where the receipt's orders are | ✓ | ✓ |
| AP.Validate there | ✓ | |
| Warehouse.Collaborate, added by name or through a team | ✓ (that receipt only) | |
| Anyone else | 404, as for a receipt outside one's units | |

A collaborator never gets the receipt's actions. Fixing, Register and
Reject stay AP.Receive and need the claimed task (0657).

**Where a collaborator sees the receipt:**

- **`GET /goods-receipts`** includes the receipts a Warehouse.Collaborate
  holder is in, beside whatever their units show. For someone who holds
  nothing else, it shows only those receipts. `kind=conversations`
  narrows anyone's list to them.
- **`GET /goods-receipts/:id`** opens for a collaborator wherever the
  receipt's orders are.

### The Timeline (`receipt-timeline.ts`, `GET /goods-receipts/:id/timeline`)

Oldest first, as a conversation reads. Each item has `kind`, `at` (ISO),
`by`, and `detail` or `body`. Items come from four places.

**From the receipt's own columns:**

- **`received`:** how it came in (file, screen, or a route message with
  its source), how many lines, and from whom.
- **`registered`:** how it was registered:
  - by **Register**, naming who;
  - by **an order's load**, naming the orders and who loaded them;
  - by **every line matching**;
  - when **recorded on the screen**.

  A partial registration (0654) says so.
- **`rejected`** and **`cancelled`**, each with who and why.

**From the process:**

- **`stopped`:** the Matching task, with its stage and team.
- **`claimed`, `released` and `reassigned`:** from `task_action_events`
  (0488).

**From `goods_receipt_events`**, written where each thing happens:

| Kind | Written by |
| --- | --- |
| `line_corrected` | the fix (0657), from and to |
| `line_repointed` | the fix, from and to |
| `line_rejected` | the fix, with the reason |
| `lines_released` | `releaseWaitingReceipts` (0654): how many lines, which orders, by whom, and whether they now count on a registered receipt |
| `collaborator_added`, `collaborator_removed` | the collaborator routes |

**And the comments**, each with `mine`.

Events are written before the receipt's own registered or rejected line
in the same moment. A line counted by an order's load is therefore shown
before "registered when … loaded".

Receipts from before this decision show only what the columns and the
process say.

### People and teams

**`GET /goods-receipts/:id/people?q=`** (AP.Receive) returns:

- active people, each with `canSee`: whether they hold
  Warehouse.Collaborate, AP.Receive or AP.Validate anywhere;
- teams, with their member counts.

**`POST /goods-receipts/:id/collaborators`** takes `{ userId }` or
`{ teamId }`:

- A person who could not open the receipt is refused with 422
  `cannot_see`, naming them. The fix is to give them
  Warehouse.Collaborate.
- A team is added as it is. Its members who can open the receipt get
  access and the email.
- Adding someone already in returns `added: false`. Nothing changes and
  no email is sent.

**`DELETE /goods-receipts/:id/collaborators/:id`** ends the row. The
person's access ends with it.

### The conversation and its email

**`POST /goods-receipts/:id/comments`** takes `{ body }`. Anyone who may
see the receipt may post. A message is at most 4000 characters, and an
empty or too-long one is refused.

**Who is emailed** through Resend (0498), one send each:

- **On adding:** the person added, or the team's members who can open
  the receipt. The email quotes the latest message.
- **On each post**, everyone in the conversation except the author:
  - the people added, and the members of the teams added;
  - whoever holds the receipt's open task;
  - anyone who has written in it.

  Only those who could open the receipt are emailed, at most 50 at a
  time.

**What the email says:**

- the subject names the receipt and who did what;
- the message is quoted;
- **Open the receipt** links to `<app>/?receipt=<id>`;
- it is written in the reader's language (English or German, from
  `org_users.locale`).

**When sending fails or is not set up:**

- A send that fails is counted. It never undoes the post.
- Without Resend set up, nothing is sent, and the response says
  `emailReady: false`.

**The link:** `tasks.js` opens the receipt's pop-out from `?receipt=` on
start, then clears it from the address.

### The pop-out (vf-ui)

The receipt's pop-out is now widened to `min(1440px, 96vw)` and split in
two:

- **On the left:** the receipt, scrolling.
- **On the right:** a **Timeline and conversation** panel, as in the
  invoice viewer and Document window. It keeps the pop-out's height,
  its feed scrolls, and the box to write in stays at the bottom. On a
  narrow screen the panel stacks under the receipt.

The panel (`receipt-timeline.js`) uses the invoice Timeline's own
classes (`collabbar`, `collabchip`, `activityfeed`, `activitycomment`,
`activitysysline`), so the two read alike. It has:

- **chips** for the people and teams in the conversation. A team shows
  as "Warehouse (team, 3)" with a team icon. A remove button appears
  for AP.Receive only;
- **Add a person or team** (AP.Receive): search people and teams. A
  person who could not open the receipt is shown, greyed out, with
  "Needs Warehouse.Collaborate to open receipts";
- **the feed**, in words: "Sam Ward corrected line 3 from 10 BOX to 80
  EA." Comments appear as bubbles;
- **the box and Post**, then "Emailed: 2.";
- **refusals in words**: "Pete could not open this receipt. Give them
  Warehouse.Collaborate first."

Unlike activity.js, the module keeps its state per call, so a receipt
opened again starts clean.

**For the Warehouse:**

- Goods Receipts is in the menu for Warehouse.Collaborate, and is their
  first screen.
- Someone who holds only that permission sees **Receipts you are in a
  conversation about**, with no chart, loader or recording.
- The pop-out gives them the receipt and the conversation, with no
  actions.

The vf-ui proxy allows the five new paths.

### Words (vf-licence `0300`)

Fifty-two keys, in English and German:

- every Timeline line;
- the panel's controls;
- four refusals;
- the Warehouse's list.

The email's own words are in `receipt-timeline.ts`, as the agents'
emails keep theirs (0623).

## Verification

- **`vf-app`** `receipt-timeline.test.ts`, 7 tests:
  - **From arriving to registered:**
    - received by Sam from a file (3 lines);
    - stopped at Matching for AP Receiving;
    - claimed;
    - line 3 corrected from 2 BOX to 24 EA;
    - line 2 re-pointed from 9 to 1, then rejected ("Counted twice");
    - registered by Sam;
    - every `at` is ISO.
  - **An order's load:** after a claim and release, Vic loads PO-800.
    The Timeline shows "lines found their order" (1, by Vic), then
    "registered when Vic loaded PO-800".
  - **Adding a person:**
    - the search returns Wendy (can see) and Will (cannot), and the
      Warehouse team (2);
    - Pete is refused with `cannot_see`;
    - Wendy is added and emailed once, in German, with the latest
      message and the link;
    - adding her again changes nothing and sends nothing.
  - **Adding a team:**
    - only Wendy is emailed: Will cannot see, and Sam added it;
    - Wendy opens the receipt through the team;
    - Vic (AP.Validate) may read but not manage (`cannot_manage`);
    - after removal Wendy gets 404 on the receipt and its Timeline, and
      the Timeline ends with added and removed.
  - **The Warehouse's list and posting:**
    - Wendy's list holds only WH-1, while Sam's holds both receipts;
    - empty and 4001-character messages are refused;
    - Wendy's post emails Sam (the task holder) only;
    - her comment is `mine`;
    - Will gets 404;
    - without Resend the post stands with `emailReady: false`.
  - **Through the router, with Wendy's key:**
    - receipt, list, Timeline and post succeed;
    - a line fix, adding people, the people search and status counts
      are each refused with 403.
  - **The email**, in English and German: the subject, the plain text
    exactly, HTML escaped, and no link without an address.
- **`vf-ui`** browser `receipt-timeline.test.ts`, 6 tests:
  - **The Timeline in words:**
    - every line reads as above, oldest first;
    - mine and theirs are told apart;
    - the team chip reads "Warehouse (team, 3)";
    - the panel sits in `.receiptside` on the right of a
      `.popout.receiptpop`, not in the receipt column.
  - **Posting:** the message is sent trimmed, the box is cleared, the
    Timeline reloads and "Emailed: 2." is shown.
  - **Adding:**
    - the search sends `q=wa`;
    - Will is disabled with the reason, and Wendy is not;
    - the team is added with `{ teamId }`, then "Emailed: 3.".
  - **Refusals and removing:** the `cannot_see` refusal reads in words,
    and a team is removed with DELETE.
  - **The Warehouse:**
    - it lands on Goods Receipts, reading "Receipts you are in a
      conversation about";
    - no status counts or process are fetched;
    - the pop-out has the box but no Add, remove or Register.
  - **The email's link:** `?receipt=wh-1` opens the pop-out and is
    cleared from the address.
- `vf-ui` worker `index.test.ts` passes the five new paths.
- **Screenshots** of the pop-out, AP's view and the Warehouse's, in Day
  and Night. These led to:
  - an empty slot being written as "null", fixed;
  - the panel moving to the right, as Dan asked, and widening;
  - Timeline lines wrapping under their dot in the narrow panel.
- **Full runs**:
  - vf-app 3684, of which 3681 pass: the two known failures, plus
    `index.test.ts` "need Admin.Configure, and say what is missing",
    the 5-second timeout under load seen in 0657;
  - vf-ui browser 1604, of which 1603 pass (the known
    `typography.test.ts` 10px gap);
  - vf-ui worker 111 of 111;
  - vf-licence 362 of 362;
  - migrations replay to vf-app 146 and vf-licence 300.
