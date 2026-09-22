# 0441 — AP Setup: the proxy never carried its own new routes

**Status: built, tested, pushed and deployed, confirmed directly** —
`origin/main` fetched directly reads `3aadf95`, matching this session's
own commit exactly; the operator confirmed with *"deployed and
pushed."* This session still has no push access to
`vibefinanceuk/vibefinance`; delivered as a git bundle for the
operator's own pull/push/deploy sequence, the same path decisions 0391,
0415–0440 already used. **The proxy fix alone did not close the
report** — see "What was found next, after this deployed," below; the
report is fully resolved only as of the operator's own *"that worked -
thank you."*

---

## What was reported

*"I do get a message saying 'AP Setup could not be loaded', when I
click on the side menu item - AP Setup"* — immediately after confirming
decision 0440 itself pushed and deployed.

## What was found

**`vf-ui` is not just static assets.** It is a backend-for-frontend
(decision 0102) that holds the browser's session and proxies API calls
to `vf-app` through an **explicit allowlist**,
`PROXIED_TO_INSTANCE` in `workers/vf-ui/src/index.ts` — deliberately
not a general forwarder, so a route added to `vf-app` is invisible to
the browser until it is *also* added here. `workers/vf-ui/test/
index.test.ts`'s own `CALLED_BY_A_SCREEN` list exists specifically to
catch this, and its own comments already document the identical gap
more than a dozen times over (decisions 0212, 0319, 0324–0328, 0415,
0417–0425, 0428, 0430) — every one of them the same shape: a route
real and tested in `vf-app`, a nav item and a click handler both real
in `vf-ui`, and the proxy answering `{"error": "not found"}` before
`vf-app` ever saw the request.

**Decision 0440 is the thirteenth instance of the same gap.** The five
new `/approval-config` routes were built, tested and wired into
`vf-app`'s own router, but never added to `PROXIED_TO_INSTANCE` — so
every fetch `ap-setup.js` made (`/api/approval-config` for the config
itself, `/api/org/overview` for the unit/user pickers) had the second
one refused outright, `load()` returned `false`, and the screen's own
decision-0322-style failure path fired exactly as designed: *"AP Setup
could not be loaded."* `ap-setup.js` and `approval-config-route.ts`
were both already correct — confirmed by reading them again rather
than assumed, before touching anything.

**Not caught before delivery because the wrong test suite ran.**
`workers/vf-app`'s own test suite (2534 tests), `workers/vf-licence`'s
(320), and `vf-ui`'s own **browser** suite (973, `vitest.browser.
config.ts`) all ran clean for decision 0440 — none of them touch this
allowlist, because it lives in `vf-ui`'s own plain Worker code
(`workers/vf-ui/src/index.ts`), tested by a *separate* suite
(`workers/vf-ui/test/index.test.ts`, `vitest.config.ts`) that was
never run this round. That suite is exactly the regression net decision
0131 built for this precise failure mode, and it would have failed
immediately had it been run.

## What was built

Five new entries on `PROXIED_TO_INSTANCE`:

```
/^\/approval-config$/
/^\/approval-config\/supervisor-overrides$/
/^\/approval-config\/supervisor-overrides\/[^/]+\/[^/]+$/
/^\/approval-config\/limit-overrides$/
/^\/approval-config\/limit-overrides\/[^/]+\/[^/]+\/[^/]+$/
```

And six new entries on `CALLED_BY_A_SCREEN` (`workers/vf-ui/test/
index.test.ts`) — one per method+path `ap-setup.js` actually calls,
each proven reachable by a real fetch rather than assumed from the
pattern alone, the same discipline every earlier entry in that list
already follows.

**Nothing in `vf-app` or `vf-licence` changed.** This is a `vf-ui`-only
fix — the routes and the strings decision 0440 shipped were already
correct and are already confirmed live; only the proxy in front of them
needed to learn they exist.

## A second gap, found only by running the whole suite

Running `vf-ui`'s own full, unfiltered test command — the exact habit
this decision's own final section argues for — surfaced one more real
gap from decision 0440's own build, unrelated to the proxy: **`test-
browser/rules.test.ts`'s own "lists every screen" test never learned
about the new AP Setup nav item.** Its hand-maintained mock string
catalogue had no `nav.apsetup` entry, so the nav rendered with the raw,
untranslated key instead of "AP Setup," and the test's own expected
list of screen names never gained the new entry either — both silently
wrong in the exact same "second copy nobody was told to check" way this
whole project's documentation discipline exists to prevent. **Confirmed
test-only, not a live defect**: the real string catalogue
(`workers/vf-licence/migrations/0145_ap_setup_strings.sql`) already has
`nav.apsetup` in both locales, applied and confirmed live per decision
0440's own delivery — this was only ever the test's own fixture falling
behind the screen it exercises. Fixed with one new mock string and one
new line in the expected array, both placed to match `tasks.js`'s own
`NAV_GROUPS` order (directly after "Access"). Confirmed against `HEAD`
before touching anything, with a `git stash` of this decision's own
changes: the failure reproduces identically on decision 0440's own
already-delivered commit, so it predates this session's proxy fix and
is not something the proxy change caused.

## What was found next, after this deployed

The operator deployed and pushed this decision's own fix, then
reported back: *"deployed and pushed - but I get the same error?"*
Same wording, genuinely different cause — this session cannot sign in
to the live instance to reproduce directly (no credentials are entered
on the operator's behalf), so the operator's own browser console was
asked for instead. It showed the proxy fix had, in fact, worked: `GET
/api/org/overview` now returned `200`, and `GET /api/approval-config`
returned `500` — a real request reaching `vf-app`, not the `{"error":
"not found"}` a missing allowlist entry gives. `ap-setup.js`'s own
`load()` fails identically, with the same generic "AP Setup could not
be loaded" text, whether the underlying cause is a rejected fetch or a
server error — the two failures look the same on screen but are
opposite in cause.

`handleGetApprovalConfig`'s first query reads `org_approval_config`,
the singleton table decision 0439's own migration (`0075`) creates and
seeds with one row. That migration, and the route built on top of it,
are both covered by passing tests — so this was read as a live-database
question, not a code one, and put to the operator directly rather than
guessed at: a read-only check against the real database. It came back
unambiguous:

```
$ npx wrangler d1 execute vf-app-poc --remote --command \
    "SELECT mode, default_approver_user_id FROM org_approval_config WHERE id = 1"
✘ no such table: org_approval_config: SQLITE_ERROR
```

**Migration `0075` had never actually applied to `vf-app-poc`**, despite
being reported and recorded as confirmed live when decision 0439
itself shipped. Nothing in that record was dishonest — the operator's
own "pushed and deployed" at the time was true of the *code*; this
project has always kept applying a migration as a separate, deliberate,
operator-run step from deploying a worker (`apply_migrations.py
--remote`, never run by this session), and that one step was missed
for `0075` specifically. It is also the first time anything actually
exercised `org_approval_config` live — decision 0440's own screen never
got past the proxy rejection to reach it, so there was no earlier
chance for a missing table to surface.

**Fixed with no code change**: the operator ran
`migrations/apply_migrations.py --remote` (default database
`vf-app-poc`, the same one just queried), which applied `0075` — the
two override tables, `org_approval_config` itself, and its one seeded
row — and confirmed working immediately after: *"that worked - thank
you."*

## Tests

`workers/vf-ui/test/index.test.ts` — the six new `CALLED_BY_A_SCREEN`
entries all now pass (previously would have 404'd). Full `vf-ui`
plain-Worker suite: 74 tests, all green (unchanged in count — additions
landed inside an existing `it()`'s own list, not as new tests). Full
`vf-ui` browser suite, run standalone and via the package's own chained
`test` script alike: 973 tests, 969 green, 4 failed — all four inside
`test-browser/document-window.test.ts`'s own pre-existing, already-
documented flake (decision 0440's own delivery note; reproduced
identically on a clean stash of this session's changes, unrelated to
either fix here). `rules.test.ts`'s own "lists every screen" test,
which failed before this session's fix, now passes. `eslint .` clean
across the whole repo.

## What this changes about the delivery habit

**The repo's own `npm test` already runs both `vf-ui` suites** —
`workers/vf-ui/package.json`'s own `test` script is `vitest run &&
vitest run --config vitest.browser.config.ts`, and the root `npm test`
runs it via `--workspaces`. Decision 0440 was verified with hand-picked
`npx vitest run` commands per workspace instead — the browser config
explicitly, the plain one never — which is exactly how this slipped
through. **Run the package's own `test` script, not an ad-hoc
`vitest run`,** for any change that touches `vf-ui`: it is the one
command that cannot forget the second suite exists.
