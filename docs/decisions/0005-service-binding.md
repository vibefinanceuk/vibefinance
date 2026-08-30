# 0005 — Worker-to-Worker calls use a Service Binding, not a public fetch

Status: settled, 30 August 2026. Found live, in production, the first
time either scheduled inter-Worker call (licence refresh or usage
push) was ever actually exercised from *inside* a deployed Worker
rather than from a terminal.

## What broke, and how it was found

`POST /usage/push` on the live `vf-app` returned `{"error":"usage
push failed","detail":"Error: usage push returned HTTP 404"}`. Direct
`curl` to `vf-licence`'s `/usage` endpoint worked perfectly — same
payload, same URL path, immediate success. `npx wrangler tail` on
`vf-licence` while retriggering the push showed **nothing at all**: no
incoming request logged, not even one that errored.

That absence is the actual diagnostic signal. If `vf-licence` had
received the request and returned 404 itself, `wrangler tail` would
show it. It didn't — meaning the request never left `vf-app`'s own
boundary, or was intercepted before ever reaching the target Worker.

Confirmed against Cloudflare's own docs (`workers/runtime-apis/fetch/`):
*"Worker-to-Worker fetch requests are possible with Service bindings or
by enabling the `global_fetch_strictly_public` compatibility flag."*
The implication, confirmed by multiple independent community reports
describing the identical symptom (a silent 404, request never received
by the target Worker): **a Worker cannot plain-`fetch()` another
Worker's `*.workers.dev` URL from inside its own handler.** This is a
deliberate anti-loop / anti-abuse restriction on `workers.dev`
subdomains specifically — calls from outside a Worker (a browser,
`curl`, this session's own `verify-live-key-match.mjs`, which runs as
a local Node script, not inside a Worker) are entirely unaffected,
which is exactly why every earlier confirmation in this session
(`curl`, the local verification script) worked while the real
in-Worker call silently didn't.

## Why this matters more than just `/usage/push`

The licence-refresh cron makes the *identical kind* of call — `fetch()`
from inside `vf-app`'s `scheduled()` handler to `vf-licence`'s
`/licences/:id/token`. It had never actually fired yet (the 6-hour cron
hadn't triggered since this was deployed), so this would have failed
the exact same way, silently, the first time it did — `refreshLicenceCache`'s
fail-open design means this would have looked like nothing at all: no
error surfaced anywhere, `vf-app` simply staying on its last cached
licence state forever. Caught now, before that ever happened in
production, specifically because usage push's on-demand endpoint
surfaced the failure immediately and loudly, rather than being
absorbed into a fail-open design like the licence refresh's.

## The fix: Service Bindings, not the compatibility flag

Two options existed. `global_fetch_strictly_public` was rejected:
one source describes it as still failing for `workers.dev` URLs
specifically ("still fails" for a `my-worker.my-subdomain.workers.dev`
URL that is not public) — meaning it would need a real custom domain
to work reliably, which neither Worker has today.

Service Bindings are the officially documented, purpose-built
mechanism for exactly this scenario — listed first in Cloudflare's own
docs. `workers/vf-app/wrangler.jsonc` now declares:

```jsonc
"services": [{ "binding": "LICENCE_SERVICE", "service": "vf-licence" }]
```

`env.LICENCE_SERVICE.fetch(...)` has the identical signature to global
`fetch()`, so the actual code change at each of the two call sites
(the licence-token fetch in `scheduled()`, and `createUsagePusher`) was
small — swap the function called, not the surrounding logic. The
target URL's hostname is now irrelevant to routing (the binding routes
directly to the named Worker regardless of what URL is passed), so a
fixed internal placeholder (`https://vf-licence.internal/...`) is used
purely so `vf-licence`'s own `new URL(request.url)` parsing has
something well-formed to read a path from.

`LICENCE_SERVER_URL` is no longer read by any code path, but is kept
declared in `wrangler.jsonc` rather than removed — still useful for a
human doing manual `curl` debugging, exactly how this whole problem was
first diagnosed.

## The real limitation this doesn't solve

Service Bindings only work when both Workers are in the **same**
Cloudflare account (Cloudflare's own docs: "This Worker must be on
your Cloudflare account"). That's true for today's deployment — one
account, both Workers — but not necessarily for a genuinely
self-hosted customer instance in a *different* account, a possibility
`docs/decisions/0001-worker-split-and-tenant-resolution.md` left open.
A cross-account `vf-app` would need a different mechanism entirely — a
real custom domain plus `global_fetch_strictly_public`, most likely —
not solved here, and not silently assumed to be solved by this fix.
Worth revisiting if and when a self-hosted, different-account customer
is real rather than hypothetical.

## Testing implication

Declaring a `services` binding in the test-only `wrangler.test.jsonc`
would need either a live remote connection or a second, auxiliary
Worker configured to run inside the test pool — neither available
here, the same class of constraint that kept the `ai` binding out of
`wrangler.test.jsonc` earlier. `workers/vf-app/test/scheduled.test.ts`
instead injects a fake `Fetcher`-shaped object (`{ fetch: vi.fn(...) }`)
directly onto the `env` object per test, exactly the same pattern
already used for the AI binding and the licence public key.
