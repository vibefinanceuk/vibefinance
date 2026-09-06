# 0131 — The proxy carries what a screen calls

**Status: fixed.** Reported from the screen: *"the rename functionality
doesn't work."*

---

## A button refused by the proxy, not the route

`vf-ui` proxies a **deliberate allow-list** to the instance (decision
0102): not a general forwarder, so a path nobody listed is a path
nobody can reach.

Decision 0130 added rename and retire on `/sources/:id`. Decisions 0126
and 0128 had already listed `/sources` and `/sources/:id/email` — and
**the bare path was never added**, which is easy to miss precisely
because the paths beneath it were already there.

The symptom is a button that does nothing, **refused by the proxy rather
than by the route it was aimed at** — which looks identical to a bug in
the route, and sends anybody debugging it to the wrong Worker.

---

## Nothing checked, because nothing could

The route had tests. The screen had tests. Neither could see the gap,
because **`vf-ui`'s Worker tests use stubs and the browser tests stub
`fetch`** — so no test ever put a real path through the real allow-list.

There is now a list of every path a screen calls, exercised against the
proxy. It names what it found:

> Called by a screen and refused by the proxy: `PATCH /api/sources/s-1`,
> `DELETE /api/sources/s-1`. Add the path to `PROXIED_INSTANCE_PATHS`,
> or the button that calls it will silently do nothing.

**Hand-maintained**, and that is a real weakness — decision 0107 records
the same shape letting `field.bt-34` reach a live screen. A path called
by a screen and absent from this list escapes the check. The alternative
is parsing the browser source for `fetch` calls, which would miss a
computed URL and give false confidence instead of an honest gap.

---

## And the first version of the check passed

It looked for a **403**. An unlisted path returns **404**.

So it passed while the reported bug was present, and I only found out
by reintroducing the bug and watching it not fail.

**A test that checks the wrong code reports the wrong answer
confidently**, which is worse than no test — and this is the third time
in two days that watching a check fail has been the thing that
established it worked at all.

---

## What is not built

- **No check in the other direction.** A path listed here and called by
  nothing is dead configuration, and nothing says so.
- **The list does not distinguish methods.** `PATCH /api/sources/s-1`
  and `GET /api/sources/s-1` are the same entry, so a route that should
  only ever be read is proxied for writing too.
