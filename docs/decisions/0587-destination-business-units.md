# 0587: Which business units a Destination sends for

**Status: built and tested locally, not yet pushed or deployed.** It
touches `vf-app`, `vf-ui` and `vf-licence`, and needs **`vf-app`
migration `0120`** and **`vf-licence` migration `0234`**, which it
shares with 0588.

## What was asked

On 1 October Dan said that larger enterprises *"can sometimes have
multiple ERP systems, and therefore need multiple Destinations"*. He
asked for *"a Business Unit drop-down, also on the Destination Routes"*,
as Sources have, and for rules at Payment Eligible to influence where an
invoice goes (0588).

His answers to my questions:

- **One Destination may cover several units, each with the units
  beneath it.** Yes.
- **A rule adds to the business unit routing**, rather than replacing it.
- **An invoice that matches no Destination** is left alone, with no
  flag and no task: *"this use case should not happen"*.

## What was decided

**`route_instances.unit_ids`** holds a JSON list of the units a
Destination covers (migration `0120`):

- a unit covers **every unit beneath it** (`coveredUnits` walks
  `org_units.parent_unit_id`);
- **none chosen is all units**, including an invoice placed in no unit.
  That is how every Destination worked before, so nothing changes until
  someone chooses.

**An invoice goes to each Destination that covers its unit**
(`destinationPayable`):

- **HTTPS out** (0585): the sweep queues only covered invoices. The test
  list on its panel offers only covered invoices.
- **The ERP CSV file**: `eligibleInvoiceIds` keeps only invoices whose
  unit the process's ERP Destination covers. So the export screen, the
  ERP card's "waiting" count and the file all agree, and what the file
  does not cover is another Destination's to send.

**Widening a started HTTPS out Destination asks first.** Invoices already
waiting in the units added are sent only if the person says so, as when
it was started (0585):

- `PUT /route-instances/:id/units` replies `decide_waiting` with the
  count;
- the person chooses to set them aside (`skipped`) or send them too.

Narrowing a Destination never unsends anything.

**On Process routes:**

- the Destination's card shows its units, where not all;
- its panel has **Business units**, with **Choose**. Choose opens a
  pop-out: All business units, or units ticked in a tree, with children
  indented under their parent. It explains that an invoice goes to each
  Destination covering its unit, and that a rule can add one.

Admin.Configure sets the units; unknown units are refused. `vf-licence`
`0234` adds the strings.

**No "not routed" flag**, as Dan decided: an invoice no Destination
covers simply stays payment-eligible.

## Not built

- **A second ERP CSV file for one process.** Add a destination offers
  HTTPS out. A second file-based ERP would need its own export screen,
  so it waits for the connector Library (slice 2).

## Verification

- **`vf-app`**:
  - `https-out.test.ts`, 3 new tests:
    - Germany (with Hamburg beneath it) and All. The German Destination
      takes the German and Hamburg invoices; All takes all four,
      including the unplaced one; the test list is the Destination's own
      units;
    - widening a started Destination asks (`decide_waiting`, 1), then
      sets the waiting invoice aside, and nothing is sent;
    - an unknown unit is refused, null clears to all, and the flow shows
      `unitIds`.
  - `erp-destination.test.ts`, 1 new test: the ERP CSV file covering
    the UK exports only the UK invoice, and its card counts 1 waiting.
- **`vf-ui`**, `routes.test.ts`, 2 new tests with the real strings:
  - the card and panel show the unit;
  - the picker indents Hamburg under Germany, and saving sends the units
    ticked;
  - adding a unit to a started Destination asks about the 4 waiting, then
    saves with the answer.

  Both fail against the interface before this change. Worker allowlist:
  the units path.
- **Migrations** replay: `vf-app` 121, `vf-licence` 234.
- **Full runs**, with 0587 and 0588 together: `vf-app` 3396 tests, of
  which 3394 pass (the two known failures, 0511). `vf-ui` browser 1412
  of 1413 (the known `typography.test.ts` 10px gap), worker 96 of 96.
  `vf-licence` 322 of 322.
