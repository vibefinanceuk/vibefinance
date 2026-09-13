# 0306 — The supplier pop-out's own buttons, top right

**Status: built.**

---

## What was asked

> On the Suppliers Page - upon selecting a supplier, it launches a
> pop-out. Please can you move the buttons - Release Hold / Hold,
> Activate / Deactivate, Save and Close to the top right of the
> pop-out.

## What was built

Release Hold/Hold, Activate/Deactivate, Save, and Close — decision
0236's own `.statebuttons` row, already grouped together at the
operator's earlier asking — used to sit as its own row between the
warnings and the edit form. Wrapped, together with the supplier's own
name, in a `.cardhead`: the same title-left, action-right shape
already used for Change Seller and the Invoice header's own Header
Fields pop-out, rather than a fifth version of the same layout.

**Decision 0236's own reasoning is unchanged, not undone.** All four
still act on the supplier and still sit in one place, exactly as that
decision argued for; only where that one place is within the pop-out
has moved. `.cardhead .statebuttons { margin: 0; }`, added generically
in decision 0300 rather than scoped to the screen it was first needed
on, already covered this nesting with no further CSS required.

## What has coverage

No test had ever checked this pop-out's own button layout before —
confirmed by searching for it directly rather than assumed. Two new
tests: one confirms all four buttons render inside the pop-out's own
`.cardhead`, beside the supplier's own name, in the order the code
builds them, and that nothing is left behind in a stray `.statebuttons`
row elsewhere in the pop-out; a second confirms Close still works from
its new position. Both probed directly — reverting the `.cardhead`
wrapping back to plain siblings fails both, for the reason each was
written to catch.

vf-ui: 49 Worker, 391 browser (was 389). No migration.
