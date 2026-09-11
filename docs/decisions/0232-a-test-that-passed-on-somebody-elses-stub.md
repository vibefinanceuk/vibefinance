# 0232 — A test that passed on somebody else's stub

**Status: fixed.** Every browser test undoes its stubs, and one test
that had never really passed now does.

---

## Decision 0227 fixed one file

That record found `vi.stubGlobal` is not undone between files, added an
`afterEach` to the viewer tests, and noted that **one of nine files
cleaned up after itself.**

**It fixed the file with the symptom.** The other seven kept leaking,
and the intermittent failure moved rather than went.

---

## And cleaning up the rest revealed the real one

With every file undoing its stubs, `"reaches Tasks from Documents"`
failed **alone**.

`tasks.test.ts` never stubbed `/api/invoices/inv-1/document-url`. The
Documents screen fetches it, and **the viewer tests' `fetch` was still
installed** — so the navigation was tested against another file's
fixture, and went green on it.

**The test had never exercised its own stub.** It was not flaky; it was
wrong, and the flakiness was the only thing making that visible.

---

## What this says about the earlier fix

**Decision 0227 saw the symptom and treated it.** *"One of nine files
cleaned up after itself"* is in that record as an observation, and the
obvious next line — *so fix the other eight* — was not written.

**A leak found in one file is a convention missing from all of them.**
