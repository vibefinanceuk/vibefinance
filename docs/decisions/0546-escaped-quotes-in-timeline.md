# 0546 — Literal "‘" in the Timeline's rule entries

**Status: built and tested locally, not yet pushed or deployed.** This
session has no push access, so it is delivered as a git bundle. It
touches `vf-licence` only and needs **`vf-licence` migration `0201`**;
no deploy of `vf-app` or `vf-ui` is needed.

## What was asked

The operator noticed that every rule entry in the Timeline read, for
example, "Business rule ‘Standard rule: Purchase order on hold or
closed’ fired: assigned to AP Matching (lines 1, 2)", and asked
for the `‘`/`’` to go.

## What was found

Migration `0078` (decision 0267) wrote the curly quotes as JavaScript
escapes. SQL has no such escape, so the six characters `‘` were
stored literally and shown as they are. Three strings were affected:
`activity.rulefired` in English and German, and the German
`activity.internalonly` (`—` for a dash). The screen's own tests
never saw it, because their fixtures wrote the same text in JavaScript,
where the escape does become the character.

## What was decided

- **Migration `0201`** rewrites the three strings with the real
  characters: "Business rule ‘…’ fired", "Geschäftsregel „…“
  ausgelöst", "Nur intern — für …". The existing Timeline entries are
  put together from this string when shown, so they read correctly
  too; nothing stored with the events needs changing.
- **A guard test** (`ui-strings.test.ts`) checks every stored string
  for a literal `\uXXXX`, `\n` or `\t`, so the next migration that does
  this fails in tests rather than on the live screen.

## Verification

- `vf-licence` `ui-strings.test.ts` (2 new): no escape sequences in any
  stored string; the rule-fired line in English and German with real
  quotes. Without migration `0201` both **failed**, and the first named
  exactly the three strings above.
- Migration `0201`'s assertion checked on a replay of `0078` + `0201`.
- `vf-licence` 322/322. No escaped Unicode found in `vf-app`, `vf-ui`
  or `shared` source.
