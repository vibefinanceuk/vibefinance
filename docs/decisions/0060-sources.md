# 0060 — Sources become their own thing

**Status: built.** Resolves the naming collision decision 0055 section
2.5 recorded and deliberately left open.

---

## The collision, and which way it resolved

`intake_channels` was carrying two jobs. Its rows are **arrival
points**: process-bound, named, receiving whatever a supplier sends. The
real customer's only channel, *"New Supplier Integration"*, has taken
images, hybrid PDFs and UBL alike.

But "intake channel" had come to mean a **structural handler** — the
thing that reads XML, or a PDF/A container, or an image — selected by
detecting what actually arrived. Opposite ends of the pipeline sharing
one name.

0055 costed two resolutions and recommended the cheaper one: keep the
table name, rename the concept. **That recommendation was wrong**, and
it was wrong because a question had not been settled yet.

> **What settled it —** Intake channels are per-process, not shared,
> because mapping rules are tailored to a process: an AR invoice and an
> expense receipt want different mappings from the same XML structure.
> Once intake channels are genuinely per-process structural handlers,
> `intake_channels` is the right name for them — and what needs a new
> home is the source.

That turns a rename into an addition, which is considerably cheaper.

---

## What was built

A `sources` table: `(id, process_id, name, mechanism)`.

**Deliberately additive.** Nothing is dropped, no foreign key moves, and
`intake_channels` is untouched. A later migration gives it a `structure`
column once every arrival point has a source to be.

### The mechanism is a closed set

`email`, `https`, `sftp`, `file_import`, `edi` — enforced by a `CHECK`
and restated as a standing invariant so a future change that drops the
constraint is caught on the next replay.

This is a deliberate contrast with `mandate.channel`, which remains a
free string. The difference is that the system has to *know how to talk
to* a mechanism; it only has to *record* a channel name.

### The name is the instance's, not the mechanism's

Two mailboxes, or two tax authority APIs for two jurisdictions, are two
source instances of one mechanism. "HMRC mailbox" and "Revenue mailbox"
are both `email`, and a report collapsing them answers nothing useful.

Uniqueness is `(process_id, name)` — the same name under AP and AR is
two different arrival points.

### The backfill reuses the id

Every existing `intake_channels` row becomes a source **with the same
id**. A new id would strand every stored `mandate.channel` value; reusing
it means existing provenance keeps resolving with no data migration at
all.

`legacy_channel_id` records where each came from, and is surfaced in the
API rather than hidden — so an operator can see which arrival points
predate the split.

Mechanism `https`, because that is what they genuinely are today: every
capture route is an HTTP endpoint. Recording them as `email` or `sftp`
would assert a transport nobody configured.

---

## Administrative, and why that is two permissions' worth of care

`Admin.Configure`, which already existed. Source configuration means
credentials — mailbox passwords, API keys, SFTP details — which is
platform plumbing rather than accounts payable work.

But **provenance stays visible to AP**. Seeing *which* source a document
arrived through is not configuration, and an AP clerk investigating a
misfiled invoice has a legitimate reason to know it came in via the AR
mailbox. `mandate.channel` remains an ordinary fact. Collapsing the two
would make decision 0055's misfiling check invisible to the people best
placed to notice it.

---

## One assertion worth explaining

The backfill's point-in-time check is:

```sql
SELECT count(*) FROM intake_channels WHERE id NOT IN (SELECT id FROM sources) == 0
```

rather than comparing counts. The replay runs against a throwaway
database with no rows, where a count comparison is vacuously true and
proves nothing, while this holds meaningfully on both an empty schema
and the real customer's populated one.

**Point-in-time rather than `ALWAYS`, on purpose.** Once
`intake_channels` becomes structural handlers, a channel legitimately
will *not* have a source. This is true at the moment of the backfill and
is not a standing property — and asserting it as one would fail the next
migration.

Three standing invariants were watched to fail: an unknown mechanism, an
empty name, and a dangling legacy reference.

---

## What comes next, in order

1. **`intake_channels` gains `structure`** — a closed set, with
   uniqueness on `(process_id, structure)` so detection has exactly one
   channel to choose per structure.
2. **Detection selects the channel**, replacing today's caller-chosen
   endpoints (`capture-xml`, `capture-pdf`, `capture-image`). This is
   the cascade of decision 0055 section 6.
3. **Settings scope correctly.** `conflictWinner` and
   `maxExtractedLines` are properties of reading an image and are
   meaningless on an XML channel — something the current table cannot
   express, and an administrator can currently set.

Step 2 changes the public API surface and deserves its own decision.

---

## What this does not do

No route yet consumes a source. Capture still happens against
`intake_channels`, exactly as before, and `mandate.channel` still records
that channel — which, after the backfill, has the same id as the source
it became. So the values remain correct under either reading, and stay
correct through step 1.

That is deliberate: this migration should be safe to deploy and change
nothing observable.
