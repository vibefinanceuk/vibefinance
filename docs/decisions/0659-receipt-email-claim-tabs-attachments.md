# 0659: A receipt's email names its organisation; Claim and Release top right; Timeline / Chat and Attachments as tabs

**Status: built and tested locally, not yet pushed or deployed.** It
touches `vf-app`, `vf-ui` and `vf-licence`. It needs **vf-licence
migration `0301`** (strings) and no vf-app migration. It ships in the
same bundle as 0660.

## What was asked

Dan, 7 October 2026, after trying 0658:

1. "The email body is very generic, and although says who it is from,
   it does not specify the Organisation."
2. (Conversations on Tasks: decision 0660.)
3. "In the GR task screen, the Claim button is inconsistent with others.
   Please could you give it an icon, and place in the top right, to the
   left of the Close icon. Also, the same principle for the Release
   button."
4. "Change the 'Timeline and conversation' heading to read 'Timeline /
   Chat <count>' similar to the same panel in the document viewer. The
   'Timeline / Chat' should be in a pillbox and highlighted."
5. "Include an Attachments tab next to 'Timeline / Chat', with any
   associated attachments received from the Source Route / Import."

## What was built

### 1. The email says which receipt, for which organisation (`receipt-timeline.ts`)

**`receiptContext`** works out, from the receipt's active lines:

- **The organisation:** the legal entity of the units its orders belong
  to, found by walking up `parent_unit_id`. Where the order's unit is an
  operating unit beneath that entity, the unit is named in brackets:
  *Acme UK Ltd (Manchester DC)*. Orders with no unit are everyone's
  (0375), and then the one legal entity is named, if there is just one.
- **The supplier and the orders.**
- **The delivery note and the receipt date.**

Every email, on adding and on posting:

- **The subject begins with the organisation:** *[Acme UK Ltd
  (Manchester DC)] Goods receipt WH-1: Wendy wrote*.
- **The body lists the context:** Organisation, Supplier, Purchase
  order, Delivery note and Receipt date, as lines in the text and a
  small table in the HTML, in the reader's language. A blank one is left
  out.

**A post now also goes to whoever added people to the conversation.**
Before this, the person who brought the Warehouse in heard nothing when
the Warehouse replied, unless they held the task or had written in the
chat themselves.

### 3. Claim and Release, top right (vf-ui `goods-receipts.js`)

- **They are now action links with their icons** (`claim`, `release`),
  among the pop-out's actions, just left of **Close**, as the invoice
  viewer's are.
- **Claim is the primary action** while nobody holds the task.
- **The order is** Register, Reject receipt, Release, Close for the
  holder, and Claim, Close for anyone who may claim it.
- **The line under the heading still says who holds the task.** It no
  longer has buttons of its own.

### 4. Timeline / Chat as a tab, with its count

The side panel's heading is replaced by the invoice viewer's tab row
(`.doctabs`), in a pill:

- **The tabs:** **Attachments** | **Timeline / Chat** *n*. The count is
  the number of items in the Timeline (`.activitycount`), as on an
  invoice.
- **Timeline / Chat is chosen when the receipt opens**, and is
  highlighted (`.doctab.on`).
- **The tab words are the viewer's own** (`viewer.attachmentstab`,
  `activity.timelinetab`).

### 5. Attachments

**vf-app:**

- **`GET /goods-receipts/:id/attachments`** lists the parts of the route
  message the receipt came in by (`route_message_id`, 0655), in the same
  shapes as an invoice's (0571).
- **`POST /goods-receipts/:id/attachments/:message/:seq/url`** mints a
  part token naming `receipt:<id>`. `/received-files/:token` serves it
  through `partForReceipt`, which checks the message is the receipt's
  own.
- **Who may see them:** both routes follow `receiptAccess`, so whoever
  may see the receipt (the Warehouse included) may see its files.

**What is kept:**

- **Create's upload:** the CSV as uploaded.
- **Receipts in, as CSV:** the CSV.
- **Receipts in, as JSON:** the CSV read from it (part 1) and, from
  now on, the **JSON as sent** (`receipts.json`, part 2, role
  `original`).
- **A JSON file is now shown in the pane**, as plain text is
  (`viewFor`, `partResponse`), for invoices too.

**vf-ui:**

- **`attachments.js` now keeps its state per call** and takes a `base`.
  The receipt's tab is the invoice viewer's own panel, and an invoice
  viewer open beneath the pop-out keeps its tab.
- **Loading:** the tab loads when first opened.
- **Empty states:** a receipt keyed on the screen says it came with
  nothing, in its own words.

### Words (vf-licence `0301`)

Two keys, in English and German: the empty Attachments tab, and a file
no longer kept.

## Verification

- **`vf-app`** `receipt-timeline.test.ts` gains 4 tests:
  - `receiptContext` gives *Acme UK Ltd (Manchester DC)*, Northwind,
    PO-300 and the date.
  - **The emails:**
    - Wendy's subject is *[Acme UK Ltd (Manchester DC)] Wareneingang
      WH-1: …*, with the four German lines in the text;
    - Sam (who added her) is emailed her reply in English, with the
      organisation.
  - **A receipt received with its JSON:**
    - the attachments list gives the message (source, sender, subject),
      `receipts.csv` (part 1) and `receipts.json` (part 2), both shown;
    - each part's link serves the JSON as text and the CSV for
      download;
    - Wendy gets 404 until she is added, then 200;
    - another message's part gets 404.
  - **A receipt keyed on the screen** lists nothing.
- **`vf-ui`** browser:
  - `receipt-timeline.test.ts`:
    - the tab row reads *Attachments*, *Timeline / Chat8*, with Timeline
      / Chat on;
    - **the Attachments tab:**
      - it is not loaded until opened;
      - once opened, it shows its message heading and file;
      - choosing the file asks for its link and shows it.
  - `goods-receipts.test.ts`:
    - the actions read Claim, Close for someone who may claim, with
      Claim's icon;
    - they read Register, Reject receipt, Release, Close for the holder.
  - `viewer.test.ts` and `document-window.test.ts` pass unchanged with
    the reworked `attachments.js`.
- **The vf-ui proxy** passes the two new paths (worker `index.test.ts`).
- **Screenshots** of the pop-out (unclaimed, and held with the
  Attachments tab open), in Day and Night. These led to:
  - the receipt's own words for an empty tab;
  - the panes keeping the panel's height.
- **Full runs**: with 0660, in its record.
