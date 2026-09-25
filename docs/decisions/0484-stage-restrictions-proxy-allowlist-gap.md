# 0484 — Stage Restrictions: the save route was never proxied

**Status: built and verified locally, not yet committed/pushed at the
time of writing.** No push access from this session — delivered as a
git bundle, per this repo's own established handover mechanism.

---

## What was asked

Reported live, testing decision 0483's new Stage Restrictions tab:
*"The checkboxes seem not to be able to be unchecked. On trying to
uncheck any of the new boxes, 'not found' appears at the bottom of the
screen."*

## What was found

**A real bug, and a recurring class of bug this project already has a
name for.** `vf-ui` is a backend-for-frontend: the browser only ever
talks to `vf-ui`'s own origin, and `vf-ui` proxies `/api/*` on to
`vf-app` through an **explicit allowlist**, `PROXIED_TO_INSTANCE` in
`workers/vf-ui/src/index.ts` — deliberately not a general forwarder,
per that list's own doc comment: *"a proxy that forwards whatever it
is given forwards routes nobody has thought about."*

`PUT /processes/stages/:id/field-visibility` — the route decision
0483's whole tab is built on, real and tested in `vf-app` since
decision 0143/0196 — was never added to that list. Every save from the
new tab reached `vf-ui`, matched nothing, and fell through to this
proxy's own generic `{"error": "not found"}` fallback before `vf-app`
ever saw the request. `GET /field-visibility` (the plain, non-stage
path the tab's own initial load and the invoice viewer both already
use) *was* already on the list, which is exactly why the tab rendered
correctly and only the save failed — the same "half the paths a screen
needs are listed, the other half are not" shape this exact list has
caught repeatedly before (decisions 0212, 0319, 0324, 0418 through
0423, 0452, 0472, 0476, each doc-commented in place as a "found again"
instance of the same gap).

**Missed for an ordinary reason.** Decision 0483 added the backend
route parameter and the `vf-ui` frontend screen calling it, and
verified both independently — the backend tests never touch the proxy
layer at all (they call `handleSetStageFieldVisibility` directly), and
the frontend browser tests stub `fetch` itself, so neither one exercises
`vf-ui`'s own routing worker end to end. Only `workers/vf-ui/test/
index.test.ts`'s own `CALLED_BY_A_SCREEN` list — built specifically to
catch this class of gap — does, and the new route was never added to
it either.

## What was decided

Add the missing pattern to `PROXIED_TO_INSTANCE`, and add the route to
`CALLED_BY_A_SCREEN` alongside it — not after the fact, the same
discipline decisions 0474/0476 already modelled for a route added
*with* its allowlist entry rather than found missing later. Every
other route decision 0483 relies on (`GET /processes`, `GET
/processes/:id`, `GET /field-visibility`) was already on the list, so
nothing else needed adding.

## What was built

- **`workers/vf-ui/src/index.ts`**: `/^\/processes\/stages\/[^/]+\/field-visibility$/`
  added to `PROXIED_TO_INSTANCE`, beside the existing sibling
  `/processes/stages/:id/read-only` entry.
- **`workers/vf-ui/test/index.test.ts`**: `["PUT",
  "/api/processes/stages/validation/field-visibility"]` added to
  `CALLED_BY_A_SCREEN` — asserts a 401 (reached `vf-app`, refused for
  want of a session), not a 404 (refused by this proxy itself), the
  same distinction every entry in that list already enforces.

## What was not built

No change to `vf-app` or `vf-licence` — the route itself, and
everything decision 0483 built on top of it, was already correct.
This is purely a `vf-ui` routing gap.

## Verification

`workers/vf-ui/test/index.test.ts`: **61/61**, including the new
entry. Full `vf-ui` Worker suite (both test files): **74/74**. `tsc
--noEmit` shows no new errors in `src/index.ts` (only the same
pre-existing noise in `vf-app` files this project has already
documented repeatedly).

## Still to do, operator side

Push and deploy `vf-ui` only — no `vf-app`/`vf-licence` change, no new
migration. Once live, re-test unchecking an Account Coding field on
the Stage Restrictions tab; it should save without the "not found"
message, and the field should disappear from the Validation stage on
reload.
