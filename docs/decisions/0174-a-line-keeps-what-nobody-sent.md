# 0174 — A line keeps the facts nobody sent

**Status: fixed.** Saving a line no longer destroys what the screen did
not send back.

---

## The descriptions were gone from the data

> The descriptions appeared in validation, but not in approval.

Not a screen difference. The lines on the invoice at Approval read:

```
{"BT-130":"EA","BT-129":1,"BT-131":1797.47,"BT-151":"E","BT-126":"1"}
```

**No description at all** — and `BT-130`, `BT-129` and `BT-151` had
appeared, which is somebody keying at Validation. The save wrote the
descriptions away.

---

## Replacing the set, replacing the facts

`handleUpsertInvoice` deletes every line and writes the payload back,
for a stated and good reason:

> Full replace of the line set — never a partial merge, so a caller can
> never end up with a mix of old and new lines by accident.

**That protects the set of lines. It destroyed the facts within each
one.**

The viewer sends only the fields it renders as **inputs**, and decision
0171 had just made `description` read-only — so it stopped being sent,
and stopped existing.

### Decision 0120 fixed exactly this, for headers

> Records the value, and **merges rather than replacing** what intake
> learned.

Header facts have merged since. **Lines were never given the same
treatment**, and nothing noticed because until decision 0171 nothing on
a line was read-only: every fact the screen held, it also sent back.

**Making one field read-only turned a latent bug into a live one.**

---

## Merged by line number, and the set still replaced

What was sent wins; what was not sent survives. A line number that did
not exist inherits nothing, so a new line cannot pick up another's
description.

**And removing a line still removes it** — the guarantee that was right
stays right.

---

## What is not built

- **The descriptions already lost are lost.** Nothing recovers them
  short of re-reading the document, and the original bytes are retained
  (decision 0055) so a re-extraction could.
- **Merging is by line number**, which is the screen's own position
  (decision 0173). Reordering lines while editing would merge the wrong
  facts into the wrong rows, and nothing prevents that.
