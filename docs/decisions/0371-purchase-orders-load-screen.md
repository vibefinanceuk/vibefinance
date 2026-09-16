# 0371 — The purchase order load screen, and two gaps it uncovered

**Status: built.** A CSV upload screen for purchase orders — the
operator's own follow-up question after decision 0370's backend-only
CSV loader: *"Is there a UI for upload also?"* Answering it honestly
first required finding, and closing, two real gaps that predate this
work by months.

---

## Where it lives, and why

**`Admin.Configure`, in the existing "Configuration" nav group,
alongside Sources, Rules, Processes and Access.** The operator's own
instinct, confirmed rather than assumed: the backend route this screen
calls (`POST /purchase-orders/csv-load`, decision 0370) already
requires exactly that permission, and the reasoning is the same one
decision 0081 gave for the route itself — loading orders is setting up
what invoices get matched against, not accounts payable work.

**A load screen, not a smaller Suppliers screen.** There is no `GET`
that returns every purchase order on file — only lookup by a single
order number, which this screen has no reason to call. Suppliers can
say *"loaded 4 days ago"* because its own list endpoint carries that
alongside the data; nothing equivalent exists here, and building one is
a separate, bigger piece this screen does not need to do its one job.
So the screen is the loader alone: a file picker, a Load button, and
the same load-outcome summary the backend route already returns —
orders loaded, orders replaced, lines loaded, and any refused orders
with their own reasons, mirroring exactly how `suppliers.js` already
reports a CSV load's outcome.

A new icon — a package outline — deliberately distinct from the
Documents icon: a purchase order is reference data, not a document with
work attached to it, the same distinction decision 0081 drew when it
kept ingestion off `/sources/:id/capture` entirely.

---

## Gap 1: the route existed and nothing could reach it

`/purchase-orders` (XML, decision 0081) and `/purchase-orders/csv-load`
(CSV, decision 0370) both worked correctly against `vf-app` directly,
and neither was ever added to `vf-ui`'s own proxy allowlist —
`PROXIED_TO_INSTANCE` in `workers/vf-ui/src/index.ts`. A `curl` against
the real backend would succeed; the same call through `/api/...` would
404, indistinguishable from a route that does not exist at all.

This is not a new class of bug. The allowlist's own comments already
name it three times over — decision 0204's org picker, decision 0211's
supplier load, decision 0335's org-unit editing — each shipped once,
found later by a real request failing. This is the fourth instance,
found here before a real request could.

Fixed by adding all three purchase-order routes to the allowlist.
Covered by a worker-level test (`vf-ui/test/index.test.ts`) that was
itself extended at the same time: `CALLED_BY_A_SCREEN` (every path a
real screen actually calls, checked for a non-404) and `reachable`
(every path the allowlist should recognise, whether or not a screen
calls it yet) both now include the purchase-order paths.

---

## Gap 2: fifteen migrations that never reached a test

This app's interface strings are not bundled with the frontend — they
are served from `vf-licence`'s own `ui_strings` table, seeded by
migration, fetched at runtime (decision 0107). Adding a new screen
therefore meant a new `vf-licence` migration (`0110`), seeding every
string the screen uses in every supported language — English and
German, the same two decision 0213's own supplier-screen migration
seeded.

Wiring that migration into `vf-licence/test/setup.ts` (the test
database's own migration chain) surfaced something unrelated to this
screen entirely: **fifteen migrations already on disk — `0095` through
`0109` — were never imported into `setup.ts` at all.** The test suite
had been running against a `ui_strings` table stale by months, and nothing
caught it, because the string-coverage test only ever checks the keys a
screen hand-declares itself as using — a key nobody had yet listed was
a key nobody had yet noticed was missing.

Checked directly before fixing: all fifteen are pure `ui_strings`
inserts or updates, no schema changes, so restoring them carried no
structural risk. Added, along with the new `0110`, and the full
`vf-licence` suite — 320 tests — confirmed clean afterward, not just
the string-coverage test that surfaced the gap.

---

## What this does not do

**No bulk browsing, filtering, or editing of loaded orders.** Stated
above — there is no list endpoint, and building one is a separate
decision.

**No freshness indicator.** Suppliers' own "loaded N days ago" depends
on its list endpoint carrying `lastLoad` alongside the data. Nothing
equivalent exists for purchase orders.

**No XML upload from this screen.** The backend route
(`POST /purchase-orders`, decision 0081) still exists and still works;
this screen calls the CSV path specifically, since that was the
operator's own stated interest and the two response shapes differ
enough (one order confirmed vs. a bulk load summary) that combining
them into one control would be a second, different screen rather than
an addition to this one.

**Still no Sources/inbound-channel integration**, per decision 0370's
own explicit deferral — the CSV endpoint remains a plain, manually
triggered upload.

---

## Tests

`test-browser/purchase-orders.test.ts` — 10 new tests: the screen
renders, states what it is for, shows the load control without ever
calling a list endpoint that does not exist, places Load top-right of
its own card (decision 0300's established pattern), refuses to load
with no file chosen, reports orders/lines/replaced counts correctly,
shows a refused order with its own stated reason rather than a generic
failure, and — decision 0216's one-try-per-thing discipline — correctly
distinguishes a request that never reached the service from one that
did and was refused for a real, specific reason.

`vf-ui/test/index.test.ts` — the proxy allowlist extended, both lists.

Existing nav tests updated for the new item: `tasks.test.ts` (three
assertions: the full grouped list, the permission-hides-an-item case,
and the per-permission unlock case) and `rules.test.ts` (the flat nav
list). All were exact-list assertions by design — decision 0346's own
reasoning, restated: a test that asserts a count rather than a set goes
stale silently the next time a screen is added; asserting the set
itself is what caught this one immediately, correctly, and loudly.

`vf-licence/test/string-coverage.test.ts` — the new keys added to
`KEYS_THE_INTERFACE_USES`.

vf-ui: 72 worker tests (was 69 — three new `reachable` entries each
generate their own test), 564 browser tests (was 554 — ten new for
this screen). vf-licence: 320 tests, full suite confirmed clean after
restoring the fifteen missing migrations alongside the new one.
