# 0227 — A name said once

**Status: fixed.** The Buyer card's sub-line is gone, and a stub no
longer outlives its file.

---

## Scaffolding from a model that changed

The sub-line read *"Acme UK Limited"*, and the Name field directly
beneath it read *"Acme UK Limited"*.

**Decision 0224 put it there for a real reason.** An invoice was
assigned to an operating unit beneath a legal entity, and a card naming
only one of them named a department with no identity or a company with
no department.

**Decision 0226 made them the same row**, and the line became a name
said twice.

**The Seller card keeps its sub-line**, and that is not an
inconsistency: it carries the ERP number, the site and whether the site
takes payment — **none of which appears anywhere else on the card**.

---

## And a test that failed by order

`tasks.test.ts` had been failing intermittently — passing alone, failing
in a full run — with *"no stub for /api/invoices/inv-1/document-url."*

**`vi.stubGlobal` is not undone between files.** The viewer tests
installed a `fetch` stub and never removed it, so whichever file ran
next inherited it.

**One of nine files cleaned up after itself.** I had noticed the failure
once, checked it did not reproduce alone, and moved on — which is
exactly how an order-dependent test survives.

***A test that fails by order is worse than one that fails.*** The first
time it goes green nobody knows whether it was fixed or reshuffled.
