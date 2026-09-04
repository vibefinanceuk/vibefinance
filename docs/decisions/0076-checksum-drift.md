# 0076 — The checksum nothing read

**Status: built.** Found by using `--refresh-checksums` for the first
time and watching it do nothing.

---

## What was wrong

`apply_migrations.py` writes a checksum for every migration it applies,
into the bookkeeping table, on both the local replay and the remote
path.

**Nothing ever read it back.** `remote_applied_filenames` selected
`filename` alone. No comparison existed anywhere between a stored
checksum and the file it was computed from.

The apply loop's own comment described the result as *"the same SQL
body, checksum-verified"*. That was not true, and had not been true
since the mechanism was written.

---

## And the flag for handling drift could not reach it

`--refresh-checksums` is documented as *"the act of saying so"* when an
applied migration is legitimately edited — this project's §6 discipline.

It returned early:

```python
pending = [m for m in migrations if m.filename not in applied]
if not pending:
    print("nothing to apply — remote is up to date.")
    return
```

**An applied migration edited with no new migration to apply is exactly
the case the flag exists for**, and that shape reaches the early return
every time. Used as documented, it printed "nothing to apply" and did
nothing.

Found live: decision 0075 widened a standing invariant in migration
0009, which required refreshing the checksum. It reported nothing to
apply, which prompted the question of what it would have done.

---

## The eighth of a kind

One layer recording something no other layer reads:

| | |
| --- | --- |
| `cost_centre` | Column, no vocabulary entry |
| `extraction.confidence` | Fact set, never declared (0054) |
| Extraction settings | Configured, reaching nothing (0056, 0057) |
| UBL parser | 11 of 21 declared fields (0059) |
| `CIUS_PROFILES` | A name contradicting its own contents (0065) |
| Document storage | A whole layer nothing called (0068) |
| Content type | Derived from half a detection result (0069) |
| **This** | **A checksum written and never compared** |

The distinguishing feature here is that a **comment asserted the
verification was happening**. The other seven were silent; this one
said so in writing.

---

## The fix

The drift check runs **before** the nothing-to-apply return, comparing
every stored checksum against its file:

- **Drift, without the flag** — refuse, naming the files, and say what
  to do about it. The deployed schema no longer matches the file that
  claims to describe it, which for a regulated product is exactly the
  sort of divergence the bookkeeping exists to catch.
- **Drift, with the flag** — record the new checksum, naming each file.
- **No drift, with the flag** — say so plainly, rather than the previous
  message that implied it had looked.

Four tests, and three of them fail with the check disabled — the state
it shipped in. The fourth asserts an unedited migration is *not*
flagged, because a drift check that fires on every ordinary run would be
turned off within a week.

The refusal message names `--refresh-checksums`, because a check that
blocks work without saying how to proceed is a check people route
around.

---

## What it does not do

**The local replay path still does not verify.** `--replay-only` builds
a throwaway database from scratch every time, so a stored checksum has
nothing to drift from — the bookkeeping row is created in the same run
that reads it. Not a gap, but worth stating so the asymmetry is
deliberate rather than assumed.

**Nothing verifies at deploy time.** A Worker can be deployed against a
database whose migrations were edited; only running the migration tool
notices. Whether that check belongs in the deploy path is a separate
question about where the operator's discipline should live.
