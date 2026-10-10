# 0714: An instance answers the supplier portal: its invoices, in the supplier's words

**Status: built**, not yet deployed. Phase 1 step 2 of `docs/design/supplier-portal.md`.
vf-app (`portal-route.ts`, `index.ts`). No migration.

## What was asked

Dan, 10 October 2026: *"lets go!"*, for Phase 1 of the agreed design, after step 1 (0713)
went live.

## What it does

Two routes on every vf-app instance, for a supplier's person holding a `portal_access` token
from vf-licence (0713):

| Route | Answers |
| --- | --- |
| `GET /portal/invoices?status=&q=` | This supplier's invoices for the linked companies, newest first, at most 200. `q` matches the invoice number or purchase order |
| `GET /portal/invoices/:id` | One invoice and its lines (description, quantity, unit price, net amount) |

**Who may ask.** The token must be signed by the fleet key, be a portal access token, name
this environment and be in date. The supplier record and the companies come **from the token,
never from the request**. The customer's licence must include the `supplier_portal` feature
(design §7.6), otherwise 403 `portal_not_licensed`. A staff session is refused here, and a
portal token is refused by every staff route (0713), so the two never cross. The routes run
before every other check on purpose.

**What is shown.** Invoice number, issue date, total, currency, purchase order, company,
when received, the status, and for a returned invoice the comment the customer wrote for the
supplier (0498). Never: stage names, rule names, people, the internal return reason, coding,
the duplicate score. Another supplier's invoice and one that does not exist get the same 404.
An invoice not yet placed in a company belongs to none, so no link covers it until it is.

**The status**, worked out from facts already there:

| Status | When |
| --- | --- |
| `rejected` | Returned to the supplier, or discarded |
| `sent_for_payment` | In an ERP export, or delivered to a Destination |
| `approved` | Finished, or past the first approval stage of its process (a stage using the approval hierarchy, or requiring `AP.Approve`) |
| `in_review` | A person has had a task on it |
| `received` | No process yet, or nobody has had to look |

`query_raised` arrives with the portal's messages (Phase 2) and `paid` with a payment date
from an ERP; neither is produced yet.

## Turning it on for a customer

Add `supplier_portal` to the environment's licence features (`POST /licences` on vf-licence
with `features` including it); the instance picks it up at its next licence refresh.

## Tests

vf-app `portal-route.test.ts` (17): only the supplier's invoices for the linked companies,
never an unplaced one; one invoice and its lines without the customer's coding; the same 404
for another supplier's; search and status filter; refusals (no token, a staff session,
another environment, expired); a portal token opening no staff route; the licence feature;
each status; a returned invoice's supplier comment without the internal reason or stage.
