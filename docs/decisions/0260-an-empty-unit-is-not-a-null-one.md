# 0260 — An empty unit is not a null one

**Status: fixed.** The Documents screen returned nothing, for anyone,
with no unit chosen — which is every visit before today's dashboard
cards gave someone a reason to look closely.

---

## Reported live

> The links from the card launches the Documents screen, which appears
> empty. The search returns nothing.

**Predates decision 0259 entirely.** The exact line responsible existed
unchanged in the commit before this session touched anything, on both
ends:

- `documents.js` builds its request with `new URLSearchParams({ q:
  query, unit })`, which includes the `unit` key even when it is an
  empty string — it does not omit a key just because the value is
  falsy.
- `documents-route.ts` read that param with `params.get("unit")` and
  bound it straight into SQL, with nothing turning `""` back into a
  real `NULL`.

---

## What actually happened, shown rather than argued

```
unit bound to empty string: []   <- what the real frontend has always sent
unit bound to real NULL:    [...] <- what every existing test sent instead
```

`(?1 IS NULL OR h.org_unit_id = ?1)` with `?1` bound to `""` is neither
branch: an empty string is not `NULL`, and no real `org_unit_id` is
ever the empty string either. **The clause matched nothing, for anyone,
on every ordinary visit** — search included, since the base list was
already empty before the free-text filter ever ran.

---

## Why no test had caught it

Every existing test built its request from a **query string**:
`new URLSearchParams("")`. Parsing an empty string produces zero
entries, so `.get("unit")` genuinely returns `null` — a different
request from the one the real screen sends, which constructs a
`URLSearchParams` **object** with the key always present.

**The two constructions are not the same request**, and the gap
between them is exactly where this lived, for as long as the screen
has existed, unnoticed because nothing had sent real traffic through
it with anyone watching closely — until a dashboard card gave someone
a reason to click through and look.

---

## The fix, and the new test

`const unit = params.get("unit") || null;` — a real `org_unit_id` is
never an empty string, so this loses nothing while restoring the
`NULL` the SQL clause has always needed.

**The new test builds the request the way the screen actually does**:
`new URLSearchParams({ q: "", unit: "" })`, not a query string. Watched
to fail against the original code, confirming it catches the actual
fault rather than a resemblance of it.

---

## What this means for decision 0259

**Nothing about the split cards was wrong.** `unplacedDocuments()`'s
count, the `unplaced=1` carve-out, all correct — the click landed on a
screen that had never worked with no unit selected, for anyone, and the
new cards were simply the first traffic to actually exercise that path
with someone paying attention to the result.

vf-app: 1443 tests.
