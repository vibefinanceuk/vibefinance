# 0651: Receipts count once registered, and the Warehouse Receipts process

**Status: built and tested locally, not yet pushed or deployed.** It
touches `vf-app`, `vf-ui` and `vf-licence`. It needs **vf-app migration
`0141`** and **vf-licence migration `0293`** (strings). Apply both, then
deploy vf-licence, vf-app and vf-ui.

## What was asked

This is slice 2 of the Warehouse Receipts proposal (Goods Receipts level
3, artifact *Warehouse Receipts*, 6 October 2026), agreed with Dan:

- **receipts become pending until registered**: a `status` on a receipt
  (pending, registered, rejected), and only registered ones counted;
- **the Warehouse Receipts process**, with Intake, Matching and Complete,
  and a goods receipt as a process subject;
- **existing receipts are registered by the migration.**

Dan also agreed that a receipt CSV goes through the process, as invoice
import goes through the workflow, while a receipt keyed by hand stays
direct. Slice 3 adds the built-in Matching check, the AP Receiving task,
the receipt pop-out for fixing lines and Create → Goods receipts.

## What was built

### Status (vf-app migration `0141`)

- `goods_receipts` gains these columns:
  - `status`: pending, registered or rejected, default registered;
  - `registered_at`;
  - `rejected_at`, `rejected_by` and `reject_reason`.
- Every receipt already on file is registered, at the time it was
  recorded.
- A receipt keyed on the screen is registered at once, as before.

**Only registered receipts count.** The status is now checked
everywhere receipts are added up:

- what is held on a line (`heldByLine`), which drives the order's
  figures, the record form and the return check;
- the receipt state on Purchase Orders and the chart
  (`receiptStateJoin`);
- credit expected in the counts;
- the receipt facts for matching (`mergeReceiptFacts`, 0647);
- GRNI (0650).

**Rejecting** (`POST /goods-receipts/:id/reject`):

- It needs AP.Receive, in the units of the orders the receipt names
  (404 outside them).
- It needs a reason.
- Only a pending receipt can be rejected. A registered one is
  cancelled, as before. Cancelling is refused for a pending receipt
  ("reject it instead") and for a rejected one.
- The receipt's process instance ends as `rejected`, and any task open
  on it is cancelled (`end_reason` `receipt_rejected`).
- A CSV row adding a line to a rejected receipt is refused.

### What a process moves

- `processes` gains `subject_type`, default `invoice`.
- Supplier Maintenance (0350) is set to `supplier`.
- There is no list of allowed values: the engine never needed one
  (0015), and expense reports (0022) are moved by processes too.

A process that does not move invoices does not take invoice routes:

- creating a source on it is refused (`process_not_invoices`), and so
  is a destination;
- it is not offered for uploads;
- it is not offered in the connector library.

Process routes shows such a process as **Moves goods receipts**, with a
note and no Add buttons.

### The Warehouse Receipts process (`warehouse-receipts.ts`)

- **Set up on request, with a known id**, as Supplier Maintenance is:
  `warehouse-receipts`.
  - `POST /goods-receipts/process` needs Admin.Configure.
  - It creates the process (`subject_type` `goods_receipt`), the stages
    Intake, Matching and Complete in version 1, and makes Intake the
    entry and Complete the exit.
  - The screen sends the names in the person's language.
  - Asking again changes nothing.
- `GET /goods-receipts/process` says whether it is set up.
- **Until it is set up, nothing changes**: a CSV load registers at once.

**A CSV load once it is set up** (`/goods-receipts/csv-load`):

- A new receipt is stored as **pending**.
- Each receipt gets its own instance, visiting Intake, then onwards.
- One that reaches the end (completed) is **registered**.
- Only registered receipts' orders go to the re-check of invoices
  waiting on goods (0648), so a waiting invoice moves on only when the
  goods count.
- The response says where each receipt went: `process.sent`, each
  registered or pending with its stage.

Matching has no rules yet, so today every receipt passes straight
through. A stage that stops one (a rule raising a task) leaves it
pending there, and the pop-out says so.

**After a task on a receipt** (index.ts):

- `followUpAfterTaskCompletion` now handles a goods receipt. It
  continues the instance and registers the receipt when the instance
  completes, then runs the re-check.
- Completing the last task can complete the instance in the cascade
  itself, with no stage left to evaluate. The task route then calls
  the follow-up for a receipt's instance too.
- This is in place for slice 3's task.

### The screen (vf-ui `goods-receipts.js`)

- **Load receipts** says where a CSV goes:
  - *register at once*, with **Set up Warehouse Receipts** for
    Admin.Configure;
  - or *go through Warehouse Receipts and count once registered*.
- After a load it says "Sent through Warehouse Receipts. Registered: n.
  Waiting: n."
- The list:
  - a **Pending** or **Rejected** pill;
  - Pending and Rejected filters;
  - a rejected receipt is dimmed.
- The pop-out:
  - a pending receipt says where it waits ("Pending at Matching in
    Warehouse Receipts: it counts once registered.") and offers
    **Reject receipt** with a reason, not Cancel;
  - a rejected one says who rejected it and why;
  - a registered one shows when it was registered.
- vf-ui passes `/goods-receipts/process` and `/goods-receipts/:id/reject`
  through.

### Words (vf-licence `0293`)

Thirty-two keys, in English and German.

## Verification

- **`vf-app`** `warehouse-receipts.test.ts`, 10 tests:
  - **Keyed and direct receipts:** a keyed receipt is registered and
    stamped; a CSV load without the process registers at once.
  - **A pending receipt does not count:** it is not held, not in the
    order's figures, and not in GRNI.
  - **Listing and cancelling:** pending ones are listed and shown as
    pending; cancelling a pending one is refused.
  - **Rejecting:**
    - the reason is required;
    - who, when and why are recorded;
    - rejecting twice, cancelling a rejected receipt and rejecting a
      registered one are each refused;
    - a CSV cannot add to a rejected receipt.
  - **Setting up the process:** stages, names, entry and exit,
    `subject_type`; asking again changes nothing.
  - **Invoice routes refused:** no invoice source; not offered for
    uploads.
  - **Through the process:** one instance per receipt, visiting Intake,
    Matching and Complete, then registered and stamped.
  - **Stopped by a rule:** a rule on Matching leaves the receipt pending
    there, with no re-check; rejecting it ends the instance and cancels
    the task.
  - **Completing the last task** (claim and complete through the router)
    registers it. This test fails without the task route's follow-up.
  - **Through the router:**
    - Admin.Configure only for setting up;
    - a CSV load registers WH-9, closes INV-A's *Awaiting receipt* task
      and completes its instance;
    - rejecting a registered receipt is refused.
- The related suites pass: goods receipts, re-check, receipt facts,
  GRNI, purchase orders, sources, upload, routes, connector library,
  processes, expense process and tasks, 294 of 294.
- **`vf-ui`** browser:
  - `goods-receipts.test.ts` gains 3 tests:
    - setting up from the screen, and the line before and after;
    - no set-up button without Admin.Configure, and the sent line;
    - a pending receipt's pill, where it waits, no Cancel, and Reject
      with a reason;
  - `routes.test.ts` gains 1 test: a goods receipt process on Process
    routes.
- **Screenshots**: the screen before and after set-up, and a pending
  receipt being rejected, in Day and Night.
- **Full runs**:
  - vf-app 3648, of which 3646 pass (the two known failures);
  - vf-ui browser 1582, of which 1581 pass (the known
    `typography.test.ts` 10px gap), with the same 331 unhandled errors;
  - vf-ui worker 111 of 111;
  - vf-licence 362 of 362;
  - migrations replay to vf-app 141 and vf-licence 293.
