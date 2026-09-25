# 0491 — The viewer's own feedback note scrolls into view

**Status: committed (`473c2f7`), never pushed or deployed — and now
superseded by decision 0492 before it ever shipped.**

> **Superseded by decision 0492.** Asked directly, immediately after
> this was delivered: *"Rather than show the message in a discrete
> part of the page, would it be possible to alert it in a pop-out
> alert message on the page, with OK as the only option to click and
> acknowledge the message"* — for every caller of `note()`, not just
> Reassign/Return. A pop-out requiring an explicit OK makes "scrolled
> into view" moot: there is nothing left off-screen to scroll to. The
> diagnosis below — what was reported, what was actually happening,
> why it is the shared function's problem rather than any one caller's
> — is unchanged and is what 0492 itself builds on; only the fix
> (`scrollIntoView` vs. a pop-out) is replaced, and it never reached
> production first.

---

## What was asked

Reported live: *"I've noticed that I cannot reassign an item, when it
is claimed by my user. however, when not claimed, the reassign pop-up
seems to work."*

## What was found

Reassign's backend logic checked out cleanly on inspection — there are
already passing tests for exactly this "own claim → reassign" scenario
at the direct-function, HTTP-route, and full-router levels. Rather than
guess further, the operator reproduced it live in a browser this
session could drive directly (the built-in browser pane, with the
operator signed in). The console showed no error at all when clicking
Reassign, which ruled out a thrown exception. The Network tab told the
real story: `GET /tasks/:id/reassign-candidates` fired and returned
`200 {"candidates":[]}` — a genuinely empty list, because the operator
is the only person on that team who holds the task's own required
permission, and `handleReassignCandidates` correctly excludes the
current claimant from their own candidate list (you cannot reassign a
task to yourself).

That is exactly the case `openReassignPicker` already handles: an empty
candidate list calls `note(t("action.reassign.nonefound"))` instead of
opening an empty picker. The message really was being set — `find`
against the live page located it verbatim, *"Nobody else on this team
can take this task."* But `#viewer-note` sits in `.c-note`, the very
last row of `.columns`'s own CSS grid (below Document, Parties, Header,
and Lines), and the operator was looking at the very top of the page,
where the topbar actions live. The note was real, correctly worded,
and completely invisible without scrolling — which reads exactly like
"the button does not respond," the words used to report it.

**Why this specific action surfaced it first.** `note()` is the shared
feedback mechanism behind several other things in the viewer too — Save
succeeding or failing, "nothing to save," a blocked pop-up window, and
the generic `viewer.actionfailed`. None of those had been reported
before because they are normally clicked after scrolling down to edit
a field, which tends to already have the page scrolled near where the
note lands. Reassign (and Return, decision 0490, which shares the exact
same failure mode via `action.return.nonefound`) are topbar actions,
reachable and clickable from the very top of a freshly opened task,
before any scrolling has happened at all — the one case this box's
fixed position was never actually tested against.

## What was decided

**Fix `note()` itself, once, for every caller — not a special case for
Reassign.** The failure mode belongs to the shared function, not to
this one caller of it, and every other caller shares the same risk
whenever a person hasn't scrolled yet. `note()` now calls
`box.scrollIntoView({ block: "center", behavior: "smooth" })` right
after setting the message, guaranteeing the feedback is visible
regardless of where the page happened to be scrolled when the action
ran.

**Guarded with `?.`, not called bare.** jsdom — this suite's own test
environment — does not implement `scrollIntoView` at all (confirmed
directly: `typeof el.scrollIntoView` is `"undefined"` there, not a
no-op stub). Calling it unguarded would have thrown inside every
existing test that calls `note()`, not just new ones — the optional
call keeps it silently doing nothing under jsdom and doing the real
thing in an actual browser, which is where the bug was actually
reported and reproduced.

**No backend change at all.** The reported behaviour — an empty
candidate list when the caller is the only qualified person on the
team — is correct: reassigning to yourself is not a thing this feature
should offer, and excluding the current claimant is deliberate,
existing, tested behaviour from decision 0489. This was purely a
visibility bug in the client.

## What was built

- **`workers/vf-ui/public/viewer.js`**: `note()` now scrolls
  `#viewer-note` into view (guarded with `?.` for jsdom) after setting
  its message, with a doc comment recording the live report, the
  reproduction, and why the fix lives in the shared function rather
  than in `openReassignPicker`/`openReturnPicker` individually.
- Tests: `workers/vf-ui/test-browser/viewer.test.ts` — the two existing
  "nobody eligible"/"no target configured" tests (Reassign's own from
  decision 0489, Return's own from decision 0490) each extended with a
  `scrollIntoView` spy stubbed onto the live `#viewer-note` element,
  asserting it is called exactly once when the note fires.

## What was not built

No change to any backend route, permission, or candidate-computation
logic — none of it was wrong. No change to `.c-note`'s own grid
position or to the note box's own styling; scrolling to it, rather than
moving it, keeps every other screen's layout unchanged.

## Verification

- `workers/vf-ui`: `viewer.test.ts` (browser) **219/219** (217
  pre-existing, 2 extended with a new assertion each — no new test
  count, since both cases already existed as regression coverage for
  decisions 0489/0490, just missing the visibility check). Full
  unfiltered browser suite (`vitest run --config
  vitest.browser.config.ts`, all 48 files) **1146/1147** — the 1
  remaining failure is `typography.test.ts`'s pre-existing, unrelated
  `app.css` finding, already confirmed present on an unmodified
  checkout in decision 0490's own verification.
  `node --check viewer.js`: clean. `npx eslint viewer.js
  test-browser/viewer.test.ts`: clean.
- **Reproduced live, not just inferred**: the operator's own browser
  pane, driven directly this session — before the fix, `find` located
  the correct "Nobody else on this team can take this task." message
  already present in the DOM but scrolled off-screen below Invoice
  Lines; the Network tab confirmed `GET .../reassign-candidates`
  returning `200 {"candidates":[]}`, matching `handleReassignCandidates`'s
  own documented, tested exclusion of the current claimant.

## Still to do, operator side

Push and deploy `vf-ui` (no new migration, no `vf-app`/`vf-licence`
change). Once live: reopen a task claimed by you where you are the only
qualified teammate, click Reassign, and confirm the "Nobody else on
this team can take this task" message now scrolls into view
immediately, without needing to scroll down manually.
