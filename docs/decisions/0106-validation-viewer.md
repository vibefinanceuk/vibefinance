# 0106 — The Validation viewer

**Status: built.** The screen a Validation task opens: the retained
original beside the fields it should have yielded.

---

## What it took to become buildable

`docs/design/mockups/key-from-document.html` was mocked in August and
its README recorded the blocker: *"there is currently no document to
show"* — capture read the bytes and discarded them.

Everything it needed arrived since. The document is **retained**
(decision 0068), **correctly typed** (0069), reachable through a
**five-minute signed URL** a pop-out can follow (0073), keying itself is
**built** (0071), and the Task Manager gives it somewhere to be opened
from (0103).

This is the first screen assembled almost entirely from pieces that
already existed.

---

## The document beside the fields

The point of the layout: somebody reads and types **without switching
windows**. A screen that made them alternate would be slower than the
paper it replaces.

The original opens in its own window via `window.open`, which **sends no
`Authorization` header** — the reason decision 0073 exists at all.

**The URL is minted on click, not on load.** A five-minute credential
created when the page renders is mostly expired by the time anybody uses
it, and somebody reading a difficult invoice is exactly the person who
would find it expired.

---

## Partial keying, and a subset of fields

Eight fields, not the whole vocabulary. Decision 0055 records that which
fields to offer is a **per-process decision**, and every declared field
would be a wall of inputs. These are the ones a validation failure
usually turns on.

**Blank fields are skipped**, because partial keying is allowed
(decision 0071): somebody who can read the total but not the VAT
breakdown saves what they have.

What is already known is shown, so correcting one value does not mean
retyping the rest.

---

## The verdict is reported as advisory, because it is

After saving, the screen says whether validation **would now pass** —
and nothing has moved. Decision 0072 settled that keying re-runs
validation and reports it without storing it, because rules are not
re-evaluated: re-visiting a stage waiting on people would raise its
tasks a second time.

So the wording matters. *"Validation would now pass"* is true;
*"validated"* would not be.

**Keying does not complete the task.** They are separate acts, and
somebody may key what they can read and leave the rest.

---

## Two more routes had to accept sessions

`POST /invoices/:id/key` and `POST /invoices/:id/document-url` both used
`requirePermission` — API keys only, the same gap decision 0105 found on
claiming.

**Changed surgically.** A first attempt replaced the identical block
everywhere it appeared and altered **five** routes rather than two,
including purchase orders and pending documents. Not harmful — the
permission check is unchanged — but 0105 says which routes accept a
session is a **per-route decision**, and changing five by accident
contradicts that. Reverted and redone by locating each route rather than
by matching its body.

Both are now in the session-routes table, so the next one cannot be
forgotten in the same way.

---

## The proxy list grew by two, and stayed a list

`vf-ui` carries `/invoices/:id/key` and `/invoices/:id/document-url`.

Still a list rather than a prefix: a test asserts
`/invoices/:id/document` — the upload route — is **refused**, because
being a sibling of a permitted path is not a reason to be reachable.

---

## What is not built

- **Line items.** The mockup has an editable line table and the running
  total the design calls *advisory, never blocking*. Keying lines needs
  `provenance.keyed` to cover them, which it does not (decision 0071).
- **A document preview.** The panel is a placeholder; the original opens
  in a window. Rendering a PDF inline needs either the browser's own
  viewer in an iframe or rasterisation that cannot happen in a Worker
  (decision 0042).
- **Any other stage's screen.** Approval has no mockup. Decision 0103's
  intent stands: one viewer, actions varying by stage — and this is the
  first of them rather than the shape of all.
