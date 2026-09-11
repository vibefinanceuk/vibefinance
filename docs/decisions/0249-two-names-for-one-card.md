# 0249 — Two names for one card

**Status: fixed.** Every card type has one name, and the flaky test was
a race with a number on it.

---

## The picker listed its own keys

`dash.waiting_for_me`, `dash.on_my_clock`, `dash.where_things_are`,
`dash.exceptions_by_supplier`, `dash.needs_somebody` — **shown to a
person choosing what to see.**

The picker asks for `dash.<card_type>`. The card headings used
different keys: `dash.waiting`, `dash.myclock`, `dash.wherethings`.

**Four worked by accident**, because `ageing`, `done`, `received` and
`items_at_stage` happen to be the names both ends had chosen.

**Two names for one thing**, which decision 0236 already cost a
morning. The card type is the name now, and both ends read it.

---

## And the coverage test could not see it

`string-coverage` lists every key **the migrations define** and checks
they exist — which is a list checked against itself, and decision 0236
said so in those words while I was writing this exact fault.

**A key built at runtime is invisible to a grep for `t("dash.x")`.** The
picker composes `` `dash.${type.cardType}` ``, so no search of the
source would have found it either.

So the new test reads **both ends**: the literal lookups in
`dashboard.js`, and the names built from `CARD_TYPES`. Watched to fail
by taking one card type's name out.

**And migration 0071 carries a standing invariant** pairing every
`dash.about.*` with its `dash.*` — so a card added with a description
and no name fails at the database rather than on a screen.

---

## The flaky test was never a mystery

`"reaches Tasks from Documents"` has failed intermittently for three
sessions. **I recorded it as not understood in decision 0244 and moved
on, twice.**

It slept **40 milliseconds** after each click, waiting on a dynamic
import and two stubbed fetches. Enough alone; not enough in a full run.

**A fixed sleep in an async test is a race with a number on it.** It
waits for the condition now — the nav highlight moving — and three
consecutive full runs pass.

**The lesson is not about timing.** I had the evidence twice — *passes
alone, fails together* — and treated it as noise because chasing it was
not what I was doing at the time.
