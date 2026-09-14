# 0313 — Which orgs a person belongs to, and a switch to focus on one

**Status: built. Not yet a filter — read the last section before relying on it.**

---

## What was asked

> I think the user permissions need to be tied to an Org / Legal
> entity, but they might require different approval limits and access
> rights. There are some things that need to be considered, such as,
> the ability for a user to switch between Orgs, and an interface to
> view, assign and manage user role allocation.

Investigated before building anything, since much of this turned out
to already exist. A role assignment can already be scoped to a
specific org unit rather than granted everywhere (decision 0199);
delegated administration already refuses to let somebody grant a role
wider than their own scope (decision 0201); what a person is shown is
already filtered to units they hold a role in (decision 0202), and
claiming is bounded the same way (decision 0203). Approval limits
exist as a table with no enforcement behind it at all — decision 0184
was designed and never built. And nothing anywhere exposes which
units a person belongs to, so no UI could offer a choice between them.

Chosen as the starting point, confirmed directly: an explicit switch —
pick one org, see only that org's work until switching — rather than
today's implicit union of everywhere a person holds a role.

## What was built

**`unitsFor()`**, in `enforce.ts` — which orgs a person is entitled to
focus on. Units held directly, plus, if at least one role is held
"everywhere" (`unit_id IS NULL`, decision 0199's own default for every
assignment predating it), every real unit in the system — a person
entitled to everything has something meaningful to focus on in any of
it, not just the units they were individually, directly assigned.
Directly-held units sort first, ahead of the rest of the catalogue.

**`/api/whoami`** now returns `units` and `holdsEverywhere` alongside
the existing permissions list — the one gap that made any switcher
impossible: the frontend cannot offer a choice it has no way to know
exists.

**`orgPicker()`**, a new module, `orgs.js` — a topbar control matching
`moodPicker`'s own shape in spirit but not its mechanism: a pop-out
list rather than a two-state toggle, since an org list can genuinely
be long where mood only ever has two states. Reuses the existing
`.backdrop`/`.popout`/`.searchresult` pattern the viewer's own
supplier search already established, rather than inventing a second
list-picker. Offers no control at all with fewer than two units to
switch between — decision 0161's own "nothing to do" argument. Builds
its own DOM with a small, local helper rather than importing `el()`
from `tasks.js`, the same circular-import reasoning `mood.js` and
`strings.js` already state for themselves, since `tasks.js` is what
imports this module.

The choice is remembered in `localStorage`, the same shape `mood.js`
and the language toggle already use, and wired into every screen's
own topbar automatically, between the mood toggle and Language.

**A real bug, found before it shipped.** The button's own default
label read "All organisations" regardless of whether that was actually
an offered choice — naming a focus a person without an everywhere-held
role could not actually pick from the very list the same button opens.
Fixed to fall back to the first directly-held unit when nothing is
held everywhere, caught by writing the test for the `holdsEverywhere:
false` case directly rather than only testing the common path.

**A second, unrelated but real bug, found the same way.** Adding a new
browser module without registering it in `vitest.browser.config.ts`'s
own alias map caused `tasks.js` itself to fail to resolve — and since
nearly every other screen imports from `tasks.js`, that one missing
line cascaded into 335 failures across files with nothing to do with
orgs at all. Diagnosed by reading one specific failure's own error
message rather than guessing from the pattern, which named the exact
missing alias directly.

## What has coverage

`unitsFor()` has five tests: nobody with no roles returns nothing;
somebody with only a direct assignment gets exactly that unit and
`holdsEverywhere: false`; somebody holding a role everywhere gets
every real unit; directly-held units sort first; a unit held both
directly and via an everywhere role is not listed twice. Each probed
directly against the specific branch or line it tests.

The switcher itself has four tests: no control with fewer than two
units; the default label and position between mood and Language;
picking an org persists it and updates the label; "All organisations"
only appears when a role is genuinely held everywhere. Each probed
directly — disabling the two-unit guard, the persistence call, and the
`holdsEverywhere` condition each fail exactly the test written to
catch it.

vf-app: 1474 tests (unchanged file count, `whoami.test.ts` grew by
five). vf-ui: 49 Worker, 403 browser (was 399). One migration, four new
strings in two locales.

## What is not built, and this matters

**The choice does not filter anything.** No screen reads `currentOrgId()`
to narrow what it shows; `hasPermission()`'s own `unitId` parameter is
still passed from wherever each call site already derives it, not from
this new choice. The picker is fully functional and its own choice is
genuinely remembered — but choosing an org today changes only the
button's own label. Wiring the chosen org into what the app actually
shows is the next, separate piece.

**Approval limits remain unscoped and unenforced.** `org_authority_limits`
still has no `unit_id`, and decision 0184's own approval logic was
never built. "Different approval limits per org" needs both a schema
change and real enforcement, neither touched here.

**There is still no UI to view, assign, or manage role allocation.**
`handleCreateUnit`, `handleCreateUser`, `handleCreateRole`,
`handleAssignRole`, and `handleSetAuthorityLimit` all exist and work —
reachable only as raw API calls, with nothing built on top of them.
