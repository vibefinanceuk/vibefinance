# 0643: Goods receipts, slice 1 — the permission, the role, Receipting required and goods return reasons

**Status: built and tested locally, not yet pushed or deployed.** It
touches `vf-app`, `vf-ui` and `vf-licence`. It needs **vf-app migration
`0139`** and **vf-licence migration `0287`** (strings). Deploy
vf-licence, then vf-app and vf-ui.

## What was asked

Dan raised goods receipts, the third leg of three-way matching that
decision 0082 named and 0370 parked:

> *"I think that in stage 1, we simply build an interface like the
> Purchase Orders UI, where Goods Receipts can be uploaded via a CSV,
> and we provide capability to determine whether a GR is fully
> receipted / partially, and possibly reasons why items were
> returned."*

The proposal (artifact *Goods Receipts*, 5 October 2026) set out the
model, the screens, the CSV, change orders, the Matching stage's rules
and four levels. Dan agreed:

1. **A new permission, AP.Receive**, *"and I think a new AP Receiving
   Role to accompany it"*.
2. **A receipt needs a PO** in Stage 1.
3. **A return leaves part of the PO line un-receipted**, *"rectified by
   either another shipment and GR, or a Change Order on the PO"*.
4. **Suppliers are flagged** *"3-way suppliers, or Receipting
   Required"*.

And the five open questions, as suggested: over-receipt is saved with a
warning; AP.Validate sees receipts read-only, in its own units;
Receipting required is on the supplier only for now; Stage 2's invoice
actions are *override with a reason* (AP.Match) and the automatic
re-check; receiving stays out of absence cover.

This decision is the proposal's first build step. The register (tables,
CSV, routes), the screen, the PO's receipt view and Stage 2 follow.

## What was built

### AP.Receive (vf-app `permissions.ts`)

Record goods receipts and returns against purchase order lines. Its own
permission because whoever receives goods is often in the warehouse,
not in AP. **Granted to nobody** by any migration: unlike AP.Agents
(0622), there is no existing role it obviously belongs to.

### The AP Receiving role, offered rather than created (vf-ui `access.js`)

A role is each customer's own (migration 0003), and none is seeded. So
the Roles tab offers **Add the AP Receiving role** beside New role,
while no role holds AP.Receive. It opens the role form filled in: id
`ap-receiving`, name *AP Receiving*, AP.Receive ticked. The
administrator can change any of it before creating it; once any role
holds AP.Receive, the offer goes. `READY_MADE_ROLES` is a list, so a
later ready-made role is one entry.

### Receipting required (vf-app `load-suppliers.ts`, vf-ui `suppliers.js`)

`suppliers.match_option = 'three_way'` already existed, loaded from the
ERP's file but never shown. Now:

- **The supplier pop-out** has *How invoices are matched*: Not set,
  Two-way, **Receipting required**, Not matched. It is the ERP's
  setting, so it sits with the ERP's fields and the same "the next load
  overwrites this" warning applies.
- **The list** says *Receipting required* beside what the site is for.
- **`PUT /suppliers/:id`** takes `matchOption` (or `null` to clear),
  audited in `supplier_field_changes` like every other field, refused
  with `match_option_invalid` otherwise.
- **The supplier CSV** also accepts *Receipting required*, *3-way* and
  *two way* (`normaliseMatchOption`).
- The agents' supplier questions say *Receipting required* for
  `three_way` (vf-licence `0287` updates `agents.qmatch.three_way`, and
  `agent-email.ts`'s words).

### Goods return reasons (vf-app migration `0139`)

`goods_return_reasons`, the same flat, deactivate-never-delete list as
`supplier_return_reasons` (0087), **kept apart from it**: that list says
why an invoice went back, this one why goods did, and a report must
never mix the two. Seeded with Damaged, Wrong item, Not ordered,
Quality failure, Short-dated or expired, and Rejected on delivery.

- `return-reasons-route.ts` takes the list as a parameter; the
  supplier list stays the default.
- Routes: `GET /goods-return-reasons` (anyone signed in, as
  `/return-reasons`); `GET`/`POST /admin/goods-return-reasons` and
  `PATCH /admin/goods-return-reasons/:id` (Admin.Configure). vf-ui
  passes all of them through.
- **AP setup's Return Reasons tab** has a *Goods return reasons* panel
  after the AP team email. Its load failing leaves only that panel
  empty.

## Not built (the next slices)

- The register: receipts, lines and cancellations; line figures and
  states; the CSV load and format; the routes.
- The Goods Receipts screen; the PO's receipt column and line view; the
  change-order warnings.
- Stage 2: the three receipt facts, the Awaiting receipt and Credit
  expected standard rules, and the re-check on each receipt.

## Verification

- **`vf-app`**:
  - `return-reasons-route.test.ts`: the six goods reasons, apart from
    the invoice list; adding, retiring, and an invoice reason not found
    in the goods list;
  - `load-suppliers.test.ts`: Receipting required set, audited, listed,
    cleared and refused; a supplier file naming it as *Receipting
    required*, *3-way* and *Two way*;
  - `index.test.ts`: the goods routes through the router, and their
    Admin.Configure gate.
- **`vf-ui`** browser:
  - `access.test.ts`: the offer, the filled-in form, and the offer
    gone once a role holds AP.Receive;
  - `suppliers.test.ts`: the row says it; the pop-out's choice is
    saved with the details;
  - `ap-setup.test.ts`: the goods panel and adding to it.

  The worker test covers the four new paths.
- **Full runs**: vf-app 3609, of which 3607 pass (the two known failures); vf-ui browser 1563, of which 1562 pass (the known `typography.test.ts` 10px gap), with the same 331 unhandled errors; worker 111 of 111; vf-licence 362 of 362.
- **Migrations** replay: vf-app 139, vf-licence 287.
