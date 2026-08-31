# 0020 — URL path decoding

Status: settled, 31 August 2026. A real bug caught live, in the exact
kind of moment this whole project's discipline is built for: a
compiler-generated value ("AP team," containing a space) broke every
dynamic route in `index.ts` that matched on it, and it was found by
actually trying it against the deployed system rather than in review.

## The bug

`URL.pathname` preserves percent-encoding rather than decoding it —
`/org/teams/AP%20team/members` has a `.pathname` of literally
`/org/teams/AP%20team/members`, not `/org/teams/AP team/members`.
Every dynamic path segment captured via regex throughout `index.ts`
(team ids, task ids, process ids, rule ids, and more — eleven call
sites in total) was passed to its handler function raw, still
percent-encoded, with `decodeURIComponent` never called anywhere in
the file. Nothing in this codebase's own tests had ever exercised an
id containing a character that needs encoding — every id chosen for
testing this whole session was already URL-safe by construction — so
the gap sat invisible until a real, live compile produced a team name
with a space in it and a real request to add that team's member
failed with `"team AP%20team does not exist"`.

## The fix: decode once, at the root, not at each of eleven call sites

`pathname` is decoded exactly once, immediately after `url` is
constructed, and used for every subsequent comparison and regex match
in the file — both the exact-string route checks (`pathname ===
"/rules/evaluate"`) and the dynamic capture groups. This fixes the
root cause once rather than patching eleven individual call sites and
risking a twelfth, future one repeating the same mistake. A malformed
percent-encoding (a lone `%` not followed by two valid hex digits, for
instance) makes `decodeURIComponent` throw; this is caught and refused
with a clean `400`, not left to surface as an unhandled exception and
a raw `500`.

Proven both directions, the same discipline as every other bundle
this session: a new test creates a team with an id containing a space,
adds a member to it through a real, percent-encoded URL, and confirms
it works — then the fix was deliberately reverted and the exact same
test was confirmed to fail with a `404`, reproducing precisely the
error hit live, before the fix was restored. A second test confirms
the malformed-percent-encoding guard returns a clean `400`.

## Why this wasn't caught earlier

Every id used in every test written this whole session — team ids,
process ids, stage ids, task ids — was chosen as a simple, already
URL-safe string (`"team1"`, `"ap-live"`, `"s1"`). Nothing in the test
suite ever exercised an id containing a space or another
percent-encoded character, so this bug was invisible to over 290
passing tests across every prior bundle. It only became visible
because a *real* compiled rule, produced by the compiler rather than
hand-written by a test author, happened to name a team with a space in
it — "AP team," not "ap-team." Worth recording plainly: hand-picked
test data can systematically avoid exercising a real class of input
that a live, AI-generated value will eventually produce.

## What's still open

- No further audit was done of whether any *other* string handled by
  this codebase assumes URL-safety without checking — this fix
  addresses path segments specifically, the class of value that broke
  live.
