# 0655: Receipts in — goods receipts arrive by a route

**Status: built and tested locally, not yet pushed or deployed.** It
touches `vf-app`, `vf-ui` and `vf-licence`. It needs **vf-app migration
`0144`** and **vf-licence migration `0297`** (strings). Apply both, then
deploy vf-licence, vf-app and vf-ui.

## What was asked

This is slice 5 of the Warehouse Receipts proposal (Goods Receipts level
3, agreed with Dan 6 October 2026): "A route delivering to the process:
HTTPS (JSON or our CSV, with an API key) and File import. Messages in
the Route monitor, with failures and retries." The proposal added:

- a new standard route whose version carries a **goods receipt** data
  model rather than EN 16931;
- every message is **stored first** and shows in the Route monitor
  beside invoice messages, **with what it made**;
- from 0653: **one upload is one route message**.

## What was built

### Two standard routes (vf-app migration `0144`)

| Route | Gateway | Use |
| --- | --- | --- |
| **Receipts in** (`receipts-in`) | HTTPS | A warehouse system posts with its source's key. |
| **Receipts upload** (`receipts-file`) | File import | Create's receipt CSV is one message of it. |

Both are live, version 1, with:

- `semantic_model` `goods_receipt`, its first use;
- translation `goods_receipt_v1`;
- delivery format `csv` (our receipt CSV, which every message is read
  into before it is checked);
- delivery gateway `process`.

The Routes library lists them, as it lists any standard route.

The migration also:

- adds **`goods_receipts.route_message_id`**: the message a receipt came
  in by. `route_message_items` names invoices only (a CHECK, 0106), so
  the receipt names its message instead;
- gives an already set-up Warehouse Receipts process its upload source,
  **Receipts upload** (`upload-warehouse-receipts`, file import), as an
  instance of Receipts upload. Setting the process up now makes it too.

### Sources on a goods receipt process

- `POST /processes/:id/sources` on a goods receipt process takes **HTTPS
  only**; anything else is refused with `receipts_https_only`.
- The source is an instance of **Receipts in**.
- No ERP Destination is added: Complete registers the receipt.
- Keys are made, replaced and revoked as for HTTPS in (0578–0581).
- Its address is `…/v1/sources/:id/receipts`, and the keys listing says
  `receives: "receipts"`.

### Receiving (`receipts-in-route.ts`)

**`POST /v1/sources/:id/receipts`** takes the source's key, and either:

- `application/json` in this shape:

      { "receipts": [ { "receiptNumber", "receiptDate", "deliveryNote"?,
        "lines": [ { "line"?, "orderNumber", "orderLine", "quantity",
                     "unit"?, "movement"?, "reason"?, "note"? } ] } ] }

  It is read into our CSV, one row per line; `line` defaults to the
  line's place in the list.
- or `text/csv` with our columns (0644).

`X-Reference` names the message. The rules:

- only a source on a goods receipt process takes receipts (404
  otherwise);
- a retired source refuses (410);
- a body that is not JSON (400), not receipts (400 `not_receipts`) or
  another type (415) is refused before anything is stored.

**`receiveReceipts`** is the path both routes share:

1. It **opens the message**: the source, the sender (key name or
   person), the subject, and the route (`route_messages.route_id`, set
   here for the first time).
2. It **stores the CSV** as part 1, in R2 where bound.
3. It loads the CSV through the process (pending, 0651). Each receipt
   names the message.
4. It sends each new receipt through the process, then **finishes the
   message**:
   - **delivered** when nothing was refused;
   - **partial** when some rows were;
   - **failed** at translation (`refused`) when every row was;
   - **failed** at format when the load refused the file outright
     (columns missing).

**A sender is not a person.** Its receipts:

- are checked against every order (`scope` null, since a receipt's unit
  is its order's);
- are recorded by nobody (`created_by` null), with the source naming
  who sent them.

The loader (`handleLoadGoodsReceiptsCsv`) now takes a null user, a
`scope` and a `routeMessageId`. The invoice re-check (0648) takes a null
actor too, so goods that arrive by a route still move waiting invoices
on, as do the task follow-up and the PO-load release.

**The answer** is 202 with what each receipt became:

- registered;
- or pending at a stage, with lines waiting for their order.

It also gives refused rows, warnings and a `check` address. It is 422
when nothing loaded. `GET /v1/sources/:id/messages/:message` gives the
same answer later, for that source's keys only.

### Create's upload is a message

`POST /goods-receipts/csv-load?name=` works this way once the process
has its upload source:

- it goes through `receiveReceipts` on **Receipts upload**, from the
  person ("Sam Ward <email>"), with the subject "Upload of <file>";
- the response adds the `messageId`;
- Create sends the file's name and says "Route monitor message: MSG-…".

Without the process, the load is as before.

### The Route monitor

- **The list** counts each message's receipts and those still pending,
  and says "Goods receipts: 3 · waiting: 1".
- **Filters:** Receipts in and Receipts upload sources can be chosen.
- **The detail** lists the receipts, each Registered or "Waiting at
  Matching".
- **Run again (0559) is refused for a receipts message**
  (`receipts_resend`), because running again reads invoices. The words
  say to send the receipts again instead: receipts and lines already
  loaded are skipped, so a resend is safe.

### Process routes and the source panel

- **A goods receipt process:**
  - offers **Add a source**, with HTTPS as its only mechanism;
  - its note now says receipts come from Create and from warehouse
    systems by Receipts in, and that it has no destinations.
- **A receipts source:**
  - shows no Business unit picker, since a receipt's unit is its
    order's;
  - its **How to send** shows a JSON `curl` example for receipts, with
    the matching hint.

### Words (vf-licence `0297`)

Seven keys, in English and German, plus the updated note on a goods
receipt process.

## Not in this decision

**File import from an SFTP folder** for receipts waits for the SFTP
worker (parked, 0620). Receipts upload is the File import route that
exists now: Create's upload.

## Verification

- **`vf-app`** `receipts-in.test.ts`, 6 tests:
  - **The routes and their sources:**
    - both routes are live with the goods receipt model;
    - the process has its upload source as an instance of Receipts
      upload;
    - an email source is refused with `receipts_https_only`;
    - an HTTPS source is an instance of Receipts in, with no ERP
      Destination;
    - the keys listing gives the receipts address.
  - **JSON into CSV:** a delivery note with a comma is quoted, and `line`
    defaults to the line's place; an empty list and a receipt with no
    lines are refused.
  - **HTTPS end to end:**
    - 202, `delivered`, with the reference;
    - WH-1 registered, and WH-2 pending at Matching with one line
      waiting for its order;
    - the message carries its source, route, sender and recipient, and
      the receipts name it, recorded by nobody;
    - only what is registered counts;
    - asking again gives the same answer;
    - the monitor list counts receipts 2, waiting 1, and offers the
      source;
    - the detail lists both receipts.
  - **Our CSV:** a refused row makes the message partial; every row
    refused fails it at translation (`refused`, 422). That failed message
    can't be run again (`receipts_resend`).
  - **Refusals:** no live key (401); not JSON (400); a PDF (415);
    `not_receipts`; an invoice process's HTTPS source (404).
  - **Create's upload:** one message on Receipts upload, from "Sam
    <s@x.com>", "Upload of week-40.csv", delivered, its receipt naming
    it and recorded by Sam.
- **Changed expectations:**
  - `routes.test.ts` lists the two new routes;
  - 0651's test now expects `receipts_https_only` for an email source on
    the process.
- **`vf-ui`** browser:
  - `routes.test.ts`:
    - a goods receipt process offers Add a source with HTTPS only;
    - a receipts source shows its receipts address and a JSON example;
  - `route-monitor.test.ts`: the receipts line, and the detail's receipts
    with where each stands. The test now reads the receipts strings from
    their migrations;
  - `goods-receipts.test.ts`: Create sends the file's name and shows the
    message.
- **Screenshots** of the Warehouse Receipts process with its two sources
  and the Receipts in panel, and the Route monitor with a receipts
  message and an upload, in Day and Night. These led to:
  - the Business unit picker being hidden for receipts;
  - the process note being brought up to date.
- **Changed during the full run:** `index.test.ts` counted 8 routes, now
  10. It is fixed.
- **Full runs**:
  - vf-app 3666, of which 3662 pass: the two known failures, plus two
    that changed while the run was going. One is that route count. The
    other is the Run again check, whose test reached the run before its
    source did. `index.test.ts`, `receipts-in.test.ts` and
    `route-fix.test.ts` were run again whole: 253 of 253;
  - vf-ui browser 1593, of which 1592 pass (the known
    `typography.test.ts` 10px gap);
  - vf-ui worker 111 of 111;
  - vf-licence 362 of 362;
  - migrations replay to vf-app 144 and vf-licence 297.
