# 0057 — The audit decision 0056 asked for

**Status: built.** Completes the audit `0056` recorded as outstanding.

---

## What was asked

Decision 0056 fixed the wiring from a channel's stored settings to the
**image** extraction path, and closed with:

> The PDF and XML paths were not audited as part of this. Worth an audit
> before the detection cascade lands.

This is that audit. It found the PDF and XML paths clean, and a wider
gap in a place 0056 did not look.

---

## PDF and XML: no gap

Three of the four settings govern **model output**:

| Setting | Governs |
| --- | --- |
| `requireLineDescription` | Rows in a model's line array |
| `maxExtractedLines` | The bound on a model's response |
| `conflictWinner` | Merging pages a model read separately |

`handleCaptureUblXml` parses a UBL document. `handleCapturePdf` extracts
an embedded EN 16931 attachment and parses that, and where it cannot it
refuses (`hybrid_pdf_fallback: 'refuse'`) or returns 501 — a PDF cannot
be rasterised inside a Worker, so the image path is unreachable from
there.

**Neither path ever invokes a model**, so those three settings are not
merely unwired, they are meaningless. Loading them would be noise.

That is the correct answer rather than a lucky one: the settings are
properties of inference, and these paths do not infer.

---

## `currencyTolerance` reached nothing, on any path

The fourth setting is different. It governs **validation**, which every
path reaches — and it was arriving nowhere.

```ts
const validation = validateInvoiceFacts(rawFacts, lines, undefined, linesTruncated);
```

`validateInvoiceFacts` takes a settings parameter and defaults it to the
platform constant. Both production call sites in the workflow engine
passed `undefined`. An administrator could set a channel's tolerance to
five pence, read it back from the API, and see it stored; every
comparison still used one penny.

Images included. **0056 fixed extraction wiring and validation was never
wired at all**, so the bug survived the decision that was supposed to
have caught this class of thing.

### Why it survived

The same reason 0056 recorded, applied to a different function. Decision
0053's tests call `validateInvoiceFacts` with a tolerance built in the
test:

```ts
validateInvoiceFacts(facts, undefined, { currencyTolerance: 0.05 })
```

That proves the check honours a tolerance. It cannot prove a **channel's**
tolerance arrives, because the test supplies it by hand.

0056 stated the lesson — *a unit test that hands a dependency to the unit
proves the unit, never the wiring* — and then fixed only the wiring it had
been looking at. Stating a general principle is not the same as applying
it everywhere it holds.

---

## The fix

`visitCurrentStage` takes an optional `validationSettings`, defaulting to
the platform tolerance so every existing caller is unchanged, and passes
it to both validation calls — the arrival verdict and the after-rules
verdict (decision 0051).

**Supplied by the caller, not loaded in the engine.** Same reasoning as
`linesTruncated` and as the `correctedFacts` write-back: the workflow
engine never assumes how to load configuration for a given
`subject_type`. It is handed what it needs.

**One load covers every path.** `handleCaptureIntake` is where XML, hybrid
PDF, image and multi-page finalise all converge, so the tolerance is
loaded once there. No path can acquire the gap later without also
bypassing invoice storage.

### The test

Goes through `handleCaptureImage` with a real channel id, on a document
whose VAT arithmetic is four pence out:

- at the default penny tolerance, `vat_arithmetic` fails;
- with the channel set to five pence, the same document, the same model
  output, passes.

Watched to fail: reverting the workflow engine to `undefined` breaks the
second case.

---

## What this leaves

The detection cascade (decision 0055, section 3.3) will add paths. Each
needs the same two questions asked:

1. Does this path invoke a model? If so, the three inference settings
   must reach it.
2. Does this path reach validation? If so, it must converge on
   `handleCaptureIntake` or carry the tolerance itself.

A text-layer path (`docs/design/text-layer-extraction.md`) answers **yes**
to the first — a text model still infers, and `maxExtractedLines` still
bounds its response.
