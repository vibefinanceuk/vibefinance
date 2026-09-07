# 0141 — A domain nobody owned

**Status: built, and a domain now exists.**
`INGESTION_DOMAIN` is `vibefinance-ai.com`, bound on 7 September.

The one address issued against the domain nobody owned was released
before it was set — never given to a supplier, so exactly the
mistake-correction case decision 0133 exists for.

---

## What happened

Decision 0125 settled that ingestion addresses live on a VibeFinance
domain. Decision 0126 built it:

```ts
const INGESTION_DOMAIN = "vibefinance.com";
```

**Nobody owns `vibefinance.com`.** The operator, asked about Cloudflare
Access for decision 0140:

> The domain is not available, and 99% likely not to be
> vibefinance.com.

So every address the sources screen has reported as **reserved** was a
string that looked like an address and could never receive anything.

**And the screen was technically honest about it.** *"Not receiving
yet"* was true — for a reason nobody intended, which is the worst way
for a message to be right.

---

## The domain is configuration

The same argument decision 0099 made for API addresses: **a value that
differs between deployments belongs in configuration**, and one that has
to be *right* belongs somewhere a person sets deliberately rather than
somewhere it can be true by accident.

A new domain now changes every future address without a code change,
which is what makes the eventual purchase cheap.

---

## And no domain means no address

The alternative is what happened: minting something plausible against
nothing.

`handleSetSourceEmail` returns **503** with `no_ingestion_domain`, and
stores nothing. The screen says *"Email addresses are not available yet.
No ingestion domain has been configured"* — **our configuration, not
their mistake**, which is a distinction the person looking at it cannot
otherwise make.

This is the discipline decision 0039 already applies with
`not-yet-deployed.invalid`: **a system that admits what it cannot do,
rather than producing something plausible.** A URL that announces itself
as unreal is better than one that silently 404s, and the same is true of
an address.

Watched to fail: restoring a default domain breaks it.

---

## The addresses already issued

**None was ever given to a supplier**, because nothing routes and the
domain does not exist. So this is the one moment when changing it costs
nothing — and it will not be true again.

Decision 0133 built exactly the path for it: deletion with
confirmation, which frees the address. They are the mistake-correction
case that record exists for.

---

## What this says about a hardcoded value

Decision 0126 wrote a domain into a constant and **nothing objected** —
not a test, not a type, not a review. It looked like a decision because
it was written down.

The habit that catches this is the one `PROGRESS.md` already records:
**check one layer against another.** A domain in code proves nothing
about a domain in DNS, exactly as storage proves nothing about
addressability and a passing unit test proves nothing about wiring.

Nothing checks it now either. **A test cannot own a domain**, and the
honest guard is that an unset value refuses rather than defaults.

---

## What is not built

- **Nothing verifies the configured domain exists.** Setting
  `INGESTION_DOMAIN` to another domain nobody owns produces the same
  situation, more deliberately — and the value is now right, which
  makes the check less urgent and no less absent.
- **The Email Routing rule** (decision 0126) still does not exist, so a
  correctly configured domain still receives nothing.
- **Decision 0140's operator interface waits on the domain too.**
  Cloudflare Access applies policies to hostnames in a zone, and
  `workers.dev` is not one — so `vf-admin` cannot be protected until
  there is a domain to protect it on.
