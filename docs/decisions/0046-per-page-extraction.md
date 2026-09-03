# 0046 — One model call per page

Status: built, 3 September 2026. Replaces decision 0045's single
multi-image call, which failed against real documents.

## Why the first design failed

Two genuine scans of the freight invoice — page 1 at 1.5MB, page 2 at
2.8MB — sent together produced `AiError 3046: Request timeout`. Either
alone extracted comfortably; page 1 on its own gave the best result
yet seen, reading nine of twelve fields and all eight line items.

So the constraint is total request size, not page count and not
resolution. The fix is to keep every request the size already known to
work.

## Why merging is honest here

Merging was rejected when 0045 was designed, on the grounds that
reconciling disagreeing pages means inventing an answer.

The real documents showed that concern was mostly theoretical. Page 1
carries the header and the line table; page 2 carries the totals. They
are **complementary, not competing** — so "the first page that could
read a field wins" is the only answer in the overwhelming majority of
cases, not a preference between rivals.

Where two pages genuinely do disagree, that is reported rather than
resolved. A `conflicts` array names the field, the value kept, the
page it came from, and what the other pages said. Silently preferring
one page would hide the single case where a human actually needs to
look.

## The merge rules

Each chosen because the alternative asserts something untrue.

| Rule | Why |
|---|---|
| First page that read a field wins | Pages are complementary; usually the only answer |
| Disagreements reported, not resolved | Hiding them removes the one signal worth having |
| Lines concatenate in page order, renumbered | A table crossing a break is one table |
| Confidence is the **lowest** any page gave | A document is only as good as its worst page |
| Missing only if **every** page failed to read it | A field on page 2 is not missing because page 1 lacked it |

The confidence rule is the one most worth stating. Averaging would let
a crisp header page mask a barely legible one — the arithmetic mean of
0.95 and 0.4 looks acceptable and describes neither page. Watched to
fail: averaging breaks its test.

## Pages run sequentially

Parallel calls would be faster. They would also produce a burst of
large concurrent inference requests, which is precisely what caused
the timeout this decision exists to fix.

## A failed page does not sink the document

One page that cannot be read leaves the others intact — they may carry
everything needed. But the failure is recorded and returned in
`failedPages`, because a missing page is exactly why a total might not
match its lines, and a validation failure with no visible explanation
is worse than one with a cause attached.

Extraction only refuses outright when **no** page could be read.

## Each page knows which page it is

The prompt tells every call its page number and the document's page
count, and states that fields printed on other pages are not missing.

Without that, a model shown only the totals page treats the absent
line table as a failure to read one — reporting low confidence for a
page it read perfectly, and listing fields as unreadable that were
never there to read.

## What's still open

- **Untested against the real documents.** The mechanism and the merge
  are covered by tests, but whether two 1.5MB and 2.8MB scans now
  succeed as separate calls is unknown until it runs live.
- **The size threshold is unmeasured.** 1.5MB works, 4.3MB does not,
  and nothing between has been tried.
- The confidence score still carries no demonstrated information — the
  merge now takes the minimum of several numbers that may each mean
  nothing.

---

## Addendum — the page note suppressed the line table

The first live run of per-page extraction succeeded where the
single-call design had timed out: both pages processed, and the real
total of 3,137.47 read from page 2 where it is actually printed. The
first time the system has had a true total rather than a fabricated
one.

But `lineCount` came back **0**, where page 1 alone had given 8.

Isolating it took one call: the same image through the single-page
endpoint, minutes later, returned all 8 lines. Same model, same file,
same day. The only difference was the prompt.

### What was wrong with it

> *"Report only what is visible on THIS page. Fields printed on other
> pages are not missing — return null for them, and do not infer them
> from this page. A line-item table may start or continue here; report
> the rows you can see."*

Three instructions about **not** reporting things, and one brief aside
about the table. The weight of the message was restrictive, and the
model applied that restriction to the very content the page did
contain.

Rewritten to lead with the instruction that matters:

> *"Extract everything this page shows, exactly as you would from a
> single-page invoice — including every row of any line-item table
> visible here. The only difference is that a field printed on a
> different page should be returned as null rather than guessed at."*

The restriction survives as one clause at the end rather than the
bulk of the message.

### The lesson, which is a repeat

A prompt change was shipped without a live check, on the strength of
tests that assert the prompt *contains* certain phrases. Those tests
passed throughout. They cannot fail, because what they measure is not
what matters — a prompt is only correct in terms of how a model
behaves given it, and no unit test observes that.

This is the second time in two days that reasoning about a prompt
proved unreliable where running it would have been immediate. The
first was assuming Business Term ids would work as schema keys.

**A prompt change needs a live check before it ships.** The tests are
worth keeping — they pin intent and catch accidental deletion — but
they are documentation, not verification.
