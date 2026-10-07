# 0657: Claim a receipt's task before acting, and correct a line's unit and quantity

**Status: built and tested locally, not yet pushed or deployed.** It
touches `vf-app`, `vf-ui` and `vf-licence`. It needs **vf-app migration
`0145`** and **vf-licence migration `0299`** (strings). Apply both, then
deploy vf-licence, vf-app and vf-ui.

## What was asked

Dan tried the sample receipt files (7 October 2026) and found two gaps
in the receipt pop-out at Matching (0652):

1. **"The Warehouse Receipt task also lets me act on the task without it
   being claimed."** An invoice's task has to be claimed before anyone
   completes it (0104). A receipt's fixes, Register and Reject did not
   check this, and Register claimed the task on its way through.
2. **Line 3 of `02-needs-attention.csv`** (2 BOX against an order line
   in EA) failed with "The unit is not the order line's unit", but the
   pop-out did not show the order line's unit. The only fix offered was
   pointing the line at another order line, or rejecting it.

Dan agreed to do these first, as their own slice, before the receipt
Timeline and Chat (0658).

## What was built

### Claim before acting (`warehouse-receipts.ts`)

**`receiptTaskRefusal`** checks the open task on the receipt's instance
in progress. It applies the same rule as completing a task:

- a task for a named person: only that person may act (403
  `task_not_yours`);
- a team's task, unclaimed: 409 `task_not_claimed`;
- a team's task claimed by someone else: 403 `task_claimed_by_other`,
  with their name.

It guards:

- fixing a line (re-pointing it, correcting it, or rejecting it);
- Register;
- Reject receipt (while pending).

There is nothing to claim, and so nothing to refuse, when no task is
open. That happens in two cases:

- a pending receipt with no process;
- a line held back on a registered receipt (0654).

**Register no longer claims the task.** It completes the task in the
holder's name, as before.

Claiming and releasing use the existing `/tasks/:id/claim` and
`/release` routes. These already check the task's permission
(AP.Receive) and membership of its team (AP Receiving).

### The pop-out says who holds the task

`GET /goods-receipts/:id` gains `task`, or null when nothing is open on
the receipt:

| Field | |
| --- | --- |
| `id` | the open task |
| `claimedBy`, `claimedAt` | who holds it |
| `mine` | the person holds it, or it is theirs by name |
| `canClaim` | unclaimed, and the person is in its team |
| `canRelease` | the person holds the claim |

The pop-out shows one line about the task:

- **Nobody has claimed it:** the line says so, with **Claim**.
- **Someone else has claimed it:** the line names them, with no
  actions.
- **The person holds it:** the line says so, with **Release**.

The fix rows, Register and Reject receipt are shown only to the task's
holder.

### Each line shows its order line

Under each `order / line` the pop-out now shows:

- the order line's item and what was ordered, in which unit
  (*Bubble wrap roll · ordered 50 EA*);
- *Not a line on this order* when the line number does not exist.

The data was already in the receipt's `orders` (0645). It was not shown
beside the line.

### Correcting the unit and quantity

`POST /goods-receipts/:id/lines/:line` now also takes
`{ unitCode, quantity }`:

- **Together or alone.** Either or both can be sent, with or without a
  new order line. The pop-out sends only what changed. Correcting both
  together matters, because a unit changed alone would count the wrong
  amount (2 BOX is 24 EA, not 2).
- **Validation.**
  - The unit is a short code, upper-cased. Anything else is refused
    with 400 `unit_invalid`.
  - The quantity is a number above nought. Anything else is refused
    with 400 `quantity_invalid`.
- **What was sent is kept** (vf-app migration `0145`).
  - The first correction keeps what the warehouse sent in
    `original_unit_code` and `original_quantity`. Later corrections keep
    that first original.
  - `corrected_by` and `corrected_at` say who corrected the line, and
    when.
- **The receipt shows it.** The receipt's lines gain `correction`
  (`{ unitCode, quantity, by, at }`, or null). The pop-out shows *Was 2
  BOX, corrected by Sam Ward* under the quantity.
- **The line is checked again**, as with any fix. A correction also
  settles a return that exceeds what was received, by correcting its
  quantity.

The fix row gains **Quantity** and **Unit** fields beside Order and
Order line. All are filled in with the line's current values.

### Words (vf-licence `0299`)

Fifteen keys, in English and German:

- the task line and its buttons;
- Quantity and Unit;
- the order line and correction notes;
- four error reasons.

## Verification

- **`vf-app`** `warehouse-receipts.test.ts` gains 4 tests:
  - **Claim before acting:**
    - unclaimed, a fix, a line rejection, Register and Reject are each
      refused with `task_not_claimed`, and nothing changes;
    - once Sam claims, the receipt shows Sam's claim to Sam (`mine`,
      `canRelease`) and to Ann (neither). Ann's fix is refused with
      `task_claimed_by_other`, naming Sam;
    - Sam fixes and registers, and the task is completed by Sam.
  - **Through the router:**
    - the fix is refused while the task is unclaimed;
    - the receipt offers Claim, and once claimed the fix goes through;
    - after Release, Register is refused again.
  - **2 BOX to 24 EA:**
    - the line shows its order line (Bubble wrap, 500 EA);
    - `E A` is refused as `unit_invalid`, and "lots" as
      `quantity_invalid`;
    - `ea` and 24 clear the check, and the receipt shows the
      correction by Sam;
    - a second correction to 20 keeps 2 BOX as the original;
    - it registers 20.
  - **A return of 50 against 10 received:** correcting the quantity to
    5 clears `return_exceeds_received`.
- **Changed expectations:** six 0651, 0652 and 0654 tests now claim the
  receipt's task before they act on it.
- **`vf-ui`** browser `goods-receipts.test.ts` gains 3 tests:
  - **Unclaimed:**
    - the task line and Claim are shown;
    - there are no fix rows, Register or Reject;
    - the order lines read "Bubble wrap roll · ordered 50 EA" and "Not
      a line on this order";
    - Claim posts and the pop-out opens again.
  - **Claimed by Ann:** the line names her, with no actions.
  - **Held by the person:**
    - Release is shown;
    - changing BOX to `ea` and the quantity to 24 sends only
      `{ unitCode, quantity }`;
    - a corrected line reads "Was 2 BOX, corrected by Sam".
- **Screenshots** of the pop-out, unclaimed and held, in Day and Night.
  These led to:
  - the task line being one plain line, not a panel;
  - the correction note wrapping under the quantity.
- **Full runs**:
  - vf-app 3677, of which 3674 pass: the two known failures, plus
    `index.test.ts` "need Admin.Configure, and say what is missing",
    which hit its 5-second timeout under load and passes run alone;
  - vf-ui browser 1598, of which 1597 pass (the known
    `typography.test.ts` 10px gap);
  - vf-ui worker 111 of 111;
  - vf-licence 362 of 362;
  - migrations replay to vf-app 145 and vf-licence 299.
