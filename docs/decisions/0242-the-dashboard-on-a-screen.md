# 0242 — The dashboard, on a screen

**Status: built.** Decision 0240's nine cards, drawn.

---

## No charting library

This app is vanilla modules with no build step, and **a charting
dependency would be the first** — for four shapes that are forty lines
each.

`charts.js` has a sparkline, a bar chart, a donut and a bar list.
**Every colour comes from a token**, which decision 0223 learned the
hard way: a variable nothing defines is not an error, it is
transparent, and a chart drawn in an invented hex looks fine until
somebody changes the theme.

**Two of the four are unused here**, deliberately. A sparkline needs
history and decision 0240 returns none — **a trend drawn from one point
is a decoration that implies a claim.** A donut needs a proportion, and
the one worth showing is a flow metric `stage_visits` cannot yet answer.

---

## A chart palette, because the others mean something

`tokens.css` had accent, success and warning, and three colours carried
every chart in the mock-ups.

**Those mean something.** Accent is *this*, warning is *look at this*,
success is *good*. A five-category chart borrowing them would say a
category was a problem **because it happened to be third.**

So five categorical colours, **quiet and carrying no verdict** — and a
chart that does need to say *this one is late* still reaches for
`--text-warning`, which is the point of keeping them apart.

Defined in all three places the text colours are: daytime, night, and
the dark-scheme media query.

---

## And the type scale gained a step

It stopped at 20px, because **nothing displayed a number.**

A dashboard does: a count is the whole content of its card, read at a
glance rather than in a line of prose. `--text-figure: 32px`, at the
scale's own ratio twice over so it belongs to the series rather than
being a size somebody liked.

**Found by a test**, not by me — decision 0110's typography check
refused three hardcoded sizes.

---

## Due today is not one day overdue

`BT-9` is a date with no time; `Date.now()` has one. Dividing the
difference makes **"due today" read as "1d overdue" from lunchtime
onwards.**

**Found by a test failing off by one**, which I first assumed was the
test's fault. It was not: on a screen somebody uses to decide what to
pay, that is a wrong number.

---

## What is not built

- **No library.** The card types are fixed and a person cannot add,
  remove or reorder. `dashboard_cards` takes rows and only a test writes
  any, so `items_at_stage` — the parameterised one, and the reason the
  schema exists — is unreachable from the interface.
- **No flow metrics**, blocked on `stage_visits` recording a start and
  no end (decision 0240).
- **No history**, so no sparkline. Every card is a photograph, and
  *"waiting for me: 12"* does not say whether that is better or worse
  than Monday.
