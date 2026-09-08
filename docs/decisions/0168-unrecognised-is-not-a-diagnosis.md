# 0168 — "Unrecognised" is not a diagnosis

**Status: the diagnostic is built.** The cause of the reported failure
is **not yet known**, and this records what will say.

---

## A real JPEG that detection did not recognise

An image was emailed in, captured, and extracted nothing. The stored
facts:

```
intake.structure: ""
intake.attempted: "pdf_header,xml_declaration,image_magic_bytes"
```

So this was **not extraction failing** — decision 0163's timeout, which
was the previous cause. **Detection did not recognise the bytes as an
image at all**, and the photograph is plainly a JPEG.

---

## The word said nothing

`image_magic_bytes` recorded `"unrecognised"`. True, and useless: it
does not distinguish **a file that is not an image** from **an image
that arrived damaged**, and only one of those is our fault.

**The same lesson as decision 0162**, one layer down. That record found
a refused attachment reporting `unreadable` while the reason sat in a
field nobody read. This is a test reporting a verdict while the evidence
— the bytes themselves — was in hand.

It now records the opening eight bytes in hex: enough to name any
format, far too few to be a document.

---

## A speculative fix, labelled as one

The decode was the first suspect. It stripped newlines and trailing
dashes and nothing else, so a client wrapping with tabs would put a
character in the stream.

**It is not demonstrably the cause.** `atob` in this runtime tolerates
those characters, and a test with tabs passes with the old decode
exactly as with the new one.

The stricter version — accept only base64 characters — is kept because a
decoder that accepts only what it decodes is right regardless. **It is
recorded as speculation rather than a cure**, and the test says so:

> A test that passes before and after proves nothing about the change it
> was written for.

That is worth more than a green tick, because a test claiming to prove a
fix stops anybody looking further.

---

## What happens next

The next image sent will record what its bytes actually begin with.
Three answers, three different problems:

- **`ff d8 ff …`** — the bytes are a JPEG and `sniffImageType` is
  wrong.
- **Something else entirely** — the decode or the MIME parsing damaged
  them, and the opening bytes will suggest how.
- **All zeroes or very short** — nothing arrived, and the fault is
  earlier still.

---

## What is not built

- **The cause.** This is instrumentation, not a repair.
- **Nothing records the attachment's declared content type** beside what
  the bytes turned out to be, and a disagreement between the two would
  be the clearest signal of all.
