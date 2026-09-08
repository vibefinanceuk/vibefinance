# 0166 — A picture nobody can see

**Status: fixed.** A document nothing could read keeps its own content
type, so the viewer can display it.

---

## An empty form beside an empty pane

> I received a jpg image into the validation stage, but the image could
> not be displayed and extracted no information.

The second half was decision 0163 working: a photograph whose extraction
times out is **kept as an invoice with no facts**, waiting for a person
to key it, rather than bounced to the supplier.

**The first half made that useless.** A person was shown an empty form
beside an empty pane and asked to key from a document they could not
see.

---

## `application/octet-stream`

`contentTypeForDetection` asked `image_magic_bytes` **only when the
structure had already been decided to be an image.**

A document kept without facts is stored with `structure: null`
deliberately — *"the document has no structure, and the alternative is
inventing one"* — so it fell through every branch to
`application/octet-stream`, and **a browser cannot render "some
bytes"**.

The sniffed type was there the whole time, in the same `attempted` list
the function was already reading for `pdf_header`.

**This matters most exactly when extraction failed**, which is the one
case where somebody has to read the document themselves.

### And the honest default stays

Bytes nothing recognised are still `application/octet-stream`. That
branch's reasoning — *"honest rather than lazy: nothing claims to know
what they are"* — is untouched and still right.

---

## A test that guessed at time

`documents.test.ts` waited 30ms for a dynamic import and four fetches.
It passed when written and failed on a later run that changed nothing in
the UI.

**Decision 0138 already recorded this**: a fixed delay is a guess about
how long something takes, and a guess that passes once fails later. It
now waits for the condition being asserted and gives up rather than
hanging.

---

## What is not built

- **Nothing tells the person the image is large.** The document that
  timed out will time out again on every retry, and the screen says
  *"could not be read automatically"* without saying *"because it is
  936KB"*.
- **No downscaling, still** (decision 0163). The picture is now visible
  and still unread.
