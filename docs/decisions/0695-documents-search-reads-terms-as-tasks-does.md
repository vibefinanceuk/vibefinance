# 0695: The Documents search reads a term the way the Tasks search does

**Status: built**, in bundle 0995. vf-app (`search-terms.ts`,
`documents-route.ts`, `task-list-route.ts`) and vf-licence migration
`0308_documents_search_hint.sql`.

## What was asked

Dan, 9 October 2026, after decision 0693 fixed the Tasks search: "please can
you look at the documents search fix".

## What was missing

The Documents search (decision 0448) already covered the document number, the
supplier's name and the sender's address. It had the two gaps 0693 found on
Tasks:

- **Amounts as the row shows them.** The row writes "2,595.31 GBP"; the search
  compared `CAST(total_with_vat AS TEXT)`, so a grouped amount, a currency,
  German "2.595,31", or "250.00" for 250 matched nothing.
- **VAT numbers and PO numbers** were not searched.

## The fix

The term reading from 0693 moves to `search-terms.ts`
(`searchTerms()`, `searchAmount()`), and both searches use it, so a term finds
the same thing on both screens. The Documents clause (`?16`, the same single
placeholder) now matches:

- the document number;
- the sender's address;
- the matched supplier's name;
- the name on the invoice (`BT-27`);
- the VAT number without spaces;
- the PO number (`BT-13`);
- the amount with two decimals.

The search box's hint reads *"Document number, supplier, VAT number, PO,
sender or amount"* (German: *"Belegnummer, Lieferant, USt-IdNr., Bestellung,
Absender oder Betrag"*), editable in Interface wording.

## Not changed

A row whose invoice has no supplier name still shows "Unknown sender", where
the Tasks card shows the VAT number. Its VAT number is now found by search.
Showing it in the row is a separate, small change if wanted.

## Tests

`test/documents.test.ts`:

- the amount grouped, with a currency, in German, and 250 as "250.00";
- the VAT number with and without spaces;
- the PO number.

The Documents, Documents analytics, agents' Documents and Tasks tests pass
(171), as does the vf-licence string coverage.
