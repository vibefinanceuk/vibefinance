# 0697: Clicking a field shows where its value is; a lasso fills the field with focus (PDFs with text)

**Status: built**, not yet pushed. vf-ui; vf-licence migration `0310_lasso_strings.sql`. No vf-app change.

## What was asked

Dan, 9 October 2026:

> I would like for images that are extracted by an AI worker, and maybe also for
> structure PDF (such as Zegferd and Facture-X), for the system to extract
> information from the document, present the information to the user in the
> invoice viewer, and when a field is clicked for the image viewer to highlight
> the field that has been extracted. If the user lasso's another field on the
> image, the data from that lasso should be returned to the cell that has focus.

Agreed in conversation, in this order:

1. **This decision**: PDFs that carry their own text (ordinary PDFs, Factur-X and
   ZUGFeRD). No AI and nothing new on the server.
2. **0698**: scans and photos, through Tesseract in the browser.
3. **0699**: a Workers AI read of a lassoed region where Tesseract is unsure or
   the text is the wrong kind for the field, and a suggested field when none
   has focus.

The fuller hybrid (Tesseract's words read by a text model citing word numbers)
waits on running OCR at intake, which means Cloudflare Containers; not now.

## How it works

**The words on a page** (`doc-words.js`, pure). A page is a list of words, each
with a box as a **fraction of the unrotated page**. For a PDF they come from its
text layer through the pdf.js the viewer already loads (`getTextContent`), split
into words with each run's width shared by character count. A fraction stays
correct at every zoom, and rotation is applied only when drawing, so a found
value survives zoom, rotation and turning the page. Scans give no words yet;
0698 gives them words in the same shape, so nothing below changes.

**Finding a value.** The value is compared the way its kind is written:

- amounts whatever the separators, currency or grouping (`1234.5` finds
  `€1.234,50` and `1 234,50`);
- dates whatever the order or month names, in English, German and French
  (`2026-10-09` finds `09.10.2026` and `9 October 2026`);
- text without case, spaces, punctuation or accents (`GB123456789` finds
  `GB 123 4567 89`).

When the value appears more than once (an invoice total is often also the
only line's amount), the best place is the one **beside the field's own label**
(`FIELD_LABELS`: Total, Gesamtbetrag, Net, Rechnungsdatum…). A line's value is
looked for **on its own row**, beside the line's description. Failing a label, a
total prefers its last appearance (totals are at the foot); anything else, its
first. The best place is outlined solid blue, any other dashed.

**The lasso.** A new Lasso button beside Highlight (one or the other). The person
draws round a value freehand; the words whose centres are inside are sent to the
form, which reads them as the focused field's kind:

- an amount: the last number in the lasso, so a loop round `Total £1,234.50`
  gives `1234.5`;
- a date: the first date, as ISO, day first where the page leaves it open;
- a picker (currency, unit): the option whose code matches;
- text: as it reads.

The value goes in **as if typed**, firing the same `input` and `change` events, so
the line totals, the exception marks and Save see it the ordinary way. The
field flashes green; the viewer says *"Put in Invoice total"*, or why it could
not (no field chosen, no amount in the lasso, not one of the picker's choices).

**The target** is the last editable field to have had focus. Clicking the page
takes focus away from it, so "the field with focus" has to mean the last one.
A read-only field can be clicked to see where its value is, but never filled.

**The form and the document talk over a `BroadcastChannel`** named for the
invoice (`doc-link.js`). A message posted on one channel reaches every other
channel of that name, in the same window or the pop-out (0384). So the card and
the pop-out window on a second screen behave the same, and neither needs to
know where the other is. `field-link.js` holds the form's side: listeners on the
document, reading the `data-field` and `data-kind` marks that `field()` and the
line table now put on every control.

## Not done here

- **Where a value came from is not stored.** It is found again each time a field
  is clicked. Keeping the region with each value (and an audit line, "taken from
  page 1, here") was the third step agreed; it comes after 0698 and 0699.
- **A PDF's own `/Rotate`** is drawn as the viewer always has (at 0); boxes are
  computed the same way, so they agree with what is shown.
- Words in a run are boxed by character count, not by each glyph's width. Close
  enough to outline a word; a lasso takes a word by its centre, so it is not
  affected.

## Checked

- `doc-words.test.ts` (50): word boxes from a pdf.js text run, reading order,
  amounts and dates in each written form, labels choosing between two places,
  a line's own row, rotation round trip, the lasso's words and value.
- `lasso.test.ts` (10): a field clicked outlines its value; "not found"; a lasso
  fills the focused field as if typed; no field chosen; a page with no text; the
  lasso and highlight exclude each other; dates, pickers, a line amount looked
  for beside its description.
- A real PDF (reportlab, German invoice) read by pdf.js 5.4 in Node: invoice
  number, date (`09.10.2026`), VAT number in groups, supplier name, net, VAT and
  total (`1.683,26 €` beside *Gesamtbetrag*), and a line amount on its own row
  were all found, and a lasso round the total read `Gesamtbetrag 1.683,26 €`.

## Addendum: a line's row (fixed with 0698)

As first bundled (0998), a line field sent its description to be found first,
but the viewer passed it on as if it were already a place on the page, so a
line's value was not looked for on its own row. The viewer now finds the
description first and looks beside it. Tested in `lasso.test.ts` ("looks for a
line's amount beside the line's own description").
