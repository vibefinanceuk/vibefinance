# 0187 — A hostname Access can protect

**Status: configured, not yet live.** `vf-admin` is bound to
`admin.vibefinance-ai.com`.

---

## Access cannot protect `workers.dev`

Decision 0186 built the operator Worker and it **refuses every
request**, because no `Cf-Access-Authenticated-User-Email` header
arrives — which is correct, and not a fallback.

**A policy applies to a hostname in a zone you control.** A Worker
reachable only at `vf-admin.<subdomain>.workers.dev` is on Cloudflare's
own domain, not yours, and cannot have one in front of it.

So the Worker needs an address in the zone. `custom_domain` makes
Cloudflare create the DNS record itself, so **the hostname and the
Worker cannot disagree** about where it lives.

**And the `workers.dev` address disappears entirely**, which is better
than this record planned for.

Adding a route **disables `workers.dev` by default** — wrangler says so
on deploy — so the operator interface has exactly one address, and it is
the one Access can protect.

This record originally expected both to stay reachable, with the Worker
refusing the `workers.dev` one. That refusal is still there and now has
nothing to refuse: **one door is better than two doors and a lock on the
second.**

---

## The zone was already there

`vibefinance-ai.com` was bought on 7 September (decision 0141) and its
nameservers pointed at Cloudflare shortly after — **because email
routing works**, and Cloudflare cannot route mail for a domain whose
nameservers point elsewhere.

So *"associate the domain with my account"* was already done, by a step
taken for a different reason. Worth checking before repeating it: adding
a zone that exists is harmless and re-pointing nameservers is not.

---

## What this leaves

**The DNS record and the route** are created on the next deploy.

**Access itself is not**, and cannot be from here: an application on
`admin.vibefinance-ai.com`, with a policy naming who may reach it. Until
that exists the hostname is public and the Worker refuses everything —
**which is safe and is not protection.** The refusal is a second lock,
not the first.

**And `ADMIN_KEY` is still unset**, deliberately. It is a secret and
belongs in `wrangler secret put`, never a var (decision 0009's
incident).

---

## What is not built

- **Three other Workers are still on `workers.dev`.** `vf-ui` in
  particular reads as infrastructure rather than a product, which
  decision 0141 named as one of three things a domain would unblock.
- **Nothing verifies the Access policy exists.** The Worker knows only
  whether a header arrived, not whether a policy put it there — a
  misconfigured application that let everybody through would look
  identical from inside.
