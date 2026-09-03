# 0047 — Extract each page as it is uploaded

Status: built, 3 September 2026. Replaces the extraction timing in
decision 0046; the per-page calls and the merge rules are unchanged.

## What a controlled test established

Per-page extraction (0046) fixed the request-size problem, but page 1
then failed consistently in the multi-page path while the identical
file extracted perfectly through `capture-image` minutes earlier.

Three candidates: the R2 round-trip, the per-page prompt, or something
about two calls in one request. One test separated them — **finalise a
single-page document**:

```
lineCount: 8, confidence 0.9, no failedPages
```

Page 1 alone, through this same path, with the same R2 read and the
same per-page prompt, extracts perfectly. So neither storage nor the
prompt is at fault.

**A single Worker request cannot reliably make two large inference
calls.** Whether the limit is concurrency, rate, or a budget the
runtime allocates once it knows more work is queued, the observable
behaviour is clear: page 1 succeeds alone and times out when page 2
follows it — despite running first.

That last detail is what rules out simple accumulation. The failure is
not "the second call ran out of time"; it is the first call behaving
differently because a second one is coming.

## The fix

Each page is extracted in its **own request**, at upload time, and the
result is stored on the page row. Finalise reads those results and
merges them, making no model call at all.

Better architecture regardless of the limit that forced it. Uploads
are naturally spread over time, every page gets a full request budget,
and finalise becomes a database read and a merge — fast, deterministic,
and repeatable without re-running inference over a document that has
not changed.

## Three properties worth stating

**A failed extraction does not fail the upload.** The page is stored
either way, the reason is recorded on the row, and the document can
still be finalised from whatever else was read. A page that could not
be extracted is a gap to explain, not a reason to reject bytes that
arrived intact — and the error is reported on the upload that caused
it, where it is attributable, rather than surfacing later at finalise
detached from its page.

**"Never attempted" is tracked separately from "attempted and
failed".** A page uploaded before this existed, or through a path with
no model available, is neither a success nor a failure. Reporting the
first as the second would misattribute a configuration gap to the
model.

**Finalise still falls back to extracting.** Only for pages never
attempted, and only when there is no stored alternative — documents
uploaded before this behaviour existed must still finalise rather than
becoming permanently stuck. That fallback is exactly the
multi-call-per-request pattern this decision exists to avoid, which is
why it is the last resort rather than the default.

Watched to fail: making finalise call the model unconditionally breaks
three tests.

## What's still open

- **Untested live.** The mechanism is covered by tests; whether two
  real 1.5MB and 2.8MB scans now both extract is unknown until it runs.
- The exact Workers AI limit is uncharacterised. The behaviour is
  established; the cause is inferred from it.
- Uploading a page is now slow — it makes an inference call — where it
  was previously a storage write. Acceptable, since the work has to
  happen somewhere, but a caller uploading ten pages waits ten times.
