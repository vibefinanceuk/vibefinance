# 0096 — A customer's livery

**Status: built** — storage, validation and the stylesheet the UI
fetches. **Not built:** `vf-ui` itself, which is what will link to it.

---

## Why the control plane holds this

The UI is **one shared deployment** (decision 0083 section 3), so
branding cannot be a per-Worker configuration file. Compiling a
customer's colours into the bundle would mean a UI deployment to add a
customer, with every customer's livery in one artefact.

So it is fetched — and **decisively, the login screen needs branding
before an instance has been chosen.** An instance cannot be the source
for that moment.

Document 3's constraint is that `CONTROL_DB` holds *customers, licences
and aggregate usage counts — never customer content*. Branding is not
content in the sense that record meant, though it is the first thing
stored there that is not purely commercial. Worth noting rather than
glossing.

---

## Five tokens, and no more

`docs/design/mockups/tokens.css` separates brand tokens from structural
ones. Only the brand block is settable: four colours and a name.

**Branding reaches tokens only, so a customer cannot break a screen**
(`operator-interface.md` section 7). Spacing, type scale, radius and
layout are structural and are not theirs to set — a customer who could
change the type scale could make a queue unreadable and would then
report it as a bug.

Every field is nullable and absence means the default. **No row is
required** for a customer who never wanted a livery, and a customer who
set only their bar colour keeps the rest.

---

## The injection guard, which is the point

These values are interpolated into a stylesheet **the browser
executes**.

```
brand_bar = "red; } body { display: none"
```

would close the rule and open another. A customer's livery must not be
able to rewrite a screen — and under decision 0083 the operator sets
these, so the guard is less about a malicious customer than about a
mistyped value reaching production.

Colours must match a six-digit hex pattern. The brand name refuses
quotes, backslashes, semicolons, braces and angle brackets, and is
capped at 60 characters.

**Enforced twice, and the two do different things** — a distinction
decision 0093 taught the hard way:

- **The route refuses**, so the caller gets a reason.
- **Standing invariants detect**, so a row that arrived some other way
  is caught on the next replay.

Watched to fail: removing the validation breaks five tests.

---

## Served as CSS, not JSON

A `<link>` in the document head applies **before the first paint**.
JSON would mean fetching, parsing and setting variables in script — and
a flash of the wrong livery while it happened.

**Unauthenticated**, because the login screen needs it before anybody
has signed in. It discloses four colours and a name, which a customer
puts on their letterhead anyway.

An unknown or absent customer gets the default rather than an error: **a
login screen that fails to render because somebody mistyped a query
parameter is worse than one that looks generic.**

Cached for five minutes — long enough that every page load does not
reach the control plane, short enough that a livery change appears
without a redeploy.

---

## What is not built

- **`vf-ui`.** Nothing links to this stylesheet yet.
- **No logo.** Colours and a name only. An image means storage, size
  limits, content-type validation and a very different injection
  surface, and it can be added without moving anything.
- **No partner tier.** `operator-interface.md` section 7 anticipates a
  partner livery distinct from a customer's, for reselling. The table is
  keyed by customer, so that would be a second layer rather than a
  change to this one.
- **No dark variant.** `tokens.css` declares `color-scheme: light dark`
  and the brand block does not vary by scheme.
