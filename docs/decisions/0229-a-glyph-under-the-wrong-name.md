# 0229 — A glyph under the wrong name

**Status: fixed.** The card actions draw their icon.

---

## Reported by looking at it

> I see the text, but no icon.

**`actionLink` looks a glyph up by the action it labels.** The actions
are `changeseller` and `changebuyer`; decision 0228 registered the
drawing as `swap`, which nothing asks for.

So `ICONS["changeseller"]` was `undefined`, and:

```js
svg.innerHTML = ICONS[name] ?? "";
```

**An empty `<svg>`.** The label appeared, the icon did not, nothing
failed and nothing logged.

---

## The third time this month, in the same shape

**Decision 0223**: a CSS variable nothing defined, which resolved to
transparent — a pop-out with no background.

**Decision 0212**: a route the proxy's allow-list did not name, which
returned *not found* for a route that existed.

**And this**: a glyph nobody asked for, rendering as blank.

**Each is a lookup with a silent default**, and each was found by a
person looking at the screen rather than by any test. `?? ""` is
correct for an action that genuinely has no icon — and it cannot tell
that from a name that is simply wrong.

---

## The test names the offender

It collects every `.actionlink` whose `<svg>` is empty and asserts the
list is empty — **by label**, so a failure says *"Change Seller"* rather
than *"expected 1 to be 0."*

Watched to fail by putting the glyph back under `swap`.

**It does not stop the next one** anywhere but the viewer: an action
rendered on a screen this test does not open is still free to be blank.
