# Design: A supplier portal across the network

**Status: agreed**, 10 October 2026. Direction (Dan: *"I'd prefer the Live fan-out approach
as well. No duplication of customer data"*) and the decisions in §7 agreed the same day, with
access scoped to a company within a customer (§6). Phase 1 step 1 built as decision 0713, step 2 as 0714, step 3 as 0715.

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
| **vf-licence** | Supplier organisations, their users and credentials, and the links: *this user sees supplier record `sup-ln`, for the company Acme UK Ltd, in environment Acme-production* | Three tables, invitations, a portal sign-in, token minting |
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
   `{ kind: "portal", environmentId, supplierId: "sup-ln", orgUnitIds: ["acme-uk"], supplierOrgId, user, expiresAt }`,
   lasting minutes, not hours.
3. vf-portal calls each linked instance **in parallel**:
   `GET {instance_url}/portal/invoices?status=…` with that instance's token.
4. Each vf-app verifies the token (the same key and checks as a session token, plus
   `kind = "portal"`), then answers with **only** invoices whose `supplier_id` is the
   token's `supplierId` **and** whose company (`org_unit_id`) is one of the token's
   `orgUnitIds`. Both come from the token, never from the request. An invoice not yet placed in a
   company (decision 0111) is not shown until it is: it belongs to no company yet, so
   nobody's invitation covers it.
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

## 6. Linking a supplier to a customer, one company at a time

**Access is per company, not per installation** (Dan: *"A supplier can only see their
invoices for that Org / Company code. Not across the whole installation."*). A customer's
instance may hold several companies (`org_units`); an invitation names the supplier record
**and** the company or companies it covers. A supplier selling to Acme UK and Acme Ireland
sees Acme Ireland's invoices only if invited for Acme Ireland too.

**Several invitations per supplier.** A customer can invite as many people from one supplier
as it needs (credit control, the account manager, a shared accounts mailbox), each with its
own login and its own company scope. Two people from the same supplier may see different
companies.

1. On a customer's **Suppliers** screen: *Invite to portal*, with an email address and the
   company or companies. Needs `Supplier.Maintain`; the companies offered are those the
   inviting user may act for.
2. vf-app asks vf-licence to create an invitation (the existing invitations pattern),
   carrying `environmentId`, `supplierId` and `orgUnitIds`.
3. The person accepts. The first acceptance for a supplier creates its supplier
   organisation in the directory; later ones join it, so one login can hold links to
   several customers.
4. The link is live. The customer can change its companies or end it from the supplier's
   page; the supplier can end it from the portal. Each invited person's link is separate.

People are added by the customer's invitations. A supplier-side admin inviting colleagues
is not in the first phase.

---

## 7. Decisions, agreed 10 October 2026

| # | Decision | Agreed |
| --- | --- | --- |
| 1 | Who may see what | Several invitations per supplier, each person invited by the customer, each scoped to a supplier record **and** one or more companies (§6). Never the whole installation. |
| 2 | Status wording | One fixed vocabulary for every customer (§5). |
| 3 | Payment information | *Sent for payment*, then *Paid on* a date once an ERP supplies it. **Remittance detail in a later phase.** |
| 4 | Bank details | Not in the portal at first. **A later phase**, and then only as a request a customer user with `Supplier.Maintain` approves. |
| 5 | Submitting invoices | **Wanted, in a later phase.** One more intake channel per customer and company: the portal posts to that instance's capture route; nothing stored centrally. |
| 6 | Licensing | **Always free for suppliers.** Included in the customer's plan, turned on by a feature flag in the licence claims. |

---

## 8. Build order

**Phase 1: status.**

| Step | What | Where |
| --- | --- | --- |
| 1 | Supplier organisations, users, links (supplier record and companies); invitations; portal sign-in; token minting | vf-licence |
| 2 | `/portal/invoices`, `/portal/invoices/:id`, filtered by supplier and company; the status mapping; token verification; the licence flag | vf-app |
| 3 | Invite to portal on a supplier, with its companies; the people linked shown on the supplier's page | vf-app, vf-ui |
| 4 | vf-portal: sign-in, the cross-customer list, an invoice's page | vf-portal |

**Phase 2: collaboration.** Messages both ways on the Timeline; Return to supplier as a
portal query; a corrected document against a query.

**Later phases**, in an order to choose: invoice submission through the portal; remittance
detail; bank detail changes as approved requests.
