# 0369 — Save Changes and Close, Top Right

**Status: built.** Reported live: "In the 'add a card' pop-out window,
please could the 'Save changes' and 'close' buttons move to the top
right of the box, so consistent with other screens."

---

## What changed

The "Add a card" pop-out's own `Save changes` and `Close` buttons sat
in a footer row (`.actionrow`) beneath the mover grid — the one
remaining place in the app still using that shape. Every other
comparable pop-out already puts its own action beside its own title:
the "Header Fields" pop-out's own close button, and decision 0300's
own `.statebuttons`-in-a-`.cardhead` pattern for Load and New
supplier — "the same title-left, action-right row Change Seller and
Header Fields already use." Moved both buttons into a `.cardhead` at
the top of the pop-out, in a `.statebuttons` wrapper — the exact,
established shape for more than one action beside a title, not a new
pattern invented for this one case.

**A genuinely dead CSS rule, found and removed.** `.actionrow`'s own
rule (decision 0122) was already unused everywhere else in the app —
the viewer's own bottom action row it was written for moved to its
own top-right buttons under decision 0298, and two existing tests
already confirm that row is gone from the viewer entirely. This
pop-out was the last caller. Removing it here left the class with no
definition and no use anywhere in the codebase, so the rule itself
was removed rather than left behind as a stale, misleading holdover.

## What has coverage

A new test opens the pop-out and confirms both buttons sit inside its
own `.cardhead`, in the order `Save changes` then `Close`, and that no
`.actionrow` remains inside the pop-out at all. Probed directly:
reverting the buttons to their old, footer-row position fails it. The
existing tests for what each button actually does — saving the
working set, discarding it on close — were unaffected, since neither
button's own behaviour changed, only where it sits.

`vf-ui`: 69 Worker (unchanged), 554 browser (was 553, +1). `vf-app`
and `vf-licence` untouched — layout only.
