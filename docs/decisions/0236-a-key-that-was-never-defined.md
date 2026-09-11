# 0236 — A key that was never defined

**Status: fixed.** `action.activate` exists, Close has an icon, and the
supplier actions sit in one row.

---

## Reported by reading a button

> Can you make available the text for `action.activate`, which I think
> is the coded value.

**It was.** Migration 0065 left the key out on a claim that it already
existed — which came from a grep that matched `action.save` twice, and
which I wrote into the migration as a comment justifying the omission.

**And the same edit removed it from `string-coverage`**, which names
every key the interface uses. Taking the key out of the migration and
out of the list together leaves nothing to notice.

**So a button rendered its own key, on screen, in a product.**

---

## A list checked against itself is not a check

The new test reads the **icon set** instead, which is the other end of
the same pair: `actionLink` draws `ICONS[name]` and labels it
`t("action." + name)`.

**Every glyph used as an action needs a string**, and a missing one is a
raw key in the interface.

### And it found a second

`compile` has an icon and no words. **That one is correct** — it sits
*inside* a button whose label comes from elsewhere, drawn with `icon()`
directly rather than through `actionLink`.

**A glyph used one way does not need what a glyph used the other way
does**, and the test's first version did not know that. Named
explicitly now, so a new action added without a string fails on the line
that lists it.

---

## And a standing invariant for the class

Every `action.*` key must exist in **both** seeded languages.

**That is the shape of this fault**: a key present in one and not the
other shows a raw key to half the customers, and nothing else looks for
it.

---

## Close is a cross

Every pop-out has one and none had an icon.

**An arrow out would say *go back somewhere***, and these open over a
screen that is still there. **Nothing is undone by closing** — which is
what a cross means and what *cancel* would not.

---

## One row, because it is one kind of thing

> Can you move all buttons together at the top, where Release hold and
> deactivate exist.

Save and Close sat below the form while Hold and Deactivate sat above
it, which made the form look like it **separated two kinds of thing.**

**It does not.** All four act on the supplier, and a person scanning for
what they can do should find one place.
