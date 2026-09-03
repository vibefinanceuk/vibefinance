# 0061 — Intake channels become structural handlers

**Status: built.** Follows decision 0060, which gave arrival points
their own table.

---

## What a channel now is

A **per-process handler for exactly one document structure**, selected
by detecting what a document actually is rather than by a caller
choosing an endpoint.

`intake_channels` gains a `structure` column: `structured_xml`,
`structured_pdfa` or `image`.

### Per process, not shared

The reason is mapping rules. They are tailored to a process — an AR
invoice and an expense receipt want different mappings from the same XML
structure — so the thing carrying them has to be per-process too.

That also settles a question decision 0055 left open and 0060 turned on:
once channels are genuinely per-process structural handlers,
`intake_channels` is the right name for them.

---

## The legacy row keeps a NULL structure

`New Supplier Integration` has received images, hybrid PDFs and UBL
alike. It has no single structure because it was never a structural
handler — it was an arrival point, and decision 0060 already made it a
source.

**NULL rather than a guess.** Picking one structure would assert
something false about a row that genuinely handled three. It is
superseded, and retired once capture addresses sources rather than
channels.

---

## The uniqueness guarantee, and why it is a partial index

Detection depends on there being **exactly one channel per structure per
process**. Two would leave it picking arbitrarily between candidates.

That is enforced by a partial unique index rather than a table
constraint, for a specific reason:

> **SQLite treats NULLs as distinct in a UNIQUE.** A plain
> `UNIQUE (process_id, structure)` would silently permit any number of
> NULL-structure rows per process while appearing to forbid duplicates
> — a guarantee that reads as total and is not. Confirmed directly
> rather than assumed. Excluding NULL makes the guarantee real for
> every row it is meant to cover, and honest about the legacy rows it
> is not.

A test asserts that several structureless channels *are* permitted, so
the limit is deliberate rather than discovered later.

---

## Seeding

Every process that had an intake channel gets a full set of three
structural channels. Without them, giving channels a structure would
leave no channel able to handle anything.

Named for what they are — `Structured XML`, `Structured PDF/A`, `Image`
— rather than for a customer's own naming, because a structural channel
is platform machinery rather than a label anyone chose.

Ids are derived from the process (`ap-live-xml`), which is predictable
and readable. It does mean two processes cannot share a structural
channel, which is exactly the intent.

---

## The seeding SQL was tested against data, not just replayed

The migration replay runs against a throwaway database with no rows, so
the seeding logic would have been vacuously "verified". It was run
separately against seeded processes and channels, and the resulting rows
inspected: each process kept its legacy channel at NULL and gained
exactly three structural ones.

Both standing invariants were watched to fail — an unknown structure,
and a second channel for a structure a process already has.

---

## What this does not do

**No detection yet.** Capture still happens against a caller-chosen
endpoint (`capture-xml`, `capture-pdf`, `capture-image`) addressed to
the legacy channel. The structural channels exist and nothing routes to
them.

That is deliberate. Detection changes the public API surface — the
coherent endpoint is `POST /sources/:id/capture`, with the structure
decided internally — and deserves its own decision rather than being
folded into a schema change.

**Settings are still per-channel and still on the legacy row.**
`conflictWinner` and `maxExtractedLines` are properties of reading an
image and are meaningless on an XML channel. Once capture routes to
structural channels, they belong on those; `currencyTolerance` does not,
being a business rounding tolerance rather than anything structural.
Moving them is part of the detection work, not this.

---

## Sequence from here

1. **Detection selects the channel**, and capture moves to
   `POST /sources/:id/capture`. Its own decision.
2. **Settings redistribute** — the three inference settings to
   structural channels, `currencyTolerance` to the process.
3. **Retire the legacy channels** once nothing addresses them.

Step 3 is what removes the NULL case and lets the partial index become
a total one.
