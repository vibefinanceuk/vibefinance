# 0713: The supplier portal's directory, sign-in and access tokens

**Status: live** at `df210d6`, pushed and deployed 10 October 2026, migration applied. Phase 1 step 1 of `docs/design/supplier-portal.md`.
shared (`session/token.ts`, `session/portal-token.ts`); vf-licence (`portal.ts`, `index.ts`,
`environment-route.ts`, `wrangler.jsonc`), migration `0321_supplier_portal_directory.sql`.

## What was asked

Dan, 10 October 2026, after the design was agreed: *"lets go!"*

## What it does

**The directory** (vf-licence, migration 0321). No invoice data.

| Table | Holds |
| --- | --- |
| `supplier_orgs` | A supplier's organisation, across every customer it is linked to |
| `portal_users` | A supplier's person and their portal password (Argon2id). Apart from `user_credentials`: a supplier's login is never a customer's |
| `portal_links` | What one person may see at one customer: one supplier record, the companies named. Ended, never deleted |
| `portal_invitations` | The customer's invitation: the same rules as staff invitations (0593) |

**From a customer's instance**, with its environment key, for its own environment only:

| Route | Does |
| --- | --- |
| `POST /environments/:id/portal-invitations` | Invite `{ email, supplierId, supplierName, orgUnits: [{id, name}], invitedBy }`. At least one company |
| `GET /environments/:id/portal-people?supplierId=` | A supplier's linked people, and invitations not yet accepted |
| `POST /environments/:id/portal-invitations/:id/cancel` | Cancel an invitation |
| `POST /environments/:id/portal-links/:id/companies` | Change what a person may see |
| `POST /environments/:id/portal-links/:id/end` | End a link |

**Public:** `POST /portal/invitations/view`, `POST /portal/invitations/accept`, `POST /portal/login`.

- Accepting: the code first (five tries). Someone new chooses a password of 12 or more;
  **someone who already has a portal login gives their own password**, so an invitation can
  never take over a login, and a wrong one counts against the same five tries.
- A person accepting for a supplier record that already has a linked colleague joins that
  colleague's supplier organisation; otherwise a new one is made, named after the record.
- A second invitation for the same person and supplier replaces the companies; there is never
  a second active link.
- Signing in has the staff sign-in's defences (0090, 0094): the progressive delay, one message
  for every refusal, a verification spent for an unknown email, every attempt recorded.

**Signed in** (a portal session token): `GET /portal/links` (customers, supplier name,
companies), `POST /portal/access` (a token per active link), `POST /portal/links/:id/end`.

**Tokens** (shared). Signed by the fleet key (0086), with their own header `typ`
(`VF-PORTAL`) and a `kind`:

- `portal_session`: the supplier user, for vf-licence only; names no environment.
- `portal_access`: one environment, one `supplierId`, the `orgUnitIds`; **five minutes**.
  Read from the link as it is now, so ending a link or changing its companies takes effect
  at the portal's next request.

**Staff sessions are hardened at the same time.** `verifySessionToken` now refuses any token
whose `typ` is not `JWT` or which carries a `kind`, so a supplier's token can never be taken
for a customer's user, even by an instance that has not yet been taught about the portal.

An environment with any portal link or invitation counts as history and cannot be deleted.

## Configuration

`PORTAL_LINK_BASE` (a var in `wrangler.jsonc`) is the portal's welcome page, provisionally
`https://portal.vibefinance-ai.com/welcome.html`. vf-portal is built in step 4; until then an
invitation can be made and listed but not accepted from a page.

## Tests

- shared `portal-token.test.ts` (6): each kind round-trips; neither is accepted as a staff
  session (even signed as `JWT`); a staff session is neither portal kind; session and access
  are not each other; access is for one instance, expires, needs a company; widening the
  companies breaks the signature.
- vf-licence `portal.test.ts` (13): the invitation and its email; refusals; accepting new and
  existing; colleagues joining one organisation; a second invitation replacing companies;
  sign-in refusals and delay; access tokens; an ended link; the instance and supplier routes
  through the router; the deletion guard.

The three shared failures that were failing before this change are unchanged (two licence
token tests and "names each one exactly once").
