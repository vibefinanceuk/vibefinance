# 0417 — AP Analytics, tabbed and permission-gated

**Status: built, committed locally — not yet pushed or deployed.**
This session still has no push access to `vibefinanceuk/vibefinance`;
delivered as a git bundle for the operator's own pull/push/deploy
sequence, the same path decisions 0391, 0415, 0416, 0562 and 0566
already used.

---

## What was asked

With Workload (0415) and Supplier Performance (0416) both shipped as
their own standalone nav items and confirmed live, before another
Management Dashboard screen was built:

> "One thing worth aligning on now, before more screens are built. I
> was hoping to have an AP Analytics link, with all dashboard
> available via tabs. Using similar pill-box tabs seen in the Access
> screen. The tabs can be for Operational Performance, Financial
> Performance, Supplier Performance, Executive IQ, and Fraud
> Prevention."

Three questions were asked and answered directly rather than guessed:

1. **Which design screen does each tab name map to?** Confirmed:
   Operational Performance = Workload, Financial Performance =
   Liabilities & Accruals, Supplier Performance = Supplier
   Performance, Executive IQ = Multi-Enterprise CFO View, Fraud
   Prevention = Fraud & Risk Detection.
2. **Do Workload and Supplier Performance stay as their own nav
   items, or move under the new tabbed screen?** Confirmed: move
   under AP Analytics — their standalone nav items are removed
   entirely, and their own content becomes two of the five tabs.
3. **What should actually get built right now?** Confirmed: the tab
   shell itself, with Operational Performance and Supplier
   Performance wired to the real data 0415 and 0416 already built,
   and the other three tabs showing a plain "not built yet"
   placeholder rather than waiting for all five to be real at once.

A fourth requirement arrived mid-build, as its own explicit
instruction rather than something inferred from the first three:

> "Access to tabs, and visibility of tabs controlled through user
> permissions."

---

## What was built

**Two screens folded into reusable content modules, not deleted.**
`workers/vf-ui/public/workload.js` and
`workers/vf-ui/public/supplier-performance.js` each lose their own
`open()` — the entry point a standalone nav item called — and keep
their already-tested `load()` (fetch) and `renderCard()` (draw)
exports, now called directly by the tab shell instead. Neither
module's own topbar, frame, or fetch logic changed; only the piece
that assembled a full page around the card is gone, because the tab
shell now owns that.

**`workers/vf-ui/public/ap-analytics.js`, new — the tab shell.** A
`TABS` array of five `{ key, labelKey, permission, global? }` entries,
in the operator's own order. `availableTabs()` filters it down to
what the signed-in person may actually see; `tabBar()` draws
`access.js`'s own `.tabbar`/`.tab` pill component — reused rather
than rebuilt, the exact shape the operator pointed at by name — over
whatever survived that filter. The two real tabs (`operational`,
`supplier`) call the corresponding module's `load()` then
`renderCard()`; the other three render a plain `placeholderCard()`
reading "not built yet," itself gated on that tab's own real
permission so who can even see a tab exists is correct today, ahead
of what is behind it. A failed `load()` renders a real error card
rather than a blank pane, the same discipline every other screen's
own fetch already follows.

**Tab visibility is permission-gated, not merely which tabs exist —
the mid-turn requirement.**

| Tab | Design's own screen | Permission |
|---|---|---|
| Operational Performance | User & Team Workload | `AP.Analysis` |
| Financial Performance | Liabilities & Accruals | `AP.Analysis` |
| Supplier Performance | Supplier Performance | `AP.Supplier` |
| Executive IQ | Multi-Enterprise CFO View | `AP.Analysis` **and** `holdsEverywhere` |
| Fraud Prevention | Fraud & Risk Detection | `AP.FraudReview` (new, reserved) |

**The permission each tab checks matches its own route's own gate,
not the design document's original proposal.** The design's own
Role-Based Access Model table lists two permissions apiece for
Workload (`AP.TaskManage` + `AP.Analysis`) and Supplier Performance
(`AP.Supplier` + `AP.Analysis`) — but decisions 0415 and 0416 each
deliberately shipped with a single permission instead. Gating a tab
more strictly than the data behind it would mean a person could reach
that data through the API the tab itself hid from them, or the
reverse; a tab's own gate is always exactly what `hasPermission`
already checks server-side for that tab's data, never a second,
independent guess at it. Financial Performance and Executive IQ have
no route of their own yet, so both were given the permission the
design document itself proposes for their eventual screens, ahead of
either actually existing.

**`AP.FraudReview`, new — reserved, granted by no migration.** Added
to `permissions.ts`'s `AP_PERMISSIONS` and given a
`PERMISSION_DESCRIPTIONS` entry, the same "reserved, unused" standing
`AP.Analysis` itself held before decision 0415 gave it a real route to
gate. Nothing seeds it to anyone yet; a Fraud Prevention screen still
needs building before it does anything beyond hiding its own
placeholder tab from everyone.

**Caught by `stage-permissions.test.ts`'s own standing check, not
missed.** `test/stage-permissions.test.ts`'s *"the closed set, in two
places"* compares every permission `permissions.ts` defines against a
hand-restated `NOT IN (...)` list spread across migrations `0048`,
`0062`, `0063`, and `0066` — exactly the mechanism its own comment
describes: *"A hand-copied list drifts, and this one did"* once
already, decision 0350's own story. Adding `AP.FraudReview` to
`permissions.ts` without updating that list failed the very first
full `vf-app` run, precisely as designed. Fixed the same way `0066`
fixed it for `Supplier.Maintain` — a new migration,
`migrations/0071_ap_fraud_review_permission.sql`, restating the whole
invariant with `AP.FraudReview` added, rather than editing any
already-applied migration in place; `stage-permissions.test.ts` gained
a fifth import alongside it.

**`AP.Analysis`'s and `AP.Supplier`'s own descriptions were widened**,
not left describing only their original single screen —
`AP.Analysis`: *"See the AP Analytics screen's Operational and
Financial Performance tabs"*; `AP.Supplier`: *"View and manage
suppliers, and the AP Analytics screen's Supplier Performance tab."*
A description that still named "the Workload screen" after Workload
stopped being a screen of its own would have been wrong the moment
this shipped.

**Executive IQ's second gate reuses `me.holdsEverywhere`, not a new
concept.** `orgPicker()` (`orgs.js`) has read this boolean off `me`
since decision 0313's own org switcher; `tasks.js` now exports it as
`holdsEverywhere()` for the first time, because a screen needs it for
something other than the switcher. The design document's own
reasoning for gating the CFO View this way — a consolidated view
across every entity is more sensitive than any single org-scoped
permission alone — is why Executive IQ's own tab checks it too, ahead
of a real CFO View route existing to enforce it server-side.

**Nav consolidation.** `tasks.js`'s `NAV_GROUPS` drops the standalone
`workload` and `supplierperformance` entries and gains one
`apanalytics` entry in their place, positioned where Workload used to
sit (`accountspayable`'s own second item, right after Dashboard);
"Supplier management" now holds only `suppliers`. `NAV_PERMISSIONS`
gains `apanalytics: ["AP.Analysis", "AP.Supplier", "AP.FraudReview"]`
— an **OR**, the same shape `roles`'s own two-permission entry
already used — so anyone holding even one of the three permissions
that unlock some real content sees the nav item at all, and the tab
bar itself narrows further from there. `go()`'s dispatcher gains a
single `apanalytics` branch in place of the two branches it is
replacing.

**Icon.** `icons.js` gains `apanalytics` — a single rising trend line
with a marker at its high point, distinct from `workload`'s two
people, `supplierperformance`'s ranked bars, and `dashboard`'s own
four uneven tiles; none of those three say "a trend across everything
this screen now holds" the way a rising line does. The `workload` and
`supplierperformance` icon entries themselves stay in the file rather
than being deleted — nothing on the nav points at them any more, but
their own screens' history still does, the same discipline decision
0078 already established for `discard`.

**Strings.**
`workers/vf-licence/migrations/0129_ap_analytics_strings.sql` adds
`nav.apanalytics`, `apanalytics.heading`, `apanalytics.sub`,
`apanalytics.operational`, `apanalytics.financial`,
`apanalytics.supplier`, `apanalytics.executiveiq`, `apanalytics.fraud`,
`apanalytics.notbuilt`, `apanalytics.loaderror`, and
`apanalytics.none`, in English and German.

---

## Tests

**`workers/vf-app`**: `permissions.ts`'s own change needed no new test
*file* — `test/org-route.test.ts` derives its permission-description
expectations dynamically from `PERMISSIONS`/`PERMISSION_DESCRIPTIONS`
rather than a hand-written list, so it re-passed unchanged against the
new `AP.FraudReview` entry and the two reworded descriptions without
being touched itself. It did need a new *migration*:
`stage-permissions.test.ts`'s own closed-set check failed the first
full run exactly as designed (see above), fixed by
`migrations/0071_ap_fraud_review_permission.sql` and a fifth import in
that test file, not by weakening the check.

**`workers/vf-ui/test-browser/workload.test.ts` and
`supplier-performance.test.ts`, rewritten, not just re-passed.**
Both used to call the module's own `open()`; since neither module
exports it any more, both now call `load()` then `renderCard()`
directly and mount the result themselves, dropping the `.topbar`
assertions that belonged to a page neither module owns any more.
Every property either file already proved about its own card's
content — the chart, the currency split, the empty state, the chosen
org reaching the fetch — is unchanged, only reached a different way.

**`workers/vf-ui/test-browser/ap-analytics.test.ts`, new — 15
tests.** Deliberately does not re-prove what `workload.test.ts` and
`supplier-performance.test.ts` already cover in detail; it proves the
shell's own wiring instead:

- The topbar's own heading and subtitle; `setCurrentScreen` marking
  it the current nav item.
- **Tab visibility, permission by permission**: `AP.Analysis` alone
  shows Operational and Financial only; `AP.Analysis` without
  `holdsEverywhere` keeps Executive IQ hidden, and shows it once both
  are true; `AP.Supplier` alone shows only Supplier Performance;
  `AP.FraudReview` alone shows only Fraud Prevention; all three
  permissions plus `holdsEverywhere` show all five, in the operator's
  own order; holding none of the three renders "no tabs available"
  rather than an empty pane.
- **Default tab selection** lands on the first tab `TABS` itself
  names among the ones actually available — proven with a permission
  set (`AP.FraudReview` + `AP.Supplier`, no `AP.Analysis`) where the
  first-available tab (Supplier Performance) is not simply the first
  tab in the array (Operational Performance) or the last one granted.
- **Wiring**: the Operational tab renders `workload.js`'s own card
  content; the Supplier tab renders `supplier-performance.js`'s own;
  the three unbuilt tabs each say "not built yet," gated on their own
  real permission; a failed fetch on a real tab renders a real error
  rather than crashing.
- **Switching tabs**, including into and out of real and placeholder
  content, with exactly one tab ever marked active at a time — an
  async click handler (a real tab re-fetches on the way in), so
  switching is polled for the same way `tasks.test.ts`'s own
  nav-collapse test already treats an async click.

**Two pre-existing nav-enumeration tests updated again, for the
second time in three decisions.** `test-browser/tasks.test.ts` and
`test-browser/rules.test.ts` each hard-code the full nav item list
to catch a screen appearing or disappearing (decision 0213's own
stated purpose for them). Both needed `"Performance"` removed from
its old position and `"AP Analytics"` inserted where `"Workload"`
used to sit (never itself tested here — the same pre-existing,
out-of-scope gap decision 0416 already documented and deliberately
left alone). `tasks.test.ts`'s own `AP.Supplier`-unlocks-two-items
assertion (added in 0416) changed from `["Suppliers", "Performance"]`
to `["AP Analytics", "Suppliers"]` — a different second label
(`AP.Supplier` now unlocks AP Analytics through its own OR-gate
rather than a standalone Performance item) **and a different order**:
`NAV_GROUPS` lists "accountspayable" (AP Analytics' own home) ahead
of "suppliermanagement" (Suppliers' own), so that is the order both
items appear in regardless of which permission unlocked them — caught
by the test itself failing on the first, order-naive guess, not
reasoned out in advance.

**Suite state, full runs:**

| Package | Before (0416) | After (0417) |
|---|---|---|
| `vf-app` | 1998 | 1998 (permission change only; no new test file, `org-route.test.ts` re-passed unchanged) |
| `vf-licence` | 320 | 320 (migration only; full suite and a `--replay-only` of the whole 129-migration chain both re-run clean) |
| `vf-ui` Worker | 74 | 74 (unchanged — no new `/api/*` path; the tab shell calls the same two routes 0415/0416 already proxy) |
| `vf-ui` browser | 747 | **762** (747 + 15 new) |

The known, pre-existing `vf-ui` browser unhandled-rejection count
(160, unchanged since at least decision 0414) is unchanged.

`eslint .` clean across `vf-app`, `vf-ui`, and `vf-licence`, every
changed and new file included.

---

## What is not built

**Financial Performance, Executive IQ, and Fraud Prevention have no
real route or screen yet** — each is a permission-gated placeholder,
exactly as scoped. Financial Performance (Liabilities & Accruals) and
Fraud Prevention (Fraud & Risk Detection) both still need their own
first vertical slice, the same way Workload and Supplier Performance
each got one before this decision existed. Executive IQ (the
Multi-Enterprise CFO View) still needs the real multi-org scoping
concept this codebase does not have — decision 0416 already noted
this as the hardest of the four remaining Management Dashboard
screens, and nothing here changed that.

**Fraud Prevention's own permission is reserved, not enforced by any
route.** `AP.FraudReview` exists and gates its own tab's visibility,
but grants nobody anything today — no migration seeds it to any role,
and no server-side route checks it yet, the same standing
`AP.Analysis` itself held from decision 0362 until decision 0415 gave
it something real to gate.

**No cross-tab state.** Switching tabs re-fetches a real tab's own
data every time it becomes active rather than caching what was
already loaded once; not asked for, and each of the two real tabs'
own data is cheap enough today that a five-tab shell refetching on
every switch was not worth a caching layer neither existing screen
needed on its own.
