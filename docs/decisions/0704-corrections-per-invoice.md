# 0704: Whether learning helps: fields corrected per invoice, on the supplier's page

**Status: built**, not yet pushed. vf-app `supplier-layouts.ts` (`supplierCorrections`), the
supplier layouts route; vf-ui supplier pop-out; vf-licence migration
`0315_supplier_learning_strings.sql`.

## What was asked

The measure in `docs/design/supplier-layout-learning.md` §4, left over once steps 1 to
3b were live. Dan, 9 October 2026: *"please continue with what left"*.

## What is counted

**Fields corrected per invoice**, from `keyed_fields`, which already records every
change a person saves:

- **Header fields only** (`BT-n`). Line changes are a different problem (step 4).
- **Once per field per invoice**, however often it was saved.
- A field the reading **missed** counts as well as one it **read wrong**: either
  way a person had to put it right.
- **Only invoices read by the model.** A structured invoice (Factur-X, XML, a
  mapping), one keyed by hand, or one nothing could read says nothing about reading,
  and is left out.

Two comparisons, from the supplier's latest 500 invoices:

| | Compares |
| --- | --- |
| Over time | the latest 20 read against those before |
| Helped | readings told the supplier's layout (0703, `intake.layoutHint`) against those not |

## Where it is shown

The supplier pop-out, in the section 0702 added:

> Fields corrected per invoice: 0.4 over the last 20 read (2.1 before)
> Read with what was learned: 0.3 per invoice (1.4 without)

Each line only where both sides have invoices to compare. Shown even when nothing is
learned yet, since how much keying a supplier's invoices need is worth knowing either
way. It answers the design's question per supplier; a figure summed across suppliers
(*"keying on your top 20 suppliers fell from 4.1 fields an invoice to 0.6"*) can be
built from the same function when there is a screen for it.

## Checked

- `supplier-layouts.test.ts`: fields counted once each however often saved; the latest
  20 against those before; helped against unhelped; invoices not read by the model, and
  line changes, left out.
- `suppliers.test.ts`: the section shows the layouts, the fields known and both
  comparisons, and Forget posts; with nothing learned it still shows the keying figure,
  and offers no Forget.
