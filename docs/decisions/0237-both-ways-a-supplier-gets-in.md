# 0237 — Both ways a supplier gets in

**Status: built.** *Load* and *New supplier*, side by side, with icons.

---

## Two acts, one question

A **load** brings many at once from the ERP. **Recording one** brings a
single supplier the ERP does not have yet (decision 0231).

**Different acts and the same question** — *how does a supplier get into
this list* — so a person looking for either should find both. The new
button sat above the load panel and now sits inside it.

---

## The icons say which is which

**`load` is a file going up** — the inverse of `save`, whose arrow goes
down into a tray. One takes something out of the screen and the other
puts something in.

**`newsupplier` is a person with a plus.** Not a bare plus, which would
say *add a row*: this adds a **party**, and the figure is what
distinguishes it from the load beside it, which is about the file rather
than about anybody.

---

## *New supplier*, not *Record a new supplier*

Beside a *Load* button of the same size, a label three times as long
**stops being a label and starts being a sentence** — and the two are a
pair a person reads together.

---

## And a button that looked fine and did nothing

**`actionLink` disables a button with no `onclick`**, which is decision
0161's rule that an action with nothing to do says so.

Both of these were built by constructing the button and assigning
`.onclick` **afterwards** — leaving them **disabled**, with the icon,
the label and the hover all present.

**The tests caught it**, because two of them click Load. But **nothing
would have caught the other**: *New supplier* had no test that clicked
it, and it would have shipped as a button that did nothing at all.

There is one now, and it asserts no `actionlink` on the screen is
disabled — **named by label**, so a failure says which.
