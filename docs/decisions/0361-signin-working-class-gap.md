# 0361 — The Same Bug, in the One Place Decision 0360 Didn't Look

**Status: built.** Reported live, after decision 0360 was deployed:
"If I click refresh, it launches full screen - however, the initial
load is narrow."

---

## What decision 0360 got wrong

Decision 0360 reasoned that `boot.js` was "the one place that already
knows, for certain, whether the app is showing" and moved the
`body.working` toggle there. That was false: `signin.js` calls
`start()` directly too, on its own "just signed in" path, entirely
without going through `boot.js`. It toggles `signin-view` and `shell`
itself and never touched `body` at all — the exact same omission
decision 0360 had just fixed for `boot.js`, sitting in a second place
nobody had looked yet.

This produced precisely the report: a page load or a refresh goes
through `boot.js`, correctly gets the class, and shows full width. The
moment right after typing credentials and signing in goes through
`signin.js`'s own path instead, never gets the class, and shows
narrow — until the next refresh, which finally reaches `boot.js` and
fixes it retroactively for that session.

## Fix

Rather than patch `signin.js` as a second, separate instance of the
same fix — repeating the mistake that caused this — the toggle moved
into `start()` itself, in `tasks.js`. `start()` is the one function
genuinely common to both callers, and the one place that already
knows, unconditionally, the exact moment it is about to return
successfully: right before its own `return true`. Both `boot.js` and
`signin.js` already gate showing the shell on `start()`'s return
value, so this closes the whole class of bug rather than the one
instance of it a second time — a third caller, if one is ever written,
gets this behaviour automatically rather than needing to remember it.
`boot.js`'s own, now-redundant toggle was removed rather than left as
a confusing duplicate.

## What has coverage

`signin.test.ts` had never once exercised a real, successful sign-in
— every existing test there stopped at the `my-environments` step
that runs on a password field's own blur, never submitting the form
at all. A new test drives the real `submit` event through to a
successful `start()` and confirms `body.working` is set the same way
a page load already proves in `boot.test.ts`. Probed directly:
reverting the fix in `start()` fails all three tests at once — the
Dashboard path, the Tasks-fallback path, and this sign-in path — the
single point where all three now genuinely converge.

`vf-ui`: 69 Worker (unchanged), 541 browser (was 540, +1: the new
sign-in test). `vf-app` and `vf-licence` untouched.
