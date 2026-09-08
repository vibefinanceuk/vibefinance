# 0149 — The rules screen

**Status: the list is built.** What rules exist, at which stage, and
which are running. **The authoring flow is designed and not built** —
see the mockup and the note at the end.

---

## The stage organises the page

The operator's own observation, from the mockup:

> The stage is important to understand at what point the rule executes.
> It would be a good visual to show the complete sequential set of
> stages, so a user understands at what point in the process a rule will
> execute.

**And it goes further than orientation.** A rule fires at a stage, and
what it can test depends on what has already happened to the document by
then. An invoice at Received has not been keyed, so a rule there testing
the total is **silently dead** — the failure class this project keeps
finding, and one the sequence makes visible rather than discovered.

**Chevrons rather than tabs.** A tab row says *"pick one of these"*; a
sequence says *"the document passes through these, in this order"*, and
the shape should carry that.

**A stage with no rules is shown, not hidden.** Somebody wondering why
nothing happens at Coding needs to see that Coding is empty, which an
omitted row cannot tell them.

---

## Nobody asks what rules exist

They ask *"why did this invoice get held"*, and the answer is found at
the stage it was held at. **Most visits are to read, not to write** —
which is why the list came before the authoring flow.

**No route listed rules.** Compiling, confirming and activating all had
one; seeing what is already running did not — the same gap decision 0128
found with processes, where somebody could create one and never see it.

### The sentence, not the compiled rule

`rule_versions.source_text` holds what somebody actually wrote. **A
person recognises their own words**; nobody recognises
`{"field":"BT-112","operator":"greater_than","value":10000}`.

### Four words, not four columns

The database records `enabled`, `approved_at`, an effective window and a
count of confirmed examples. A person wants to know whether it is
running.

**Paused and draft are different on purpose**: one was trusted once and
the other never has been. And *"2 to confirm"* rather than *"awaiting
confirmation"*, because the number is what decides whether somebody
opens it now.

---

## Internationalisation, branding, white-labelling

Three constraints already settled, and this screen had to satisfy all
three rather than be retrofitted.

**Every word comes from D1** (decision 0107). Twelve keys, in both
seeded languages, and `string-coverage.test.ts` derives its expectations
from the code — so a key added without a German value fails rather than
reaching a screen as `rules.title`. A test here swaps the locale
entirely and asserts the English is gone.

**The icons take the customer's livery** (decision 0096). They are drawn
with `stroke="currentColor"` rather than fetched, and that is the
reason: **a mark that cannot take a colour cannot be white-labelled.**
The same property makes them follow the mood (0139) without a second
set.

**And nothing here is VibeFinance's.** The brand mark stays in the
navigation frame (0145); this screen contributes no logo, no colour and
no name.

---

## Two things found while building

**The icons had to move.** Decision 0122 put them in `viewer.js` because
that was the only place using them. A second screen needed them, and
copying eight paths is copying eight paths that can differ — so
`icons.js`, with the four new ones beside the eight.

**And the navigation marked the wrong entry.** It read
`current === "sources" ? "" : "on"` — written when there were two
screens, so *"not sources"* meant *"tasks"*. A third screen made it
wrong, and it marked Tasks while showing Rules.

**A comparison that only works while a list has two members is a
comparison that breaks silently when it gains a third.**

---

## What is not built

- **The authoring flow.** Compile, read the rule back in words, confirm
  each worked example, activate. Every route exists; the screen does
  not. The mockup covers ten states of it.
- **A rule cannot be opened.** The list shows what exists and nothing
  leads anywhere, which is the next thing somebody will try.
- **No backtest.** Testing a rule against invoices already captured is
  cheap — decision 0003's interpreter is a pure function and the facts
  are already stored — and no route offers it.
- **Nothing checks a rule against its stage.** A rule testing a cost
  centre at Validation matches nothing, every time, without erroring.
  The mockup shows the warning; nothing produces it.
