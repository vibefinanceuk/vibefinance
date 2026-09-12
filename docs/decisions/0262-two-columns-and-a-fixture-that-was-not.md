# 0262 — Two columns, and a fixture that turned out not to be one

**Status: built.** The card picker, and the dashboard's own toolbar.

---

## What was asked

> I picture two columns — "Hidden cards" on the left and "Displayed
> Cards" on the right. A user can use center arrows to add (move
> right) or remove (move left) cards... could the Arrange, Done
> arranging, Add a card, Restore default button have icons and be
> displayed similar to other screens, such as the document viewer.

---

## The toolbar

Four new icons — sliders for *Arrange*, a checkmark for *Done
arranging*, a plain plus for *Add a card*, a curling arrow for
*Restore default* — and a small `toolButton` helper that builds the
same shape `viewer.js`'s `actionLink` does: icon above label, in an
`.actionrow`.

**Not the same string convention, on purpose.** `actionLink` is keyed
to `action.*` and tested against a fixed list of real invoice actions
(decisions 0229/0236). This toolbar arranges a dashboard, not a
document — same visual family, `dash.*` strings, kept outside that
test's list rather than stretching its meaning to cover something it
was never about.

---

## The mover

**A working copy, not the live one.** `save()` reloads the whole
dashboard and re-renders the page on every call — right for one add,
wrong for a session of several moves back and forth, since each save
would tear down the popout it was called from. The mover works on a
clone of `cards` and only touches the real array once, on *Save
changes*.

**`items_at_stage` never leaves the hidden column.** Every other type
disappears from hidden once it is displayed, because only one instance
of it can exist. A repeatable type can always take another — one for
Validation and one for Approval, both live — so it stays offered
regardless of how many instances already exist, and each instance
shows on the displayed side labelled with its own stage.

**An arrow with nothing to do does not accept a click** — decision
0161's rule, held here as everywhere else in this dashboard a control
can lead nowhere.

---

## What the debugging actually found

The mover worked correctly the first time it was built — confirmed by
a standalone script printing the exact DOM. Four tests still failed,
and only when run as part of the full suite, never alone.

**The first theory was wrong**, and worth recording as wrong rather
than quietly discarded: a fixed single-tick wait after a fire-and-forget
click handler looked like exactly the class of fault decision 0249
found before, so the fix attempted was more waiting, polled rather
than fixed. It did nothing, because the fault was never about timing.

**The real mechanism**: `stubAll`'s mocked `fetch().json()` returned
`cards` — the test file's own `const ONE` array — **by direct
reference**, never cloning it, unlike a real HTTP response, which is
always a freshly deserialised object. `remove()`'s `cards.splice()` and
the mover's own `cards.length = 0; cards.push(...)` both mutate in
place. Since the mock hands back the exact object `ONE` points to,
either call **permanently emptied the shared fixture**, for every
later test in the file, however many tests away the mutation happened
to run.

Fixed by returning `[...cards]` from the mock — a shallow copy, which
is what a real response is. **Probed directly**: reverting the clone
reproduces exactly three of the original four failures.

**The fourth was a separate, real fault in the new test itself** — it
asserted a card type could reappear in the hidden column after
removal, using a type (`waiting_for_me`) the test's own stubbed
catalogue never listed as a type at all. No amount of fixing the mock
could have made that true; rewritten to use a type the catalogue
actually offers.

---

## What is not built

- No drag-and-drop between columns — click to select, then the arrow,
  matching a classic dual-listbox control rather than a newer gesture.
- No reordering inside the mover itself; a card's position is still
  set by where it lands (appended) and adjusted afterward with the
  tile's own up/down handles, unchanged from decision 0243.

vf-app: 1443 tests. vf-ui: 49 Worker, 287 browser — confirmed stable
across four consecutive full runs plus a direct probe of the fix.
