# 0715: Inviting a supplier's people to the portal, from the supplier's page

**Status: live** at `9614958`, pushed and deployed 10 October 2026. Phase 1 step 3 of `docs/design/supplier-portal.md`.
vf-app (`portal-people-route.ts`, `portal-route.ts`, `index.ts`); vf-ui (`suppliers.js`,
`app.css`, the proxy); vf-licence migration `0322_supplier_portal_people_strings.sql`.

## What was asked

Dan, 10 October 2026: *"lets go"*, Phase 1 of the agreed design, after steps 1 (0713) and
2 (0714) went live.

## What it does

**On a supplier's page** (Suppliers, open a supplier), a *Supplier portal* section, below
what has been learned about its invoice layouts:

- who from this supplier is linked, and for which companies; *End access* beside each;
- invitations not yet accepted, with when they expire (or that they expired or were used up
  by wrong codes); *Cancel invitation* beside a pending one;
- for someone who may invite: an email address, a box for each company they may invite for,
  and *Invite to portal*. One company alone is ticked already. The answer says who it was
  sent to, or that it was made but the email could not be sent, and why.

The section is not shown at all when the customer's licence does not include
`supplier_portal`, or the person may not see suppliers.

**Who may do what.** Seeing the section: `AP.Supplier` or `Supplier.Maintain`. Inviting,
cancelling, changing companies and ending: `Supplier.Maintain`, and **only for the companies
the person holds it in** (and those beneath). They may not change a link covering a company
outside theirs.

**vf-app routes**, each asking vf-licence with this environment's own key (0713):

| Route | Does |
| --- | --- |
| `GET /suppliers/:id/portal` | `licensed`, `canManage`, the companies this person may invite for, active links, open invitations |
| `POST /suppliers/:id/portal/invitations` | `{ email, orgUnitIds }`: sends the supplier's name and the companies' names from here, and who invited |
| `POST /suppliers/:id/portal/invitations/:id/cancel` | Cancel |
| `POST /suppliers/:id/portal/links/:id/companies` | `{ orgUnitIds }`: replace the companies |
| `POST /suppliers/:id/portal/links/:id/end` | End, recording who |

An invitation or link must be this supplier's: a URL for one supplier cannot act on
another's.

**A company covers the units beneath it.** The portal's invoice routes (0714) now read an
invitation for a legal entity as covering its operating units, as a role there does
(`unitsWherePermitted`), so a supplier invited for *Acme UK Ltd* sees invoices placed in
*Acme UK North*.

## Not done here

Changing a link's companies has a route but no screen yet: inviting the same person again
replaces their companies (0713), and the help line under the form says so.

## Tests

- vf-app `portal-people-route.test.ts` (8): the list and the companies offered; not licensed
  (nothing asked of vf-licence); view-only; refusals; the invitation sent with names and
  inviter; only one's own companies, never none, never taking away another's; cancel, change,
  end, and nothing of another supplier's. `portal-route.test.ts`: a company covers the units
  beneath it.
- vf-ui `suppliers.test.ts` (5): hidden when not licensed; the people and invitations; invite
  for the ticked companies (none ticked: nothing sent); view-only; End.
- vf-licence: the 14 strings in string coverage.
