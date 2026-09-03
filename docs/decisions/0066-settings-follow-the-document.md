# 0066 — Configured settings follow the document

**Status: built.** `migrations/0029_propagate_extraction_settings.sql`.

---

## What broke, and how

Three decisions, each correct on its own, combined into a silent gap:

1. **0053** put four extraction settings on `intake_channels`, when a
   channel was an arrival point and there was one per process.
2. **0061** made channels per-process **structural** handlers and seeded
   three new ones, all at the column defaults.
3. **0063** routed source-addressed capture to those structural
   channels.

`loadExtractionSettings` reads the channel it is given. Source capture
gives it `ap-live-image`, which has never been configured — so **anything
an administrator had set on the legacy channel is silently ignored**, and
the API would still report the old value when asked about the old
channel.

The same shape as decisions 0056 and 0057: configuration that exists,
reads back correctly, and reaches nothing. Found this time by asking
where the settings had gone rather than by a customer noticing.

---

## The fix

Copy each legacy channel's settings onto its process's structural
channels.

**Only where the structural channel is still at every default.** A
channel someone has already configured deliberately must not be reverted
to an older row's values — and "still at defaults" is the only available
proxy for "never touched", since nothing records when a setting was last
changed.

Verified against seeded data rather than only replayed: the migration
replay runs on an empty database where the copy would have been
vacuously verified. Two scenarios were run directly — a configured legacy
channel propagating to two structural channels, and a deliberately
configured structural channel surviving untouched.

---

## The assertion is point-in-time, deliberately

```sql
-- no structural channel disagrees with its process's legacy channel
```

Stated as a count of disagreements rather than a comparison of totals, so
it holds meaningfully on an empty replay database and a populated one
alike.

**Point-in-time rather than `ALWAYS`:** once the legacy channels are
retired — decision 0061's own next step — a structural channel
legitimately has nothing to agree with, and settings diverge as
administrators configure them separately. Asserting it as standing would
fail the migration that retires them.

---

## What this does not fix

The settings are still **the same four on every channel**, when three of
them are properties of reading an image:

- `requireLineDescription`, `maxExtractedLines` and `conflictWinner`
  govern model output and are meaningless on an XML channel, where there
  is no model response to bound and no pages to merge.
- `currencyTolerance` is a business rounding tolerance and belongs to the
  process rather than to any structure.

An administrator can still set `conflictWinner` on a channel that will
never merge pages. Splitting them properly is worth doing when the legacy
channels are retired, since both touch the same rows.
