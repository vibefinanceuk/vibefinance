# Design: A supplier portal across the network

**Status: proposed**, 10 October 2026. Direction agreed (Dan: *"I'd prefer the Live fan-out
approach as well. No duplication of customer data"*); the decisions in §7 are open.

---

## 1. What was asked

Dan, 10 October 2026:

> I'm considering how it might be possible to introduce a supplier portal, for invoice
> status check and collaboration on invoices. Given the infrastructure we have built here,
> where would it make sense for the supplier portal to sit. It occurred to me that it would
> make sense for the supplier to be able to see multiple customer invoices, as might be
> possible being part of a network. Does it make sense to have one central service, and
> data shared from each customer instance?

The answer given: one central portal, yes; one central copy of invoices, no. The central
service knows **who the supplier is and which customers they are linked to**; each
customer's instance keeps its invoices and answers for them when asked.

---

## 2. Principles

1. **Customer data stays in the customer's instance.** Nothing invoice-derived is copied
   into the portal or the control plane: no cache, no index, no search store. The same rule
   the supplier-layout design applied ("per customer, never shared").
2. **The customer decides every link.** A supplier sees a customer's invoices only once that
   customer has linked them to one of its supplier records. A matching VAT number alone
   links nothing.
3. **The supplier sees outcomes, not workings.** A small, fixed status vocabulary; never
   internal stages, rule names, approvers, or other suppliers.
4. **Everything the supplier does is recorded where the invoice is.** A message, a reply or
   a document lands on the invoice's own Timeline in the customer's instance.

---

## 3. Where it sits

```
 supplier user ──► vf-portal (new worker, UI + API)
                        │
                        │ 1. who is this, which customers are they linked to?
                        ▼
                   vf-licence (control plane: directory and tokens)
                        │
                        │ 2. a short-lived token per linked instance,
                        │    scoped to that instance and one supplier record
                        ▼
        ┌───────────────┼────────────────┐
        ▼               ▼                ▼
   vf-app (Acme)   vf-app (Globex)  vf-app (…)      3. live: "this supplier's invoices"
```

| Piece | Holds | New work |
| --- | --- | --- |
| **vf-portal** (new worker) | Nothing durable but its own sessions. Pages, and the fan-out | All of it |
| **vf-licence** | Supplier organisations, their users and credentials, and the links: *supplier org S is supplier record `sup-ln` in environment Acme-production* | Three tables, invitations, a portal sign-in, token minting |
| **vf-app** (each customer) | The invoices, as now; the supplier's messages on the Timeline | A narrow `/portal/...` API that accepts only a portal token, and an Invite to portal action on a supplier |

**Why the control plane holds the directory.** It already knows every customer instance
(`environments`, with each `instance_url`), already signs session tokens with the fleet key
(decision 0086) and names the environment in each so an instance refuses one addressed
elsewhere, and already runs credentials, progressive delay and the sign-in report (0090–0094).
A supplier user is one more kind of person signing in to it.

---

## 4. How a request flows (live fan-out)

1. A supplier user signs in to vf-portal, whose sign-in is vf-licence's, under a separate
   portal audience.
2. vf-portal asks vf-licence for the supplier's **active links**. For each, vf-licence mints
   a token with claims:
   `{ kind: "portal", environmentId, supplierId: "sup-ln", supplierOrgId, user, expiresAt }`,
   lasting minutes, not hours.
3. vf-portal calls each linked instance **in parallel**:
   `GET {instance_url}/portal/invoices?status=…` with that instance's token.
4. Each vf-app verifies the token (the same key and checks as a session token, plus
   `kind = "portal"`), then answers with **only** invoices whose `supplier_id` is the
   token's `supplierId`. The supplier ID comes from the token, never from the request.
5. vf-portal merges the answers into one list, labelled by customer. An instance that does
   not answer in time is shown as *"Acme: not available just now"*, never silently left out.

Nothing in steps 1–5 is stored by vf-portal beyond the page it is drawing.

**Cost of live.** Listing is one call per linked customer. With tens of customers per
supplier that is fine in parallel from a Worker. If a supplier ever has hundreds, the
answer is paging per customer in the UI ("show Acme's"), not a central index.

---

## 5. What the supplier sees

**Status**, mapped in vf-app from where the invoice is. The mapping is code, the same for
every customer at first:

| Portal status | When |
| --- | --- |
| Received | Captured, not yet at a stage with a person |
| In review | At any stage before Approval |
| Query raised | A task with a Return to supplier, or a portal message awaiting their answer |
| Approved | Past Approval, not yet exported |
| Sent for payment | Delivered to the ERP or a Destination |
| Paid | A payment date known (later: from the ERP) |
| Rejected | Discarded, with the reason the customer chooses to show |

**Per invoice:** number, date, amount, currency, the PO it quoted, status, and for "Query
raised" the question. Never: stage names, rule names, task owners, coding, other lines'
approvers, the duplicate score, or anything about another supplier.

**Collaboration:**

- **Messages.** A supplier's message becomes a Timeline entry on the invoice, authored
  *"Lager Nord GmbH (portal) · Jo Smith"*. A customer user's reply marked *to supplier*
  shows in the portal; internal comments never do.
- **Return to supplier** (today an email) can land as a portal query when the supplier is
  linked, with the email kept as the notification.
- **A corrected document** uploaded against a query attaches to the invoice; it does not
  replace anything by itself.

---

## 6. Linking a supplier to a customer

1. On a customer's **Suppliers** screen: *Invite to portal*, with an email address. Needs
   `Supplier.Maintain`.
2. vf-app asks vf-licence to create an invitation (the existing invitations pattern),
   carrying `environmentId` and `supplierId`.
3. The supplier accepts: a new supplier organisation is created, or the invitation joins
   one that exists (same verified email domain, or an admin of that organisation approves).
4. The link is live. Either side can end it: the customer from the supplier's page, the
   supplier from the portal.

A supplier that already uses the portal for another customer is linked the same way. The
customer still invites; the supplier sees one more customer in the same login.

---

## 7. Decisions to make

1. **Who may join a supplier organisation.** Proposed: the first user invited is its admin;
   further users are invited by that admin. No self-service sign-up at first.
2. **Status vocabulary per customer?** Proposed: fixed (§5) at first. Customers wanting
   their own wording is a later decision.
3. **Payment information.** Proposed: show *Sent for payment* and, once an ERP connector
   supplies it, *Paid on* a date. No remittance detail in version 1.
4. **Bank details.** Proposed: **not editable from the portal** in version 1. Changing bank
   details is the commonest route for invoice fraud. If added later, only as a request a
   customer user with `Supplier.Maintain` approves.
5. **Invoice submission through the portal.** Proposed: later. When it comes it is one more
   intake channel per customer (the portal posts to that instance's capture route), still
   with nothing stored centrally.
6. **Licensing.** Proposed: the portal is free to suppliers; a customer's plan includes
   linking suppliers. A feature flag in the licence claims turns the vf-app API on.

---

## 8. Build order

| Step | What | Where |
| --- | --- | --- |
| 1 | Supplier organisations, users, links; invitations; portal sign-in; token minting | vf-licence |
| 2 | `/portal/invoices`, `/portal/invoices/:id`, the status mapping, token verification | vf-app |
| 3 | Invite to portal on a supplier; the link shown on the supplier's page | vf-app, vf-ui |
| 4 | vf-portal: sign-in, the cross-customer list, an invoice's page | vf-portal |
| 5 | Messages both ways on the Timeline; Return to supplier as a portal query | vf-app, vf-portal |

Steps 1–4 give status checking; step 5 adds collaboration.
