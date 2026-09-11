# 0212 — A route the proxy does not know

**Status: fixed.** Two routes the app could not reach, and a test that
notices the next one.

---

## Found by using it

```
curl -X POST https://app.vibefinance-ai.com/api/suppliers/load ...
{"error":"not found"}
```

**The route existed, was deployed, and was tested.** `vf-ui` forwards
only paths on an allow-list, and `/suppliers/load` was not on it.

**And `/sources/:id/org` was not either** — decision 0204's dropdown,
shipped four days ago, which would have returned the same thing the
first time anybody changed a source's org.

**The same mistake twice**, and the second one had been live and unused
long enough that nobody found it.

---

## The list is right and the gap is around it

**A deliberate allow-list is the correct design.** `vf-ui` holds the
session and `vf-app` trusts what it forwards, so *"forward anything"*
would make the proxy a hole rather than a boundary — and decision 0189
already found that reading `bff: true` as *"a flag"* rather than *"an
architecture"* was the wrong instinct.

**The gap is that adding a route and adding it here are two steps**, and
nothing ties them together. A route works in every test `vf-app` has and
does not exist to a person using the app.

---

## What the test does, and does not, catch

Four paths are asserted reachable, and **`401` is the pass**: the proxy
recognised the path and asked for a session. **`404` means it did not
recognise it at all.**

**This does not stop the next one.** It asserts that four particular
routes are listed, not that every route is — nothing enumerates
`vf-app`'s routes to compare against.

**A real check would**, and it would need the router to be data rather
than a sequence of `if` statements. That is a larger change than this
was worth, and it is recorded rather than pretended away.
