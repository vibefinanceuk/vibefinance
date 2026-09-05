# 0107 — The interface's words

**Status: built.** Every visible string in `vf-ui` comes from the
control plane, by key, in the person's own language.

---

## What was wrong

Every string in the interface was an English literal: *"Sign out"*,
*"Not yet keyed"*, *"Save keyed values"*. None could be translated
without editing the source.

**And this project already had translation.** `vf-app` carries
`src/i18n.ts` and decision 0008 — six languages, falling back to English
rather than erroring. The server could speak German and the screen could
not, which is a divergence of exactly the kind these records keep
finding.

---

## In D1, not a bundled file

The operator's instruction, and it holds up: **a translation shipped in
the JavaScript means a UI deployment to fix a wording error or add a
language**, and both are things somebody who does not deploy should be
able to do.

---

## In the control plane, for the same reason branding is

The login screen needs its words **before an instance has been chosen**,
so an instance cannot be the source (decision 0096 made the identical
argument for a livery).

That gives a symmetry worth noticing: `vf-ui` is one shared deployment,
and everything it needs before knowing which customer it serves —
colours and words — comes from `vf-licence`.

---

## The locale comes from the browser, and it had to

Decision 0008 is explicit that locale is *"a per-deployment setting, not
per-request"*, because one Worker serves one customer whose integration
operates in one language.

**That reasoning does not carry to `vf-ui`**, which is one deployment
serving everybody. So the language comes from the person —
`navigator.language`, with `Accept-Language` as the server-side
fallback.

The one rule that *does* carry over unchanged: an unrecognised or absent
locale is **English, never an error**.

---

## Falling back per key, not per language

A partially translated locale shows what it has and English for the
rest.

The alternative — collapsing to English because one string is missing —
would mean adding a single new key untranslates an entire language until
somebody catches up. A test asserts a new English-only key appears in a
German response alongside the German ones.

### And English must be complete

A standing invariant refuses a translation with no English sibling, and
`handleSetUiString` refuses it with a reason.

**This is the one that matters.** The fallback is only as good as
English being complete: a German string with no English sibling breaks
the fallback for everybody who is *not* German. Watched to fail.

---

## A missing key renders as the key

`t("tasks.notkeyed")` returns `tasks.notkeyed` when the string is
absent, rather than an empty string.

**A screen reading `tasks.notkeyed` is obviously broken and somebody
reports it.** A screen with a blank where a word should be looks like a
data problem and gets lived with.

Same reasoning for readable keys — `tasks.claim` rather than `t42`. A
key nobody can read is one somebody eventually inlines the English
beside "for clarity", and then there are two sources of the word.

---

## Words load before anything renders

`boot.js` fetches them first. Rendering in English and swapping would be
a visible flicker in whichever language the person does *not* read —
the same reasoning that hides both views until the page knows which to
show (decision 0103).

---

## What is not built

- **Four of the six languages.** English is complete and German is
  seeded to prove the mechanism carries more than one — a scheme tested
  only in its fallback is a scheme that has never been used. French,
  Spanish, Italian and Dutch are rows nobody has written.
- **Per-customer overrides.** A customer calling an invoice a *bill*
  would need a layer keyed by customer, like branding. The table is
  keyed by locale alone.
- **Dates, numbers and currencies.** Formatted by the browser's own
  locale rather than by this. That is usually right and is not the same
  decision.
- **The sign-in screen's markup.** Its labels are still literals in
  `index.html`; only the scripted screens are keyed. The strings exist
  for it.
