# 0121 — Testing the browser code

**Status: built.** A second suite, in a DOM, for the code no test had
ever executed.

---

## What was not being tested

`vf-ui` had **43 tests and none of them ran `public/*.js`.** They cover
the Worker: routing, proxying, cookies, the markup it serves.

`vitest-pool-workers` runs in `workerd`, which has no `document`. So the
Task Manager's rendering, the viewer's fields, the code pickers, the
read-only rendering, the exceptions panel and the field highlighting
were **outside anything the suite could see.**

### Four bugs found by looking at a screen

- The keying form came back empty after a save, because it built its
  values from the task list's five-field summary (0120).
- Keyed lines never reappeared, for the same reason.
- The exceptions panel showed nothing after saving, because the route
  dropped `involves` (0119).
- The panel then read *"Nothing to resolve"* on a failing document,
  because it filled only on save (0119).

**Every one is logic, not layout.** That decided the runner.

---

## `jsdom`, not a browser

Playwright tests what actually happens — layout, real `fetch`, real
paint. It also needs a browser binary and a running server, which makes
it an **integration** test rather than a unit one.

Every defect above would have been caught by `jsdom`, which needs
neither. Playwright remains worth having for what `jsdom` cannot see —
that the panel is fixed height and scrolls, that a highlight is visible
— and it is a separate decision.

---

## A second config, not a second environment

The pool decides where a test runs and cannot be overridden per file, so
`vitest.browser.config.ts` sits beside the existing one and `npm test`
runs both.

**Two details that cost time and are worth recording.**

`publicDir: false`. Vite copies `public/` verbatim and **refuses to
import from it** — right for a build, wrong here, because `public/` is
exactly the code under test. Turned off rather than moving the files,
since where they live is what Cloudflare serves.

**And the Worker config needed an `include`.** Without one, vitest's
default glob picked up `test-browser/` and tried to load DOM code in
`workerd`. That fails as a *file*, not as a test — so the summary still
read `43 passed` with one file failing above it. **A suite can grow a
hole and still report a round number.**

---

## The imports are aliased, not rewritten

The browser modules import each other by absolute path —
`import { t } from "/strings.js"` — because that is what a browser
resolves against the server root.

Aliased in the test config. **Rewriting them to relative paths for the
tests' benefit would make the tested code differ from the shipped
code**, which is the exact failure this exists to close.

---

## Every test corresponds to a bug that escaped

Ten tests, and each maps to something somebody found by using the
screen. That is deliberate: **a new test layer earns its place by
catching what already got out**, not by covering what never broke.

Both bugs were reintroduced to check. Removing the stored facts breaks
one test; removing the verdict on arrival breaks four.

`fetch` is stubbed **per URL**, so a test that forgets an endpoint fails
loudly rather than receiving an empty object and quietly proving
nothing.

---

## What is still not tested

- **Anything visual.** Fixed height, scrolling, whether a highlight can
  actually be seen. `jsdom` has no layout.
- **The Task Manager screen**, the sign-in screen, and `boot.js`. Only
  the viewer has tests, because that is where the bugs were.
- **The real network.** Every response here is a stub, so a change in
  what the API returns will not fail these — which is what the route
  tests in `vf-app` are for, and why decision 0119's gap needed both.
