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

## Adding a language later, without a redesign

The framework's actual promise, and worth checking rather than
asserting. **A language is rows** — not a deployment, not a schema
change, not a code change.

**`GET /ui-strings/keys`** returns every key with its translations and,
more usefully, its **gaps**:

```json
{ "key": "action.claim",
  "values": { "en": "Claim", "de": "Übernehmen" },
  "missing": ["fr", "es", "it", "nl"] }
```

Plus coverage per language. Without this the only way to see the full
set is to read a seed migration, which makes the framework usable only
by somebody with the source in front of them.

**`POST /ui-strings`** takes a whole language at once. Translating a
`PUT` at a time is tedious enough that nobody would, which would make
the framework theoretical.

**All or nothing.** A partial write leaves a language half applied with
no way to tell which half, and a caller resubmitting would not know what
to resend. Watched to fail: dropping the English-first check lets an
invented key through and writes it.

**A half-translated language works immediately** — French for what
exists, English for the rest — which is what makes adding one
incremental rather than a project.

### The one thing that would need a change

A **seventh** language beyond the six means editing the `CHECK`
constraint and `SUPPORTED`. Deliberate rather than accidental: offering
a language the API cannot answer in (decision 0008) would be worse than
offering neither.

---

## A key nothing defines renders as itself, and did

**Reported from a live screen:** the line table's headers read
`field.bt-129` and `field.bt-131`.

Not a naming problem. `t()` falls back to the key when a string is
missing — deliberately, because *"a screen reading a dotted key is
obviously broken and somebody reports it, where a blank looks like a
data problem and gets lived with."* **The fallback worked exactly as
designed, and the operator was the person reporting it.**

What was missing is a check that the words a screen asks for are words
somebody wrote. Decisions 0109 and 0110 added line fields to the viewer
and seeded labels for five of the seven.

`string-coverage.test.ts` now refuses any key the interface uses and
nothing defines, naming it:

> Used by the interface and defined nowhere: `field.bt-129`. Seed it in
> a migration, or stop asking for it.

Modelled on `field-coverage.test.ts` in `shared`, which refuses a
declared vocabulary field the parser cannot produce. **Same principle,
a different pair of layers.** It also refuses a label that *is* its own
key, which would pass the first check while reading as broken.

The list of keys is **maintained by hand rather than scraped**. A
scraper would have to parse `t(\`field.${code}\`)` and every other
computed key, and would quietly stop finding them the first time
somebody built a key a slightly different way. A list fails loudly.

> **The hand was the weakness, and it showed.** Reported from a live
> screen a second time: `field.bt-34`, `field.bt-27`, `field.bt-49` and
> others reading as dotted keys. **Nineteen** labels were missing, not
> the eight visible — the rest are hidden by default and would have
> appeared the moment somebody configured them.
>
> Decisions 0110, 0112 and 0114 each added fields, and nobody added
> them to the list. A check maintained by hand is a check that decays
> at exactly the rate the thing it guards grows.
>
> **The field labels are now derived from the vocabulary**, which is
> the one place that knows every field. A field cannot be declared
> without a label being demanded for it, and decision 0114 makes that
> matter more: any declared field can reach a screen the moment a
> customer configures it, so "the fields the viewer shows today" was
> always the wrong set to check.
>
> The rest of the keys stay listed by hand, because nothing enumerates
> them. That part of the trade still holds.

### And the words themselves

The specification's own business term names, in the form somebody keying
an invoice would use: EN 16931 calls BT-129 *"Invoiced quantity"* and
BT-131 *"Invoice line net amount"*, shortened only where a table column
has no room. **A code is what a rule references; a name is what a person
reads.**

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
