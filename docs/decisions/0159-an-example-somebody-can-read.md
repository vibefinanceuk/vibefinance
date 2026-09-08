# 0159 — An example somebody can read

**Status: built.** A worked example leads with what the rule turns on,
and folds the rest away.

---

## A wall of thirty fields

Reported with a screenshot:

> The worked examples seem complex and difficult to interpret.

They were. Each example printed every fact on the invoice —

```
BT-1 INV-2023-00123 · BT-3 380 · BT-5 USD · BT-2 2023-06-20 · BT-9 …
```

— thirty fields, in which the **one number the rule turns on** sat
somewhere in the middle.

**Somebody confirming is being asked *"is this outcome right"*, and they
cannot answer without seeing why it came out that way.** The activation
gate (decision 0034) is worth nothing if the evidence is unreadable —
the same argument decision 0153 made about the read-back.

---

## The system already knew which fields mattered

Decision 0034 builds the worked-examples prompt from *"every field those
conditions actually reference, extracted by walking the rule's
combinator tree."*

**The screen had the same rule in front of it and did not ask.** So it
walks the tree too, and shows those fields first and in full.

---

## The rest is folded, not dropped

**An example is evidence, and evidence somebody cannot inspect is an
assertion.** A supplier name or a currency may be exactly what makes an
outcome wrong, and hiding them outright would ask somebody to trust the
choice of what mattered.

*"and 26 other fields on this invoice"*, expandable.

---

## And a derived field had no name

`invoice.duplicate_confidence` rendered raw, beside `BT-112` reading
*"total with VAT"*.

`/field-visibility` serves `INVOICE_FIELDS` only — **and that was
right**: derived fields are computed by the platform and never keyed, so
a screen about what may be edited had no reason to mention them.

**A screen about rules does**, and a rule can test either. The
descriptions travel on the same response rather than a route of their
own: a screen needing one needs both, and a second call is a second
thing to fail.

---

## What is not built

- **The folded facts are unsorted.** They come out in whatever order the
  example was written, which for thirty fields is no order at all.
- **Nothing shows why an example fires.** *"Fires"* is asserted; the
  decisive value is shown beside it, and the connection is left to the
  reader.
- **A rule with no conditions at all** would mark nothing decisive and
  fold everything, which is correct and would read as though the
  example were empty.
