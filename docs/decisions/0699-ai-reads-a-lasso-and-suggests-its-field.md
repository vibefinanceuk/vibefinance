# 0699: The AI reads a lasso Tesseract was unsure of, and says which field it looks like

**Status: live** at `e0c12b2`, pushed and deployed 9 October 2026, migration applied. vf-app route `POST /invoices/:id/read-region`
(`region-read.ts`); vf-ui; vf-licence migration `0311_scan_lasso_strings.sql`
(shared with 0698).

## What was asked

Dan, 9 October 2026: *"could that be combined with a Worker AI to give content
to the data that is captured? Almost a hybrid approach?"*, and then agreed:
Tesseract finds where things are, and the AI is asked only about the small part
a person lassoed. Reading every page with Tesseract and having a text model
interpret it (the fuller hybrid) waits on OCR at intake, which needs Cloudflare
Containers.

## When the AI is asked

Only for a lasso on a **scan** (Tesseract's words), never on a PDF with text,
whose words are exact:

1. **A field has focus, and Tesseract was unsure.** The least certain lassoed
   word is under 75 (`OCR_TRUSTED`; clean print reads 90 and above), or the
   words are not that field's kind of value (letters in an amount, no date in a
   date field), or Tesseract read nothing there at all. The cut-out is read,
   and the answer fills the field the usual way.
2. **No field has focus.** The cut-out is read and the model is asked which of
   the header fields the person could fill it is. The answer is **offered**:
   *"Looks like Due date · Put it there"*. Nothing is filled until they press it,
   so a wrong guess never overwrites a value.

Otherwise (a sure read of the right kind) nothing is sent and no allowance is
used.

## What is sent

The lasso's own area, a little larger, cut from the page at full resolution
(the image's own bytes, or the PDF page drawn at about 3000 px), at most 1200 px
on its longer side, as JPEG. A few kilobytes, a small part of a page's cost in
neurons. With it go:

- the field's label and kind (*"Invoice total, an amount of money"*);
- what Tesseract saw, to be corrected from the image;
- the words printed beside it (to its left, and the line above), usually its
  label;
- with no field in focus, the fillable header fields, by code and label.

`llama-4-scout` (the extraction model) answers in JSON constrained by a schema:
`text`, and `field` from the offered codes or `none`. A field it was not
offered is ignored.

## Failures

- **The allowance is used up** (0696): 503 `ai_allowance`. The viewer says
  *"The AI allowance is used up today: please type it in"* and the field is left
  alone.
- Any other failure: *"Could not read it: please type it in"*.

## The route

`POST /invoices/:id/read-region`, gated as the document is (AP.Validate, AP.Code,
AP.Match, or a collaborator on the invoice), added to vf-ui's proxy list with
the screen-call test. The cut-out is limited to 1.5 MB decoded, the answer to 300
tokens.

## Checked

- `region-read.test.ts` (10): the prompt names the field, what Tesseract saw and
  the label beside it; the field question offers only the fields given, plus
  `none`; an unoffered answer is dropped; 503 for the allowance; 502 for a
  failure or non-JSON; 400 and 413 without calling the model; 401 and 403 at the
  route.
- `lasso.test.ts`: an unsure word goes to the AI and the answer fills the field;
  a sure one is not sent; the allowance wording; a page Tesseract read nothing
  from still goes to the AI; with no field, the suggestion is offered and fills
  only when pressed.
- In Chromium through the real viewer, with the route answered by a stub: a lasso
  round a date with no field chosen sent a 1200 px-limited JPEG of that area,
  Tesseract's `09.10.2026`, the context *"Rechnungsdatum: | Rechnungsnummer:
  RE-2026-0815"* and both fillable fields; *Put it there* filled the due date.
  **Not yet tried against the real model**: the allowance was used up when this
  was built.
