# 0216 — A message that named the wrong layer

**Status: fixed, and the underlying failure is not yet known.** Read the
last section.

---

## One `try` around three different things

The load button wrapped the request, the parse and the redraw together:

```js
try {
  const response = await fetch(...);
  const body = await response.json();
  render();
} catch {
  note("We could not reach the service to load that file.");
}
```

**So a bug in the redraw reported a network failure.** Three unrelated
faults gave one message, and the message named the layer least likely to
be at fault.

**Decision 0190 found the same shape** and said why it matters: a 500
reported as *"sign-in failed"* blames the person for something they
cannot see. Here it is worse in one way — **a person told the network
failed will retry a load that already succeeded.**

---

## Three failures, three messages

**The request did not leave** — *"we could not reach the service"*, which
is now only said when `fetch` itself throws.

**The service refused** — the route's own words. A file with no ERP
identifier column says so, and that is something a person can fix.

**The file loaded and this screen broke** — said as itself, **with the
real error text**, because the two halves need different people.

---

## What I have not done

**I do not know what the live failure was.** Every test passes, the
route is right, the proxy path is listed, and the permission is now the
one twenty-two other routes use.

**So this record fixes the reporting and not the fault.** The next
attempt will name it — which is the point of the change, and not the
same as having solved it.

**Saying so is deliberate.** A record claiming this fixed the load would
be wrong the moment somebody tried it, and decision 0162's whole
argument is that a system which knows something should say so. **That
applies to me as well as to the code.**
