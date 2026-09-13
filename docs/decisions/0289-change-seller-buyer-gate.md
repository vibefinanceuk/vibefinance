# 0289 — Change Seller and Change Buyer reach the same gate

**Status: built.**

---

## What was reported

> I can see that field edits are locked when I am not the owner of the
> document. I was able to click the Change Seller and Change Buyer
> buttons on invoices that are not claimed to my user. So it might be
> necessary to also lock down those fields, if I am not the owner of
> the task.

Decision 0288 shipped, was tried live, and a real gap in its own
coverage was found by using it.

## Why the gate didn't reach these two

`canEditAnything` gates the Save button and every field's own
rendering — both go through `field()`, and both were checked directly
when 0288 shipped. "Change Seller" and "Change Buyer" are a third,
separate thing: rendered by `cardHead()`, a shared helper called
unconditionally from both party cards, never wired to
`canEditAnything` at all. Reassigning who an invoice is from or billed
to is exactly the kind of edit 0288 was written to gate — the fix
simply hadn't been carried to every place capable of one.

## Checked for more, not just the two reported

Before writing the fix, every `onclick` handler in the viewer was read
to check whether the same gap existed anywhere else. "Add line" and
"Remove line" were already correctly wrapped in `canEditAnything` —
decision 0144's own reasoning, quoted in the code, is the identical
argument 0288 later made generally: *"an approver on a read-only stage
could add a line and save it."* The seller and buyer search popups
themselves take no gate of their own, and need none — both are only
ever reachable through `cardHead()`'s own action, confirmed by reading
every call site, so closing the door there closes it for what is
behind it too.

## The fix

One line, in the one shared place both cards already call through:
`cardHead()` now renders its action only when `canEditAnything` is
true, the same condition already gating Save and every field.

## What has coverage

The two existing tests proving these actions are offered when a
document is matched, and when neither is, both already open with the
shared `TASK` fixture, `ownership: "mine"` — unaffected by this
change, confirmed by the full suite passing before and after with an
unchanged count where nothing new was added. One new test, proving the
actual gap: an unclaimed task, opened with a matched Seller and Buyer,
shows neither "Change Seller" nor "Change Buyer." Probed by removing
the new condition and confirming that specific test, and only that
one, fails.

vf-ui: 49 Worker, 350 browser. No migration.
