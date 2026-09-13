# 0284 — Back joins the row it always sat in

**Status: built.**

---

## What was reported

> I've noticed the "Back to tasks" also appears to not comply with the
> style, and missing an icon. Please can this be updated to read
> simply "Back".

A screenshot showing it beside the newly-fixed Sign out button — a
bordered rectangle with plain, wrapped text, next to a clean
icon-and-label button in the same row.

## Why it looked different

It was a plain `<button>` with no class at all, which falls back to
`tokens.css`'s own generic button styling — a bordered, padded
rectangle built for an ordinary form control, never updated when
decision 0283 gave Sign out (right beside it, in the same topbar row)
the quieter `.actionlink` treatment.

## The fix

Rebuilt with `.actionlink` and an icon, matching Sign out exactly —
the two buttons in that row now share one visual language instead of
two. Wording shortened from "Back to tasks" to "Back" via the
established `UPDATE ui_strings` pattern, in both languages.

**A new icon, not a reused one.** Two existing icons could plausibly
have been reached for — `return` (a document sent backward through
the workflow) and `restoredefault` (settings undone) — and neither is
what this button does. A plain left arrow was drawn instead: honest to
"go back to the list" and nothing more, rather than borrowing a shape
that would have claimed an action this button does not take.

## What has coverage

Two tests, on a button that had none before this: one confirms the
button now reads "Back," carries an icon, and shares the `.actionlink`
class the rest of the topbar's own buttons use; the other confirms
clicking it still calls the close handler exactly as it always did.
Both probed by reverting to the original plain button — the second
test failing too on that revert is itself informative: the old button
carried no `title` attribute at all, so a test written for the new one
cannot even locate the old one, which is its own small confirmation of
what the fix actually changed.

vf-ui: 49 Worker, 341 browser. vf-licence: 320.
