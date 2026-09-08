# 0172 — A field with no word

**Status: fixed.** Every field a screen renders has a label, checked
against what the resolver actually returns.

---

## `field.description` on a screen

Reported from a screenshot of the line table: the column header read
**`field.description`**.

Decision 0171 added the line description as a **displayable field rather
than a vocabulary one** — deliberately, since no rule can test it — and
every field label comes from `field.<code>` in D1. I added the field and
never wrote the word.

---

## Why nothing caught it

Decision 0158 built exactly this check for actions and operators, and it
derives its list **from the vocabulary**:

> A hand-kept list would have had the same gap.

**A field deliberately outside the vocabulary can never appear in a list
derived from it.** The check was right and its source was too narrow.

It now asks what a **screen is given** rather than what the standard
defines: `INVOICE_FIELDS` plus the displayable fields decision 0171
adds. Watched to fail — it names `description` by name.

---

## And a column that is empty on every invoice

The same screenshot shows `#` and `Line no.` side by side, and the
second reading `—` on all eight rows.

They are different things and both legitimate: `#` is **our row
counter**, and `Line no.` is **`BT-126`, the supplier's own line
identifier** — the "10, 20, 30" a printed invoice often carries.

**Nothing extracts it**, the same gap as `BT-152`. So a customer sees a
column that has never had a value in it, beside one that always does.

Not fixed here, and worth naming: a field the vocabulary defines and
extraction never fills is **a column that teaches somebody to ignore
columns.**

---

## What is not built

- **`BT-126` extraction**, so the column stays empty.
- **Nothing hides a field that is always empty.** Field visibility is
  configured per stage (decision 0114) and nothing infers it from what
  documents actually carry.
