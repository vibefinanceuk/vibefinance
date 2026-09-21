# 0425 — Consolidated spend across org units / legal entities, the Multi-Enterprise CFO View's first real metric

**Status: built, tested, not yet deployed.** This session still has no
push access to `vibefinanceuk/vibefinance`; delivered as a git bundle
for the operator's own pull/push/deploy sequence, the same path
decisions 0391, 0415–0424, 0562 and 0566 already used.

---

## What was asked

"What would be next on the list" — the operator's own open-ended
prompt, once decision 0424 shipped, was pushed, deployed, and
confirmed directly. `docs/PROGRESS.md`'s own "Not built" section was
read to establish the real remaining work, and four ranked candidates
were offered: Executive IQ / Multi-Enterprise CFO View (recommended —
the one still-unbuilt Management Dashboard screen), vendor
banking-detail-change alerts, hold history for Supplier Performance,
and something outside this arc entirely. The operator chose **Executive
IQ / Multi-Enterprise CFO View**.

The design document itself flags two real decisions that need making
before this screen can be built at all, rather than leaving them to be
assumed silently — both put to the operator directly:

- **Scoping approach.** The design's own Screen 5 section states the
  "real gap" plainly: the org switcher is single-select today, with no
  per-entity breakdown across the visible set. It offers two options,
  increasing build cost — reuse `holdsEverywhere` with `GROUP BY
  org_unit_id` (its own "Option 1," and its own stated recommendation
  for a first build), or a genuinely new multi-select org-comparison
  scope (Option 2, explicitly deferred by the design itself: "flagged
  here as a decision for a future design pass, not assumed solved by
  this document"). The operator chose **Option 1**.
- **Which of the screen's six key metrics to build first.** Offered
  four of the six as candidates — consolidated spend (recommended, the
  design's own first-listed bullet, reusing data no new capture is
  needed for), liabilities and accruals by entity, cross-org
  throughput/workload comparison, and cross-entity exception/fraud-
  signal trend. The operator chose **consolidated spend across org
  units / legal entities**.

Investigated before building, the same discipline every decision in
this arc has followed.

---

## What was built

### The route — enterprise-wide, grouped exactly as recorded

`workers/vf-app/src/executive-consolidated-spend-route.ts`, new — `GET
/executive/consolidated-spend`. The design's own first bullet under
Screen 5 — Multi-Enterprise View (Office of the CFO)'s key metrics:
*"Consolidated spend across org units / legal entities."*

**No new access-control concept — the design's own Role-Based Access
Model table for this screen already matches the pre-existing client-
side tab gate exactly.** `AP.Analysis` and `holdsEverywhere = true`,
checked independently (not "AP.Analysis held everywhere" as one
combined fact — a person with `AP.Analysis` scoped to one unit and a
different, unrelated permission held everywhere correctly fails this
gate). This is exactly what `ap-analytics.js`'s own `executiveiq` tab
already checks client-side (`{ ..., permission: "AP.Analysis", global:
true }`, filtered by `!tab.global || holdsEverywhere()`) — checked
again here, server-side, since a hidden tab has never been the same
thing as a closed route in this codebase.

**Enterprise-wide by definition — no `currentOrg` narrowing, on
purpose.** Every other analysis route in this codebase takes a chosen
org and narrows to it (`scopedToChosenOrg`, `unitClause`,
`unitsWherePermitted`); this one deliberately uses none of them. The
entire point of this screen is seeing every entity a CFO is responsible
for, broken out and compared in one place — narrowing to a single
chosen org would collapse the comparison this metric exists to show
back into the same one-org-at-a-time view the design's own "real gap"
section names as the problem. A person who does not hold
`holdsEverywhere` cannot reach this route at all, so there is no
narrower, permission-restricted view that also needs supporting here.

**Grouped by the invoice's own recorded `org_unit_id` — no invented
rollup from an operating unit up to its own parent legal entity.** An
invoice's `org_unit_id` may name either kind (decision 0226's own
deliberate choice not to assume every customer has legal entities
configured: *"what matters is that the header names the company where
one is known, not that it never names anything else"*) — this route
reports each recorded unit exactly as named, carrying its own `kind`
(`legal_entity` or `operating_unit`) so a reader can tell the two
apart rather than this route silently blending them. Building a
further rollup is real, additional work the design does not ask this
route for, and is left for a later decision should a real customer's
own data need it.

**Never summed across currencies** — the same discipline every
monetary screen in this arc already follows (decisions 0416, 0418,
0419, 0421). Grouped by `(org_unit_id, currency)`; the response carries
one ranked breakdown per currency actually present, plus that
currency's own enterprise-wide total, rather than one blended figure
nobody could trust.

**An invoice with no recorded org unit is excluded, not guessed into a
bucket.** The `JOIN org_units` (not `LEFT JOIN`) drops any invoice
whose `org_unit_id IS NULL` — it has not yet been placed at all
(decision 0111 makes Validation the point at which an org must be
known, not capture), so there is no entity for it to roll up under,
honestly. `docs/PROGRESS.md`'s own "Not built" section already names
the dedicated screen this belongs to (`org.unplaced`); this route does
not attempt to be it.

**Uncapped, ranked within each currency — not a top-N list.** Unlike
Supplier Performance's own top-N ranking (a real customer can have
hundreds of suppliers), the org-unit hierarchy this reads is the
enterprise's own structure — a handful to a few dozen entities in
practice — and the entire point of this screen is comparing every one
of them, not the biggest few.

### The card

`workers/vf-ui/public/executive-consolidated-spend.js`, new —
`load()`/`renderCard()`, the same shape every card on every other AP
Analytics tab already uses. Reuses `charts.js`'s own `barList()`, first
built for and proven by decision 0416's "Spend by supplier" card — one
ranked list per currency, each row's own note naming whether that
entity is a legal entity or an operating unit. **`load()` calls no
`currentOrgId()` and sends no `?org=` query at all** — deliberately,
unlike every other card module on this screen, since the whole point of
this card is every entity at once, not whichever one the org switcher
happens to be set to.

`ap-analytics.js`'s `tabContent()` gains a real `executiveiq` branch —
one card, not the whole six-metric screen, the same "one real vertical
slice first" discipline every other tab on this screen started with.

**The proxy allow-list checked directly again, the same discipline this
whole arc keeps.** `/executive/consolidated-spend` matched no existing
wildcard either — confirmed with a real fetch in `test/index.test.ts`'s
own `CALLED_BY_A_SCREEN` list, a new entry added to `PROXIED_TO_INSTANCE`.

**Strings.** `workers/vf-licence/migrations/0137_executive_iq_
consolidated_spend_strings.sql` — the first use of the `executiveiq.*`
namespace (`apanalytics.executiveiq`, the tab's own label from
migration 0129, is a different key and untouched here). Five keys,
English and German: the card's title and subtitle, the empty-state
message, and the two entity-kind labels.

---

## Tests

One new backend route test file: `test/executive-consolidated-
spend.test.ts` (12 tests — the route's own two-part gate, including the
deliberate independence between `AP.Analysis` and `holdsEverywhere`;
grouping by `(org_unit_id, currency)` and never summing across
currencies; an unplaced invoice excluded rather than guessed into a
bucket; an empty, not erroring, report when nothing is priced and
placed yet; and enterprise-wide behaviour confirming a `?org=` query is
silently ignored). One new browser test file: `test-browser/executive-
consolidated-spend.test.ts` (9 tests — the card the route returned,
including a check that the fetch call is the bare path with no query
string at all; a single currency rendering as the plain simple list;
more than one currency splitting into its own labelled group each with
its own total). `test-browser/ap-analytics.test.ts` updated: the old
"Executive IQ says not built yet" test replaced with two new tests
("Executive IQ renders its own real card, decision 0425 — no longer a
placeholder" and "shows a real error for Executive IQ too, when its own
fetch fails") — one test removed, two added, net +1 in this file.

**Suite state, full runs:**

| Package | Before (0424) | After (0425) |
|---|---|---|
| `vf-app` | 2184 | **2196** (2184 + 12 new) |
| `vf-licence` | 320 | 320 (migration only, no new test file; full suite re-run clean) |
| `vf-ui` Worker | 74 | 74 (unchanged in count — the new allow-list path proven by new lines inside an existing test, not a new test) |
| `vf-ui` browser | 850 | **860** (850 + 9 new in the new file, +1 net in `ap-analytics.test.ts`) |

The known, pre-existing `vf-ui` browser unhandled-rejection count (160,
unchanged since at least decision 0414) is unchanged.

`eslint .` clean across `vf-app`, `vf-ui`, and `vf-licence`, every
changed and new file included.

---

## What is not built

**Executive IQ shows one real card, not the whole six-metric screen.**
Of the design's own six Multi-Enterprise CFO View metrics — consolidated
spend, liabilities and accruals by entity, cash position across
currencies, cross-entity supplier concentration, cross-entity exception
and fraud-signal trend, and cross-org throughput/workload comparison —
only the first is built. The other five remain unbuilt, each named as a
declined option in this decision's own first-metric question rather
than assumed solvable by this one build.

**The Option 2 scoping concept — a genuinely new "compare selected
orgs" scope, narrower than "everywhere I hold a role" — stays exactly
where the design document itself leaves it: a decision for a future
design pass, not assumed solved here.** Should real usage show a need
to compare a subset smaller than the full `holdsEverywhere` set, that
is new work, not a natural extension of this route.

**Everything else already listed as not built stays not built** —
Liabilities & Accruals' and Supplier Performance's own remaining
metrics, vendor banking-detail-change alerts, and every other parked
item are unchanged by this decision.
