# 0197 — Which fields a unit may key

**Status: built.** A unit may override a stage's field visibility, one
field at a time.

---

## Per field, and that is the whole design

The second thing decision 0192 scopes, and deliberately the same shape
as the first (decision 0196): the stage's own rows are the group's
answer, and a unit may override them.

**But per field, not per stage.** If a unit's overrides replaced the
stage's whole set, then restricting one field in France would
**silently drop every restriction the group had made** — a loosening
dressed as a tightening.

**Which is exactly what decision 0143 watched for.** That record made a
stage read-only as a *property* rather than as a list of fields somebody
keeps complete, because *"dropping the edit condition reveals hidden
fields"* — loosening under the guise of restricting. Same trap, one
layer along.

So France's rule for `BT-112` wins for `BT-112`, and the group's rule
for `BT-110` still applies to `BT-110`.

---

## `edit` exists only as an override

The base table has two values, `read` and `hidden`, because a row there
**restricts** and absence means editable.

An override has three. **`edit` is how a unit restores a field the group
restricted** — without it an override could only tighten, and a customer
whose group hides a field would have no way to say *"except in
France."*

It is expressed by removing the entry, because the caller already reads
an absent field as editable.

---

## Resolved least specific first

The walk runs **backwards** through the lineage: the group's answer
applied first, then the country's over it, then the department's.

`unitLineage` returns most-specific-first for decision 0196's rule-set
lookup, where the **first** match wins. Here every level contributes and
the nearest must land last. **One walk, two orderings, and the reason
each is what it is stated where it happens.**

---

## The enforcing caller, not the screen

`key-fields-route` passes the invoice's own unit.

**Decision 0144 found field visibility enforced only by the screen since
September** — a `curl` could always write a read-only field. An override
the screen honours and the route ignores would be that fault repeated,
and the test that proves otherwise fails when the unit is dropped.

---

## What is not built

- **The `/field-visibility` route takes no unit.** The screen still asks
  for a stage and gets the group's answer, so a French keyer sees fields
  the route would refuse. **That is decision 0144 inverted** — the route
  stricter than the screen — which is safe and confusing, and it is the
  next thing to fix.
- **No screen configures an override.** It is a row.
- **Roles, teams and settings remain customer-wide**, and decision 0192
  lists them.
