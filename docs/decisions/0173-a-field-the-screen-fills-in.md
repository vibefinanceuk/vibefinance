# 0173 — A field the screen fills in

**Status: fixed.** Line editing works again, and the row counter is
gone.

---

## Every line edit at Validation was refused

> I'm hitting an issue in validation, that I am not allowed to modify
> line information. I get a message saying "this stage does not permit
> editing those fields".

**The viewer sets `BT-126` itself**, to each line's own position, so a
document carrying no line numbers still has them. `BT-126` is `read` by
default — the supplier's identifier, not something a person types.

Decision 0164 widened the editability check to run on every save rather
than only where a stage restricted something. **Widening the check
widened what it refused**, and the screen's own value met a rule written
for a person's.

So a save carrying eight lines was refused for the one field nobody had
touched.

### Exempted by name

`BT-126` is the one field the interface derives. Every other read-only
field still refuses, and the test proves it: a stage that makes `BT-131`
read-only still rejects a `BT-131` edit, and names only that field.

**Not by relaxing the rule**, because the rule is what stops an approver
editing an amount.

---

## And the row counter goes

> If the column number (our number) is only for sequencing, it need not
> be displayed. If the Line No. does not appear on the invoice, I think
> we use our sequence number as the Line no. by default.

**The viewer already did the second part** — that is precisely why the
refusal happened. So `#` and `Line no.` were two columns of the same
numbers, and one of them said nothing.

`#` is gone. `Line no.` carries the sequence where a document does not
give one.

---

## What is not built

- **A supplier's own line numbers are never read.** The screen supplies
  the position on every document, so a UBL invoice numbering its lines
  10, 20, 30 has that replaced by 1, 2, 3 — which is wrong, and was
  wrong before this.
- **`SCREEN_SUPPLIED` is a list of one.** A second derived field would
  join it, and nothing connects the list to the screen that actually
  derives them — so the two could disagree.
