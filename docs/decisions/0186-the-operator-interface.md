# 0186 — The operator interface

**Status: built.** A fourth Worker, behind Cloudflare Access, and a
screen that shows a decision what it rests on.

---

## Approving a customer was a `curl`

Decision 0140 named it: **a decision made blind is a checkpoint in name
only.** Nobody saw who asked, what they asked for, or what had been
decided before.

---

## More was already built than the handover said

Reading the code rather than the note found two things done:

**Recording happens at the edge**, in the CORS wrapper, for **every**
privileged path. The handover said *"seven routes are admin-gated where
two record who acted"* — that was true when decision 0140 was written
and stopped being true in the same record, which put the recording
where no route can forget.

**And attribution is done.** `admin-audit.ts` reads
`Cf-Access-Authenticated-User-Email` where Access has set it, and
records `admin-key` honestly where it has not.

So what was missing was the Worker and the screen, and nothing else.

---

## `vf-admin`, and why it is its own Worker

**Not part of `vf-ui`**, whose proxy refuses admin paths outright by
design — that refusal is a feature and routing around it would undo it.

**Not part of `vf-licence`**, because binding an interface to it would
redeploy the licence minter on every screen change. That is decision
0099's argument, one Worker along.

**A service binding, not a URL** (decision 0005): a plain `fetch()` to a
Worker's own `workers.dev` address is silently blocked by Cloudflare's
anti-loop protections, and the request never arrives.

---

## Verified, never claimed

`vf-licence` records `admin-key` where no Access identity exists, which
is honest and **fails ISO 27001 A.8.15 and SOC 2 CC7.2** — both want a
privileged action **attributable**, not merely recorded.

**This Worker holds the admin key**, so it refuses any request without a
verified identity. A missing `Cf-Access-Authenticated-User-Email` means
the request did not pass through Access — which on a `workers.dev`
hostname means the Worker is not behind Access at all.

**That is a deployment fault, not a caller's mistake**, and it says so:
*"this interface must sit behind Cloudflare Access."* Decision 0141's
discipline about an unbought domain — admit what it cannot do rather
than produce something plausible.

And the operator's own address travels with the forwarded request, so
what `vf-licence` records is a person rather than a shared secret.

### Three checks, in an order that matters

**Identity, then route, then key.**

A stranger is told nothing about which routes exist — refusing after a
route check would enumerate them for anybody. A **verified operator**
asking for a path that does not exist is told exactly that, because
*"the admin key is not configured"* is a fault they cannot act on and
which has nothing to do with what they asked.

---

## An allow-list, never a prefix

Decision 0131 found a route missing from `vf-ui`'s list and a rename
failing silently. The lesson was to enumerate, and it matters more here
where the credential is the fleet's admin key.

---

## The screen is deliberately not the customer's

`vf-ui` fetches its livery from the control plane and every word from
D1 (decisions 0096, 0107), because it belongs to a customer.

**This belongs to us.** One operator, one language, no branding to
fetch — so it carries its own words and its own colours, and the tokens
are **copied rather than shared**: a change to a customer's palette
should not change the screen that approves customers.

It shows two things: **what is waiting for a decision**, with the
company, who asked, their address, their notes and when — everything a
decision should rest on, in front of the decision. And **what has been
done**, refusals included, with each action marked *verified* or *shared
key* so the difference is visible rather than buried in a column name.

---

## What is not built

- **Access itself.** The Worker refuses everything until a domain is in
  a zone with a policy in front of it. `ACCESS_TEAM_DOMAIN` is a
  placeholder.
- **`ADMIN_KEY` is unset**, deliberately — it is a secret and belongs in
  `wrangler secret put`, never in a var (decision 0009's incident).
- **The screen shows pending requests and recent actions and nothing
  else.** The fleet, licences, credentials and access grants are
  forwarded routes with no interface.
- **Nothing paginates.** Twenty-five actions and every pending request.
- **No test covers the screen**, only the Worker. `vf-ui`'s browser
  suite has the harness for it and this Worker does not.
