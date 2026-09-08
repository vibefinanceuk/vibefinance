# 0165 — Showing the viewer

**Status: fixed.** Opening a document from the document manager shows
the viewer.

---

## Nothing appeared to happen

> Neither the expand nor the document link launch anything.

`openViewer` **renders into `#viewer` and does not unhide it.** The task
list swaps the two panes itself, three lines before calling it:

```js
document.getElementById("shell").hidden = true;
document.getElementById("viewer").hidden = false;
```

Decision 0164's document manager called `openViewer` without doing that,
so the viewer rendered correctly into a hidden element and the screen
sat unchanged.

**The second caller of a function that needs preparation is the one that
finds out the preparation exists.** Until now `openViewer` had exactly
one caller, so the knowledge lived in the caller and nothing said so.

Fixed by matching, and recorded as duplication rather than pretended
away: a third screen opening a document will need the same three lines,
and the right answer is for `openViewer` to own its own visibility.

---

## And a label that was never seeded

The Expand button read `viewer.expand`, because that key does not exist
— decision 0164 invented it while `column.expand` already said the same
thing.

**One word, one key.** The column and the button are the same act, and
two keys for it is two places to translate and one to forget.

Decision 0158's coverage test derives action and operator labels from
the vocabulary and catches a missing one; **screen strings have no
equivalent**, because they are not enumerable from code. This one was
caught by eye.

---

## What is not built

- **`openViewer` still does not own its visibility**, so the next caller
  will find this again.
- **Nothing tests that a rendered key never reaches a screen.** A
  missing string shows as `viewer.expand` and every test that asserts
  through `t()` passes, because the stub has whatever the test gave it.
