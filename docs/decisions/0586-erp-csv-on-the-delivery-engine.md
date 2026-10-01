# 0586: The ERP CSV file on the delivery engine

**Status: built and tested locally, not yet pushed or deployed.** It
touches `vf-app`, `vf-ui` and `vf-licence`, and needs **`vf-app`
migration `0119`** and **`vf-licence` migration `0233`**.

## What was asked

Connector framework slice 1 (`claude/connector-framework-design.md`) is
HTTPS out and the delivery engine (0585), with **the ERP CSV export
folded in** as a connector on the same engine. Dan chose that on 1
October: *"Yes, fold it in"*. After testing HTTPS out live, he said *"Yes
please"* to this part.

## What was decided

**One ledger for every Destination.** `destination_deliveries` (0585)
holds one row per invoice per Destination. The ERP CSV file now records
there too:

- **Exporting:** each invoice an export takes becomes a **delivered**
  delivery of its process's ERP Destination. Its message is that
  process's outbound message for the export (0558). Its reference is the
  export id.
- **Undoing an export** (0553) removes those deliveries, as it already
  puts the invoices back to Ready to export.
- **Migration `0119`** records exports already made, from their outbound
  messages, and leaves undone ones out. An `ASSERT ALWAYS` keeps the two
  records in step: every ERP delivery is of an export that still holds
  its invoice.

**What stays as it was**:

- `erp_export_invoices` remains what decides "each invoice once" for the
  file;
- the ERP export screen, its download and Undo are unchanged. The file
  is still a file someone downloads: its transport is file download, and
  nothing is posted.

**`GET /route-instances/:id/deliveries`** lists any Destination's
deliveries, failed first, with counts. It needs Admin.Configure or
Integration.Monitor. HTTPS out's panel already showed its own (0585),
now through the same query (`deliveriesOf`).

**On Process routes**, the ERP Destination's panel shows its **recent
deliveries**: each invoice, its supplier, Delivered, when, and which
export took it. There is no Send again: an export is undone, and made
again, on the ERP export screen, as the panel says. `vf-licence` `0233`
adds the strings.

So the Route monitor, the Destination's panel and, in slice 2, the
Library see HTTPS out and the ERP CSV file the same way: a Destination
with deliveries.

## Not built

- **The file as a connector definition.** The definition format arrives
  in slice 2, with the Library, and the ERP CSV file is then its first
  standard definition beside HTTPS out.
- **Exporting from the panel.** The ERP export screen stays the place
  to make and undo exports.

## Verification

- **`vf-app`**, `erp-destination.test.ts`, 2 new tests:
  - an export of two invoices records two delivered deliveries on
    `erp-ap`, with the export and its message; the list gives them, with
    counts; undoing removes them. This fails against the code before this
    change;
  - migration `0119` records an export already made and not an undone
    one.

  With `erp-export.test.ts` and `https-out.test.ts`: 31 of 31.
- **`vf-ui`**, `routes.test.ts`, 1 new test with the real strings: the
  ERP panel lists the export's invoices as delivered, with the export,
  and no Send again. It fails against the interface before this change.
  Worker allowlist: the deliveries path.
- **Migrations** replay: `vf-app` 119, `vf-licence` 233.
- **Full runs**: `vf-app` 3388 tests, of which 3386 pass (the two known
  failures, 0511). `vf-ui` browser 1410 of 1411 (the known
  `typography.test.ts` 10px gap), worker 95 of 95. `vf-licence` 322 of
  322.
