# 0156 — A box to write in

**Status: fixed.** Every `textarea` fills the width it is given, and the
rule box stops where prose stops being readable.

---

## Nothing set a width

Reported with a screenshot: the box for writing a rule sat at roughly a
fifth of the panel beside it.

`tokens.css` set `min-height` on a `textarea` and **no width at all**,
so a browser's default of about twenty characters applied. That looked
reasonable in a narrow form and absurd in a full-width panel.

**I fixed the wrong dimension first.** Decision 0154 answered *"the box
is very small"* by setting `rows` from three to six — taller, and no
wider, which is not what anybody was looking at.

---

## Fixed in the tokens, not on the screen

**Every textarea in this interface is a box somebody writes prose
into**, and none of them wants a browser's guess. Setting it on the rule
screen would leave the next one to rediscover it.

---

## And it stops at 62 characters

A rule box filling 1600px would put a clause at each end and nothing in
the middle. **A sentence is read on one line**, and the type scale
already assumes a comfortable measure (decision 0124).

`max-width` rather than `width`, so it still fills a narrow window.

---

## What is not built

- **Nothing else is measured.** The read-back, the refusal and the
  worked examples all run the full width of a panel, and a long
  condition list would read as badly as the box did.
- **No test looks at rendered width.** `jsdom` has no layout (decision
  0121), so these assert the rule exists rather than that a box is wide
  — which is the same gap that let the original slip through.
