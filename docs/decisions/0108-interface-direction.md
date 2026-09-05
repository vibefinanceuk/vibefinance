# 0108 — What the interface should look like

**Status: agreed direction.** Recorded before more screens exist,
because two screens' worth of choices made in passing is the cheapest
moment to set a direction and the last easy one.

---

## Where this came from

A reference screen the operator shared as *"a look and feel closer to
how the interface should look"* — an invoice validation view. Taken as
**visual direction rather than a specification**: several of its
elements have nothing behind them yet, and building toward a screen
where a third of the panels have no data would end badly.

What follows is what the reference gets right, stated as principles
rather than as a layout to copy.

---

## 1. Panels, not a column

Content is grouped into bordered cards, each with a heading and each a
thing somebody can look at on its own: header, totals, lines, checks,
actions.

The current screens put everything in one undifferentiated column.
**Grouping is what lets somebody find the part they need** without
reading the parts they do not.

---

## 2. A persistent frame

Navigation on the left and the document's identity in a header, both
always visible.

Today the viewer **replaces the entire screen**, which loses the list,
the filter and the scroll position. Opening a document should feel like
looking at something, not like going somewhere and having to find your
way back.

---

## 3. Status first, and separately

A row of status answering *"is this alright?"* **before** the detail
explaining why. Somebody scanning forty documents reads that row and
nothing else on most of them.

Decision 0101 put restraint in service of legibility; this is the same
argument at the level of the page rather than the paragraph.

---

## 4. Actions collected in one place

One vertical group, one primary, the rest secondary — rather than
buttons scattered across rows and page bottoms.

**What appears there is still the server's decision** (decision 0103): a
task reports its own `actions`, and the panel renders them. Collecting
them visually does not move where they are decided.

---

## 5. Dense tables, quiet chrome

Thin rules, restrained headers, numbers right-aligned with tabular
figures, generous horizontal space. **Reading a line table should not be
work.**

---

## 6. Colour carries meaning, and nothing else

Green for passed, one accent on the primary action, everything else
grey. Colour used decoratively is colour that cannot be used for
meaning.

This is also what makes white-labelling safe (decision 0096): if the
only branded colour is the accent, a customer's livery changes the
accent and nothing about legibility.

---

## Dark and light is the person's setting, not the customer's

`tokens.css` already declares `color-scheme: light dark` and every
surface is a token, so both work today.

**It should stay a person's choice.** Dark mode is comfort and
accessibility, not brand — a customer forcing one on everybody is a
support ticket. A customer's livery sets the accent; the operating
system sets the surfaces.

---

## The constraint a mockup never shows

**A three-column layout wants a wide screen.** At 1280px — an ordinary
laptop — three columns become cramped in a way a mockup rendered at
1536px does not reveal.

So the panels have to reflow rather than shrink: three columns on a wide
monitor, two on a laptop, one on anything narrower. **Worth knowing what
these people actually work on**, and worth building for the smaller
answer until somebody knows.

---

## What this means for what exists

- **The task list** is close: dense, quiet, numbers aligned. It needs a
  frame around it.
- **The viewer** is furthest away. It replaces the screen, puts
  everything in one column, and hides the document behind a button. It
  wants panels, a persistent header, and the document visible.
- **Neither has navigation**, because there is nowhere else to go yet.
  The frame should exist before there is, or every screen added
  afterwards has to be retrofitted into it.

---

## Deliberately not decided here

- **Density for different readers.** A clerk working a queue all day and
  a manager glancing at it want different row heights. One density for
  now; a preference if somebody asks.
- **Where failures appear.** Today a refused action writes a line under
  the list. Inline, banner, or persistent-until-dismissed is a real
  choice and the current one is the weakest of the three.
- **Whether the interface ever blocks.** Decision 0072 made validation
  advisory and never blocking. The inclination is to generalise that —
  let the server decide and report — but it has not been decided.
