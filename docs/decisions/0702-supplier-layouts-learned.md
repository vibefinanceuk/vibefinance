# 0702: Each supplier's invoice layout is learned, and the viewer says where a field usually is

**Status: live** at `e1efec9`, pushed and deployed 9 October 2026, migrations applied. vf-app `supplier-layouts.ts`, migration
`0155_supplier_layout_resets.sql`, routes `GET /invoices/:id/layouts`,
`GET /suppliers/:id/layouts`, `POST /suppliers/:id/layouts/forget`; vf-ui; vf-licence
migration `0314_supplier_layout_strings.sql`. Also adds
`scripts/wipe-invoice-runtime-data.sql` to the repository.

## What was asked

Steps 2 and 3a of `docs/design/supplier-layout-learning.md`. Dan, 9 October 2026:
*"feel free to proceed to build if its the right time, and all decisions are
make"*. The four decisions in the design's §5 were agreed with the design.

## Learning a layout (step 2)

From the regions of 0701 (where each header value was on each invoice),
`learnLayouts` works out where a supplier usually puts each field:

- **Weights**, as the design set: found 1, boxed in 3, a correction 5.
- **Same place** is centres within 3% of the page, on the same page, with the same
  label where both have one.
- **Layouts.** Invoices are taken in the order their regions were recorded. Each
  joins the layout it agrees with most, where at least as many shared fields are in
  the same place as not (one moved field is a misreading, not a new template), or
  starts a new one. So a supplier's two templates are kept apart.
- **A field is learned** with 3 agreeing evidence (three found invoices, or one
  correction alone) and more agreement than disagreement. Its place is the median of
  the agreeing regions; its label the most common one.
- **Recent invoices only:** the supplier's latest 200. Old templates fade.
- **Only regions whose value is still the invoice's** count (0701).

**Worked out when asked, not stored: a change from the design**, which proposed a
`supplier_layouts` table kept up to date as regions arrive. Computing from the
regions gives the same answer and cannot drift from them: a value changed stops
counting at once. A supplier has at most a few hundred regions, so it is cheap.

**Forgetting** (design §5, decision 3) is therefore a point in time:
`supplier_layout_resets` holds when a supplier's layouts were last forgotten, and
regions recorded before it no longer count for that supplier. Nothing is deleted;
the regions stay as each invoice's own record. Administrators only
(`Admin.Configure`).

## "Usually here for this supplier" (step 3a)

When a header field is clicked and it is empty, or its value is not on the page,
the viewer outlines where the supplier's layout puts it, dashed amber (a
suggestion, where blue is a find), and says *"Usually here for this supplier"*. One
box round it fills the field.

Which layout, for a supplier with several: the one most of whose labels are printed
beside where it puts them on this document. With none recognised, the supplier's
only layout, if it has one; otherwise nothing is guessed.

An empty header field is now asked about (it used to clear the outline), so the
layout can answer for it. The layouts are fetched once per document.

## The supplier's page

The supplier pop-out shows what has been learned: *"2 layout(s), learned from 7
invoices"*, *"Knows where to find: Invoice number, Invoice total…"*, and *Forget what
was learned*. Layouts are never edited directly (design §5, decision 3).

## The wipe script

`scripts/wipe-invoice-runtime-data.sql`, from Dan's own copy, is now in the
repository and clears `invoice_field_regions` (0701) before the invoices. Checked by
replaying every migration into SQLite with foreign keys on, seeding an invoice with
a region, and running the script: it completed and left no invoices.
`supplier_layout_resets` is kept: it belongs to suppliers, and with the invoices gone
there is nothing left to learn from anyway.

## Checked

- `supplier-layouts.test.ts` (12): three agreeing invoices learn a field, two found
  ones do not, one correction does; two templates kept apart, most used first; a
  field the evidence disagrees on left out; a different label is a different place;
  a supplier learns from its own invoices only; a changed value stops counting; an
  invoice with no supplier gets none; forgetting starts again and deletes nothing;
  the routes, and Forget for administrators only.
- `lasso.test.ts`: an empty field outlined where the layout puts it, layouts fetched
  once; also when the value is not on the page; no guess when the value was found;
  nothing for a supplier with no layout.

## Next

Step 3b, hints in the extraction prompt, needs the supplier known before reading
(from the sender's address, or a PDF's own text): its own decision.
