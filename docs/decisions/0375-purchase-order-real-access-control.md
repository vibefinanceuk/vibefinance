# 0375 — Real access control on Purchase Orders, not just a browsing convenience

**Status: built.** The operator's own observation, live: choosing
"Acme Group" in the org switcher showed Acme UK's own orders too, and
asked whether that was by design. It is — but the follow-up question
mattered more: could that ever be a genuine access-control problem, not
just a navigation one? Confirmed: yes, and today it is one, since
Purchase Orders had no permission-scoped visibility at all. The chosen
org was, and until this decision remained, a personal filter anyone
could freely widen — never a boundary.

---

## Two different things, easy to conflate

**The org switcher's "parent shows its subtree" behavior is unchanged,
and is not what this decision touches.** Choosing a higher unit in the
hierarchy still shows everything beneath it — that is deliberate,
consistent with Tasks, Documents, the Dashboard, and Suppliers, and
even the real, permission-based mechanism below uses the identical
downward rule: a role held at Acme Group covers Acme UK and Acme
France beneath it, by design, not by oversight.

**What was missing is enforcement.** `AP.Validate` was never wired to
compute a real, permission-based scope the way `AP.Supplier` already
was for Suppliers (decision 0358) — `handleListPurchaseOrders` always
passed `null` for `visible`, so the chosen org was the *only*
restriction, and anyone could remove it just by choosing a different
org or none at all. Nothing stopped a person permitted to see nothing
outside Acme UK from simply selecting Acme France instead.

---

## No schema change needed — the mechanism already existed

`org_user_roles.unit_id` (migration 0047) already lets any permission
be granted scoped to a specific unit — *"held at Acme France, it
covers every operating unit beneath"* — generically, for any
permission string, not specifically for `AP.Supplier`. The gap was
purely that Purchase Orders never called `unitsWherePermitted` at all.
Confirmed directly before writing anything: the same
`INSERT INTO org_user_roles (user_id, role_id, unit_id)` pattern
`scoped-roles.test.ts` already exercises for Tasks needed no schema
change to work identically here.

---

## What was built

**`handleListPurchaseOrders` gained `userId`**, computing
`unitsWherePermitted(db, userId, "AP.Validate")` and narrowing it
further by whichever org is chosen — "intersect, never replace," the
same shape Tasks, Documents, and Suppliers already guarantee. `userId`
stays optional, defaulting to unrestricted, so no existing caller was
forced to change.

**`handleGetPurchaseOrder` gained the same real scope — deliberately
*not* also the chosen org.** The org switcher is a personal view
preference for the list, not a second access boundary: someone
permitted to see every legal entity, who has simply narrowed their own
current view to Acme UK, must still be able to open an Acme France
order they were sent a direct link to. Intersecting with the chosen
org here too would have silently turned a browsing convenience into a
second lock nobody asked for — caught before it shipped, not after,
by asking what the parameter was actually for rather than adding it by
habit because the list route had one.

**A 404, not a 403, for an order that is real but out of scope** — an
access check that can tell "does not exist" from "exists, but not for
you" should, since the second is a disclosure the first is not. Worded
identically to the genuine not-found case, so the two are
indistinguishable from outside.

**`isWithinScope`, a new small function in `enforce.ts`**, sitting
beside `unitClause`. The same "unrestricted, nowhere, or a real set
with an unassigned value always visible" rule `unitClause` already
builds into a `WHERE` clause, expressed instead for a single,
already-fetched value — because a list query can express that as SQL,
but a single-record lookup has already read the row and just needs the
same three-way answer directly.

---

## Tests

`enforce.test.ts` — 5 new, direct tests on `isWithinScope` itself:
unrestricted, an unassigned value always visible even under a narrow
restriction, a value inside the permitted set, a value outside it, and
the "nowhere permitted" case where only unassigned survives.

`purchase-order-route.test.ts` — 6 new tests, seeding a real
Acme Group / Acme UK / Acme France hierarchy and a genuinely
role-scoped user the same way `scoped-roles.test.ts` already does for
Tasks: the chosen org cannot widen what a role permits (selecting the
parent while scoped to a child still shows only the child's own
orders), the chosen org still narrows *within* what a role permits
(scoped at the parent, choosing the child, sees only the child), the
detail route refuses an out-of-scope order as a 404 rather than
revealing it exists, returns one genuinely in scope, a pre-existing
unassigned order stays visible in both list and detail regardless of a
scoped caller's own role, and a role held with no unit restriction at
all still sees and can fetch everything, unchanged from before this
decision.

One test-writing mistake, caught by running the tests rather than
assuming: a hand-seeded org hierarchy where a child unit was inserted
*after* the `UPDATE` meant to make it a child of the parent — a
no-op against a row that did not exist yet, not an error, so it stayed
silently wrong until the test's own result was checked directly rather
than trusted. Fixed by having the one function that seeds the
hierarchy create every unit with its parent already set, rather than
updating parentage after the fact.

vf-app: 1,786 tests (was 1,775). No `vf-ui` or `vf-licence` changes —
this is a pure backend access-control gap, closed with no new UI
surface, no new migration, and no new strings.
