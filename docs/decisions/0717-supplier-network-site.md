# 0717: vf-portal, the supplier network at network.vibefinance-ai.com

**Status: live** at `6966a04`, pushed and deployed 10 October 2026, migration applied. Phase 1 step 4 of `docs/design/supplier-portal.md`.
New worker `workers/vf-portal`; vf-licence (`portal.ts` wording, `wrangler.jsonc`),
migration `0323_supplier_network_strings.sql`; `eslint.config.js`.

## What was asked

Dan, 10 October 2026, choosing the address: *"lets go with network.vibefinance-ai.com"*,
after agreeing it is one address for every supplier of every customer.

## What it is

A new, shared Worker, `vf-portal`, at **network.vibefinance-ai.com** (a custom domain, so
`workers.dev` is off and there is one address). Static pages; `/api/*` is the Worker.

| Page | Does |
| --- | --- |
| `/welcome.html#t=…` | Accepting an invitation: who invites them, for which supplier and companies; the 6-digit code; a new password twice, or their existing one if they already use the network. Accepted, they are signed in and taken to their list. The token stays in the fragment, so it is in no log, and leaves the address bar when they move on |
| `/` | Signing in; then **one list of the supplier's invoices across every customer**, newest first: customer, invoice, date, amount, PO, company, status. Search by invoice or PO number, filter by status. A customer that does not answer in 8 seconds, or whose licence no longer has the portal, is named ("Not available just now: …"), never silently left out. An invoice opens with its lines and, if returned, the customer's comment |

**The Worker** (`src/index.ts`, `src/network.ts`) holds nothing:

- Sign-in goes to vf-licence (0713) through its Service Binding; the portal session is kept in
  an `HttpOnly`, `Secure`, `SameSite=Strict` cookie, so script never sees it. A POST naming
  another origin is refused as well.
- The list asks vf-licence for the person's links and a five-minute access token for each,
  then asks **every linked customer's instance at once** (0714), each with its own token, and
  merges the answers. One invoice is asked only of the customer its link is for.
- A session vf-licence no longer accepts clears the cookie and shows the sign-in again.

**The words** come from the control plane like vf-ui's (0107): 51 `network.*` keys, English
and German, in migration 0323.

**The invitation email** now says *"Acme Ltd has invited you to the VibeFinance supplier
network…"*, and links to `https://network.vibefinance-ai.com/welcome.html`
(`PORTAL_LINK_BASE`).

## Deploying

1. vf-licence: apply migration `0323`, deploy (the new link and wording).
2. vf-portal: `cd workers/vf-portal && npx wrangler deploy`. The custom domain makes
   Cloudflare create the DNS record for `network.vibefinance-ai.com`.

## Not done here

- Customer branding on the pages and emails (the design's later idea).
- "Forgot password". A supplier who forgets theirs is invited again by the customer for now.
- Browser tests for the two pages; they were checked by screenshots against a mocked API
  (desktop and phone width). The Worker's behaviour is tested.

## Tests

vf-portal `network.test.ts` (12): every customer asked with its own token and the answers
merged newest first; a slow, refusing or unlicensed customer named, the rest still shown; a
stale session signed out; who is signed in; one invoice asked only of its customer, and not
found for a link not theirs; the pages served; no session refused, a foreign POST refused;
the cookie's attributes and the token never in the page; a refused sign-in passed on without
a cookie; accepting signs in with the password given; signing out, and a refused session,
clear the cookie. vf-licence: the email's new wording; the 51 strings in coverage.
