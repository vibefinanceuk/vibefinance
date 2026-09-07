# 0139 — Day time and night time

**Status: built.** A Mood control in every screen's top bar, and a blue
palette in place of the warm greys.

---

## A person's setting, and it now has a control

Decision 0108 settled *whose* setting this is: **light and dark are
comfort and accessibility, not brand**, and a customer forcing one on
everybody is a support ticket. A customer's livery sets the accent
(0096); this sets the surfaces.

What it lacked was a way to say so. The interface followed the operating
system and offered nothing — fine for somebody whose machine already
matches how they want to work, and no use to anybody else.

---

## Two options, and no third

A *"follow the system"* entry would be honest, and would make the
control read as **three states when the screen has two**.

So the initial **selection** is derived from the system instead:
somebody whose machine is dark opens the screen with *Night time*
already chosen, and choosing anything stores it.

---

## Blue, and not black

**Lighter blues by day, dark midnight blues at night** — asked for by
name, and a change from the warm greys the interface had.

The daytime surfaces stay close together, so decision 0108's panels
separate by **border rather than by contrast** — the same restraint that
record asked for at the level of the page.

**Night is `#0d1626`, not black.** A true black surface makes a white
document glare in the preview panel (decision 0123), and this is a
screen somebody reads all day.

---

## Applied before the first paint

An inline, synchronous script in `<head>`, and `data-mood` on `<html>`
rather than a class on `<body>`.

**A module loaded normally runs after the stylesheet has painted**, so
somebody who chose Night time would see a white flash first. That is the
failure decision 0103 records as *the one a person notices and nobody
tests* — the login screen flashing on every refresh, found by somebody
looking at it.

`<html>` is the only element that exists that early.

---

## The night palette is written twice

A single rule cannot express *"dark unless overridden, or when chosen"*
without `:where()` gymnastics that read worse than saying it twice.

So the media query is scoped `:root:not([data-mood="day"])` — a dark
machine yields to an explicit day choice — and `:root[data-mood="night"]`
repeats it.

**A test asserts the two agree**, token by token, so they cannot drift.
Watched to fail: changing one surface in one block breaks it.

---

## What is not built

- **It does not follow a person between machines.** Stored in
  `localStorage`, so a new browser starts from the system again.
  Storing it server-side would mean fetching it, which means a flash —
  the thing this decision went to some trouble to avoid.
- **Nothing else varies.** Spacing, type scale and the brand accent are
  identical in both, which is right for now and may not survive somebody
  actually working at night.
- **The sign-in screen has no control.** It has no top bar to put one
  in, so it follows the system alone.
