# Design: Learning each supplier's invoice layout

**Status: agreed**, 9 October 2026 (Dan: *"Agreed with this proposal"*, including the four decisions in §5). Step 1 built as decision 0701; steps 2 and 3a as 0702 (layouts worked out from the regions when asked, not stored: see 0702); step 3b as 0703 (supplier from the sender only, for now); the §4 measure as 0704; step 4 as 0705. Builds on the
document viewer's find-and-lasso work (decisions 0697–0700).

---

## 1. What was asked

Dan, 9 October 2026, after the lasso went live:

> Would this introduce 'learning' of supplier invoices

and, on the outline that followed: *"yes please — write up"*.

The answer given: storing where each value came from is not learning by itself,
but it is the data learning needs. This document is the path from one to the
other.

---

## 2. What exists today, checked

| Piece | Where | What it gives learning |
| --- | --- | --- |
| Words with positions for every page, PDF text or Tesseract | `doc-words.js` (0697), `ocr.js` (0698): browser only | Where any value is, as a fraction of the page |
| Finding a value beside its label | `locate()` with `FIELD_LABELS` (0697) | Which label a value sits next to |
| The lasso filling a field | `field-link.js` (0697, 0700) | A person **showing** where the right value is |
| Every correction to a field, before and after | `keyed_fields` (migration 0030) | Which fields people fix, per invoice, per person |
| Which supplier an invoice is from | `match-supplier.ts` (0209): `BT-34`, then `BT-31` | The key a layout is learned under. Known only **after** reading. |
| The extraction prompt | `buildExtractionPrompt` (`extraction.ts`) | The place a hint can go |
| Scanned pages kept small, one JPEG each | `invoice_pages` (0690) | Positions that stay true for the stored page |

Two facts shape everything below:

- **Positions exist only in the browser.** Intake reads with the vision model,
  which gives values, not positions. A position is only known once someone opens
  the invoice: the viewer finds the value, or a person lassoes it.
- **The supplier is known only after reading**, because it is matched on what the
  reading found.

---

## 3. The plan, in four steps

### Step 1: Record where each value is (the "regions")

When an invoice is open in the viewer, record **where each header value is on
the page**, and how that was established:

| `source` | When | Weight |
| --- | --- | --- |
| `found` | The viewer found the stored value on the page (0697's `locate`) and it is the only place it appears, or it sits beside its own label | 1 |
| `lassoed` | A person drew a box round it and it went into the field | 3 |
| `lassoed_corrected` | As `lassoed`, and the value it replaced was different (a correction) | 5 |

A correction is the strongest evidence: a person looked, saw the reading was
wrong, and pointed at the right place.

**What is stored** (vf-app, new table `invoice_field_regions`):

```
invoice_id, field, page_number,
x, y, w, h,                 -- fraction of the unrotated page, as the viewer uses
label_text,                 -- the words beside it ("Rechnungsnr.", "Gesamtbetrag"), squashed
source, recorded_by, recorded_at
```

One row per invoice and field (the latest wins; the earlier ones stay as history
only if the audit line below needs them).

**How it gets there.** The viewer already knows all of this the moment a value is
found or lassoed. It sends it to `PUT /invoices/:id/regions/:field`, quietly and
after the fact; nothing waits on it. Only for **header** fields to begin with: a
line's position belongs to its row and is a different problem (step 4).

**The audit line.** A value put in by the lasso gets a Timeline entry: *"Invoice
total taken from page 1"*, with the box shown on the page when clicked. It answers
the question an auditor asks of any keyed value: *where did this come from?*

**What it changes for people straight away:** clicking a field that was lassoed
highlights the exact spot that was taken, rather than searching again.

### Step 2: Learn a layout per supplier

From the regions of a supplier's invoices, build that supplier's **layout**: where
each field usually is.

**New table `supplier_layouts`:**

```
supplier_id, layout_id,
fingerprint,                -- what this layout looks like (below)
field, page_number,
x, y, w, h,                 -- the agreed region (median of the evidence)
label_text,                 -- the agreed label
evidence,                   -- weighted count of agreeing invoices
disagreements,              -- weighted count that did not agree
last_seen_at
```

**When regions agree.** Two regions agree when their centres are within about 3%
of the page and their labels match. A field enters the layout once its agreeing
evidence reaches **3** (three found invoices, or one lasso correction alone) and
it has more agreement than disagreement.

**More than one layout per supplier.** Suppliers change templates, and a supplier
with several sites or systems sends several. The **fingerprint** tells layouts
apart: the squashed labels found on the first page and their rough positions,
for example `rechnungsnr@0.7,0.1 | gesamtbetrag@0.7,0.8 | …`. A new invoice joins
the layout whose fingerprint it shares most labels with, or starts a new one.

**Forgetting.** A layout field that keeps disagreeing (its disagreements overtake
its evidence) is dropped. A layout not seen for a year is kept but marked stale.

**Computed in vf-app, not the browser**, when a region is recorded: a small
update to the supplier's layout, not a batch job.

### Step 3: Use what was learned

Three uses, cheapest first.

**a. In the viewer: "it is usually here".** When a field is empty, or its value is
not found on the page, the viewer outlines where this supplier's layout says it
should be (a different colour from a found value) and the toolbar says *"Usually
here for this supplier"*. One box-drag fills it. Free: no AI.

**b. In the AI reading: hints in the prompt.** When the supplier is already known
before reading, the extraction prompt gets a short paragraph:

> For this supplier, the invoice number follows "Rechnungsnr." near the top right;
> the total follows "Gesamtbetrag" near the bottom right; the due date follows
> "Zahlbar bis".

Labels, not coordinates: the vision model reads labels far better than it
measures positions. No extra calls; a few more prompt tokens.

**c. At intake: read the known regions directly.** For a supplier whose layout is
well established, read each field from its region (crop, OCR, done) and ask the
AI only for what is left (usually the lines). The biggest saving in neurons, but
OCR at intake needs Cloudflare Containers (see 0699, "Not done here"). Not
planned until Containers are.

**Knowing the supplier before reading.** For 3b and 3c the supplier has to be
known first. In order of cost:

1. **The sender.** An email from a known supplier address. Free, and right for
   most emailed invoices. Needs a sender-to-supplier list, learned the same way:
   which supplier did invoices from this address turn out to be?
2. **Words on the page.** For a PDF with text, the VAT number or electronic
   address is in the text layer: match it before asking the AI anything.
3. **Otherwise**, read as today, match the supplier, and if the result disagrees
   with the supplier's layout for a field, read that field again with the hint
   (a second, small call: the region cut-out from 0699).

### Step 4: Lines (later)

Line tables are a different shape: a header row with column labels, then rows.
A line layout is the **columns**: where *Description*, *Qty*, *Unit price* and
*Amount* sit across the page, and which label heads each. It would tell the
lines reading which column is which, and fill the columns that are empty on
every invoice today (decision 0172: unit, quantity, unit price, VAT category).
Worth doing once header layouts have proved themselves.

---

## 4. How we know it works

**The measure: corrections per invoice, per supplier, over time.** `keyed_fields`
already records every change a person makes to a field. If learning works,
corrections on a supplier's invoices fall as its layout fills in. Shown on the
supplier and summed across suppliers, it is also the figure for a customer:
*"keying on your top 20 suppliers fell from 4.1 fields an invoice to 0.6"*.

Also worth counting:

- how often the viewer's "usually here" box is the one lassoed (the layout was right);
- for 3b, the extraction confidence and corrections with hints against without.

---

## 5. Decisions to make

1. **Header fields to learn first.** Proposed: invoice number (BT-1), issue
   date (BT-2), due date (BT-9), PO reference (BT-13), seller VAT (BT-31), net
   (BT-109), VAT (BT-110), total (BT-112), amount due (BT-115).
2. **Per customer, never shared.** Proposed: a layout belongs to one customer's
   instance, like every other table in vf-app. Two customers receiving invoices
   from the same supplier learn separately. Sharing would teach faster, but it
   moves invoice-derived data between customers, which the architecture does not do.
3. **Who may correct a layout.** Proposed: nobody edits a layout directly at
   first; it is only ever learned from invoices. A supplier's page shows what has
   been learned, with a way to forget a layout that went wrong.
4. **Regions from `found` values.** Proposed: count them (they are most of the
   evidence) but weakly, and only when unambiguous (one place on the page, or
   beside its label), so a value that happens to appear twice cannot teach the
   wrong place.

---

## 6. Build order

| Step | What | Size | AI cost |
| --- | --- | --- | --- |
| 1 | Record regions; audit line; exact highlight for lassoed values | vf-app table and route, vf-ui sends | none |
| 2 | Supplier layouts from regions | vf-app | none |
| 3a | "Usually here" in the viewer | vf-ui, one read route | none |
| 3b | Hints in the extraction prompt; supplier from sender or text layer first | vf-app | a few tokens a read |
| 3c | Read known regions at intake | needs Containers | lower |
| 4 | Line columns | later | — |

Steps 1 to 3a can be built and tested with no AI allowance at all.
