# 0693: The Tasks search finds what the card shows

**Status: built**, in bundle 0993. vf-app (`task-list-route.ts`) and vf-licence
migration `0307_task_search_hint.sql`.

## What was asked

Dan, 8 October 2026:

> I've noticed that the Task screen search bar no longer successfully returns
> results that it should when querying. please can you check the search logic
> here?

## Why searches found nothing

The search (decision 0449) looked at three things: the stage name, the
supplier name on the invoice (`BT-27`), and `CAST(total_with_vat AS TEXT)`.
The card had moved on since:

| The card shows | Searched before |
| --- | --- |
| Invoice number, as its heading | No. The 0449 test even said "this screen has never selected or displayed it", which stopped being true. |
| Supplier name (`BT-27`), or the VAT number when there is none | The name only. Dan's scanned invoices since the wipe have no `BT-27`, so the card shows the VAT number, which was not searched. |
| Amount as `2,595.31` (grouped, two decimals) | Only as stored: "2595.31", and "250.0" for 250. So "2,595.31" and "250.00" matched nothing. |
| Stage | Yes |

## The fix

`?8` now carries one JSON value with three forms of the term, so every
numbered placeholder after it is unchanged:

- `text`, as typed, matched against:
  - the stage name;
  - the invoice number;
  - `BT-27`;
  - the matched supplier's own name;
  - the PO number (`BT-13`);
  - a goods receipt's number.
- `compact`, the term without spaces, matched against the VAT number without
  spaces. So "GB 126 7764 47", "gb126776447" and "7764 47" all find it.
- `amount`, the term read as money by `searchAmount()`, matched against
  `printf('%.2f', total_with_vat)`. It drops currency symbols and codes and
  grouping; where both marks appear, the later is the decimal mark; a lone
  comma before one or two digits is a decimal comma. So "2,595.31",
  "£2,595.31", "2.595,31", "GBP 250.00" and "579,84" all work. A term that is
  not a number gives no amount, and the other fields still apply.

The search box's hint now reads *"Invoice number, supplier, VAT number,
amount, PO or stage"* (German: *"Rechnungsnummer, Lieferant, USt-IdNr., Betrag,
Bestellung oder Phase"*), editable in Interface wording.

## Not changed

The Documents search already covers the invoice number and supplier name, but
has the same amount-format and VAT-number gaps. It can take the same
treatment if wanted.

## Tests

`test/task-list-route.test.ts` adds four search cases:

- the invoice number;
- the VAT number with and without spaces;
- the amount as the card writes it, grouped, with a symbol, in German, and
  250 as "250.00";
- the PO number and the matched supplier's name.

It also adds `searchAmount` cases. The five vf-app test files that use the
task list pass (454 tests), as does the vf-licence string coverage.
