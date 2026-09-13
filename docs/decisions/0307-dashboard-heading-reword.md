# 0307 — Dashboard's own title, a personalised subtitle, and a larger size

**Status: built.**

---

## What was asked

> Please can you change the heading / title at the top of the
> Dashboard page, which currently reads "My Work" to read "Dashboard".
> Beneath I would like the current text "What is waiting, and what is
> on the clock", to read "Items pending for my user - <username>".
> Replace <username> with the current user, such as 'Alice'. Please
> can you also increased the Font size of the Title (Dashboard) that
> we have just updated.

## What was built

`dash.heading` reworded from "My work" to "Dashboard"; `dash.sub`
became a template, `"Items pending for my user - {name}"`, filled at
render time — the same `{n}`/`{days}`-style placeholder convention
`suppliers.loaded` and `suppliers.loadedago` already use, rather than
a new pattern for this one string.

**Fetched independently, not reached for in `tasks.js`'s own `me`.**
`tasks.js` already tracks who is signed in, but keeps it in an
unexported module variable, and every screen in this app already
fetches its own data rather than reaching into another screen's
internal state. `dashboard.js` fetches `/api/whoami` itself, inside
`load()`, alongside its own cards.

**Best-effort, not a reason to fail the whole screen.** The fetch is
wrapped on its own, separately from the cards fetch that already
decides whether `load()` succeeds — the same reasoning `loadStrings()`
already gives a failed fetch: a screen with a blank name in its own
subtitle is better than no screen. A supplier's own dashboard failing
to load because `/api/whoami` briefly hiccuped would be a worse
failure than the one line missing a name for a moment.

**The larger title is scoped to this one screen**, not the shared
`.topbar h2` every screen's own heading uses. `.dashboardpage .topbar
h2 { font-size: var(--text-xl); }` — the next step up the same
four-step type scale `--text-lg` already belongs to, confirmed against
`typography.test.ts`'s own "no hardcoded sizes" rule rather than
picking an arbitrary pixel value that would have failed it.

## What has coverage

Three new tests: the heading and subtitle read correctly with a real
name filled in; the subtitle still renders, with the name simply
absent, when `/api/whoami` cannot be reached — proving the degradation
is graceful rather than assumed; and the Dashboard's own title rule
exists and carries `--text-xl` while the shared, every-screen rule
still carries `--text-lg` unchanged. Each probed directly: removing
the `{name}` interpolation, removing the fetch's own try/catch, and
removing the font-size override each fail exactly the test written to
catch it. The shared `stubDashboard()` test helper gained its own
`/api/whoami` stub so every existing test in the file exercises the
same, now-realistic fetch, rather than only the three new tests.

vf-ui: 49 Worker, 394 browser (was 391). vf-licence: 320. One
migration, rewording two existing strings in two locales.
