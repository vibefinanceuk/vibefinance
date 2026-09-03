# 0069 — The content type comes from all of detection, not part of it

**Status: built.** Fixes a bug decision 0068 introduced, found the same
day by checking the stored row rather than trusting the response.

---

## The bug

The Morrison PDF was captured through `/sources/:id/capture`, and the
response said what it should:

```json
"document": { "retained": true }
```

The stored row said something else:

```
Acme/2026/0272b779-....bin   application/octet-stream   original
```

**Retained correctly and typed wrongly.** The bytes are intact and
complete; nothing downstream can know they are a PDF.

---

## Why it happened

`contentTypeForStructure` took only the **structure** — the answer to
*"which handler reads this"*.

A PDF carrying no embedded invoice has no structure this system can
extract from, so the structure is `null` and the function fell to
`application/octet-stream`. But detection knew perfectly well what the
file was: `pdf_header` came back `found`, and that outcome was sitting
in the same result object, unread.

> **The same pattern, a seventh time.** One layer knows something and the
> next reads only part of it. `cost_centre` was a column with no
> vocabulary entry; `extraction.confidence` was a fact never declared;
> settings reached nothing; the UBL parser populated half the fields;
> `CIUS_PROFILES` contradicted its own contents; the storage layer
> existed and nothing called it. This one is smaller than any of those
> and identical in shape.

---

## The fix

`contentTypeForDetection` takes the **whole detection result** and reads
the attempted tests, not just the conclusion:

| Structure | Stored as |
| --- | --- |
| `structured_pdfa` | `application/pdf` |
| `structured_xml` | `application/xml` |
| `image` | the sniffed type, which is more specific than "an image" |
| `null`, but `pdf_header` found | `application/pdf` |
| `null`, nothing recognised | `application/octet-stream` |

The last row must stay. A fallback that guessed PDF for everything
unrecognised would be a different wrong answer, and a test asserts that
genuinely unplaceable bytes still get `.bin`.

Watched to fail: removing the `pdf_header` branch breaks the new test
with the original symptom.

---

## Why it matters beyond tidiness

The retained original exists to be **shown to a person** — that is what
decision 0068 unblocked. A browser served `application/octet-stream`
downloads the file rather than displaying it, so the keying screen's
document pane would have been empty for exactly the documents it exists
to serve.

The `.bin` extension in the key compounds it: anything inspecting the
bucket sees a file that looks unidentifiable when it is an ordinary PDF.

---

## What is not fixed

**The rows already written.** One document is stored under a `.bin` key
with the wrong content type. Rewriting it means moving an R2 object and
updating its D1 reference — cheap for one row and worth a considered
migration rather than a quick script, since
`UNIQUE(invoice_id, document_type)` makes a naive re-store a refusal
rather than an overwrite.

Left deliberately: the bytes are correct and retrievable, and a
mis-typed reference is a display problem rather than a retention one.
