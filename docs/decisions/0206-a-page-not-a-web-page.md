# 0206 — A page, not a web page

**Status: built.** The rendering is A4 portrait, sized for paper, and
paginates without cutting a line in half.

---

## Nothing defined a page

Decision 0205's rendering filled whatever width it was given. The markup
carries a `document` class and **no rule in either stylesheet ever
matched it** — not ours, and not OpenPEPPOL's.

In an iframe beside a keying form that reads as a wall of text rather
than as a document somebody could have received.

**A4 portrait**, because that is what an invoice is printed on
everywhere this product operates. The width is fixed; the height is a
**minimum**, so a long invoice grows rather than being cut — which is
the opposite of what a fixed height does.

---

## Sized for paper rather than for a browser

The imported CSS is Bootstrap's: an `h1` at 36px, an `h2` at 30px, body
at 14px. Right at arm's length in a browser window, and wrong on A4 —
*"Supplier"* arrived larger than anything on a real invoice, and the
document read as a heading with some details attached.

**An invoice's hierarchy is shallow.** A title, then quiet labels. So
section headings are barely larger than the text they introduce and are
separated by weight, colour and space instead.

**Body text is 12px**, at the operator's asking: about fifteen percent
more invoice on a page, which on a twenty-line document is the
difference between two pages and three.

**In px**, because the imported CSS is entirely px and **one document
measured in two units is one nobody can reason about** — decision 0031's
argument about a vocabulary having one source, applied to a stylesheet.
`mm` is the exception and deliberately: a page's size is a physical fact
rather than a typographic one.

---

## An amount is one thing

The line grid was 6-2-2-2, and at 210mm the last column is about 30mm —
enough for `300.00` and not for `300.00 GBP` with a tax rate beneath.

So a currency wrapped onto its own line and the rate followed, and a
reader had to reassemble a number that was never two things.

The description gives up a column and the amount takes it, and numeric
cells refuse to wrap at all: **a number that does not fit is better
clipped than silently rearranged**, because the second looks like data.

---

## Where a page may break

> If we had 20 lines, would it continue over to pages 2, 3 sensibly?

**It would not have**, and the question is what produced these rules.

A browser given no instruction breaks wherever it runs out of paper —
which can be **halfway through a line**, leaving a description on one
page and its amount on the next. That is not a formatting blemish: it
reads as two entries, one of which has no money against it.

A section heading alone at the foot of a page is the same fault in
miniature, and a provenance notice split in half says half of what it
means. All three are now `break-inside: avoid` or `break-after: avoid`.

---

## On screen it scrolls, and that is deliberate for now

**Printed, the browser paginates and the rules above are correct.** On
screen the page grows and there is no page 2.

**Real on-screen pagination needs measurement** — walking the content,
finding where 297mm falls, re-running on resize — and the cheap version
is a repeating background every 297mm, which would be **wrong**: the
print rules move breaks earlier to avoid splitting a line, so a
separator drawn at a fixed interval disagrees with the paper.

**A picture that disagrees with the printer is worse than no picture.**

### And it is the same problem as annotation

The operator's longer goal is a viewer with annotation and markup. Both
need the same thing: **knowing where things are inside the document**.

So they are one piece of work, and the operator chose to do them
together:

> Measured pagination and annotation are the same problem twice — and
> doing them together, once, is better.

---

## What that will need, and a correction

**Same-origin delivery.** The document URL is minted on `vf-app`'s
origin and the viewer runs on `app.vibefinance-ai.com`, so the iframe is
**cross-origin** and the parent cannot read its DOM at all.

**I suggested a shadow root and then argued myself out of it.** Shadow
DOM isolates CSS and **not JavaScript**: this document is built as a
string with an `esc()` on every value, and if that function ever has a
hole, a supplier-controlled field becomes script **in the viewer's own
origin**, with the session attached. A same-origin iframe gives the same
access and isolates both.

So the change is smaller than I first said — serve the rendering through
`vf-ui`'s proxy — and it is worth doing regardless of annotation.

### Why annotation will be better here than on a photograph

**A scanned invoice supports only positional markup**, and a coordinate
is meaningless once the image is re-cropped.

**This renders from structure**, so a field can carry its Business Term
and an annotation can be anchored to `BT-48` rather than to a point.
That survives re-rendering, zooming, a stylesheet change and translation
into another language.

---

## What is not built

- **On-screen pagination**, deliberately, and it arrives with
  annotation.
- **Same-origin delivery**, which both need.
- **Field identity in the markup** — no `data-bt` attributes yet.
- **The rendering is still plainer than the official one**: no delivery,
  payment means, attachments or tax breakdown (decision 0205).
