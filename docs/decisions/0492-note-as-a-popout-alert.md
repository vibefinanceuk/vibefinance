# 0492 — The viewer's own feedback note, as a pop-out alert

**Status: built and verified locally, not yet committed/pushed at the
time of writing.** No push access from this session — delivered as a
git bundle, per this repo's own established handover mechanism.

**Supersedes decision 0491**, committed (`473c2f7`) but never pushed
or deployed, before it ever shipped. See `SUPERSEDED.md` and 0491's own
first lines.

---

## What was asked

Immediately after 0491 was delivered — the fix that scrolled `#viewer-
note` into view so a topbar action's feedback message could not land
off-screen — the operator asked for something different in its place:

> Rather than show the message in a discrete part of the page, would
> it be possible to alert it in a pop-out alert message on the page,
> with OK as the only option to click and acknowledge the message.

Asked whether that should cover only the two messages actually reported
(Reassign/Return's "nothing available") or every message `note()`
shows, the answer was direct:

> Every message this note() function shows.

That is all nine call sites: the generic `viewer.actionfailed`, a
blocked pop-up window, "nothing to save," Save succeeding, Save
failing, and the two "nothing available" messages for Reassign and
Return.

## What was decided

**One shared function, one new behaviour, for every caller — the same
principle 0491 itself argued for its own fix.** `note()` no longer
writes into a persistent box at the bottom of the page. It builds a
fresh `.backdrop`/`.popout` alert — the same structural pieces
`openReassignPicker`/`openReturnPicker` already use — containing the
message and a single button, and appends it to `document.body`.

**OK is the only way to dismiss it.** Unlike the Reassign/Return
pickers, the alert's backdrop has no click-outside-to-close handler —
deliberately, per the request. The button reuses the `done` checkmark
icon (already documented in `icons.js` as right for "a person
confirming 'this is settled'") and a new label, `action.ok` ("OK").

**This makes 0491's own fix moot, not wrong.** `scrollIntoView` existed
to guarantee a message set into a box below everything else on the
page was actually seen. A pop-out that sits in front of everything and
blocks until acknowledged has nothing left to scroll to — the failure
mode 0491 fixed cannot occur here at all. The `scrollIntoView` call,
its jsdom guard, and the two spy-based tests that checked it are all
removed.

**The message keeps `id="viewer-note"`.** Every existing test that
asserts `document.getElementById("viewer-note")?.textContent` — the
pop-up-blocked test, and others across the suite — keeps working
unchanged, because the id moves with the message rather than staying
on a box that no longer exists. The old persistent
`<div class="problem" id="viewer-note">` inside `.c-note` is removed
from the render function entirely, so there is never a second element
sharing that id.

**No new CSS.** `.backdrop` and `.popout` already exist and are already
used the same way by the two pickers; `.statebuttons` is already used
standalone (AP Setup's add-row form). The four `grid-template-areas`
blocks in `app.css` that still name a `"note"` row are left as they
are — an unfilled named grid area contributes no row height, so they
are inert rather than wrong, and touching four separately-documented
layout blocks for a row nothing draws into any more was judged out of
scope for a request about behaviour, not layout.

## What was found while scoping it

- `note()` is never called to clear or reset a message — there is no
  `note("")` anywhere in the codebase — so there is no "hide it again"
  semantic to preserve; every call is set-and-show, which a fresh
  pop-out per call satisfies exactly.
- `save()` is always called as `save(null)` from its own single call
  site (`actionLink("save", { onclick: () => save(null), primary:
  true })`), so the `if (close) close();` branch after `note(t(
  "viewer.saved"))` never runs today. No race between an async close
  and the new pop-out was possible to introduce.
- Searching the test suite for every existing assertion that could be
  affected (`viewer-note`, `viewer.saved`, `viewer.savefailed`,
  `viewer.nothing`, `viewer.popupblocked`, the two `nonefound` keys)
  turned up exactly three test locations: the pop-up-blocked test, and
  the two `scrollIntoView`-spy tests from 0491. No test independently
  checks Save's own success/failure text or "nothing to save" against
  `#viewer-note`, so only those three needed rewriting.

## What was built

- **`workers/vf-ui/public/viewer.js`**: `note()` rewritten to build a
  `.popout` (message + a single `done`-icon OK button in
  `.statebuttons`) inside a `.backdrop`, appended fresh to
  `document.body` on every call, with no outside-click dismissal. The
  old persistent `#viewer-note` placeholder div removed from the
  render function's `columnsEl` structure. Doc comment records what
  was asked, the explicit "every message" scope, why this supersedes
  0491 rather than sitting beside it, and the duplicate-id hazard the
  removal avoids.
- **`workers/vf-licence/migrations/0171_note_ok_string.sql`**: the one
  new string, `action.ok` = "OK" (en/de), wired into
  `workers/vf-licence/test/setup.ts` and
  `test/string-coverage.test.ts`'s hand-maintained key list.
- **Tests**: `workers/vf-ui/test-browser/viewer.test.ts` —
  - `"action.ok": "OK"` added to the STRINGS fixture.
  - The pop-up-blocked test extended to also assert a `.popout`
    appears, that clicking the backdrop itself does not dismiss it,
    and that clicking OK does.
  - Both `scrollIntoView`-spy tests (Reassign's "nobody eligible,"
    Return's "no target configured") rewritten: the spy and its
    assertions removed; each now asserts a `.popout` **does** appear
    (the opposite of what it asserted under 0491, since the empty-
    candidate/empty-target path never opens the picker itself — only
    the alert), carries the correct message, and is dismissed by its
    own OK click.
- **`docs/decisions/0491-viewer-note-scrolled-into-view.md`**: marked
  superseded in its own first lines, per this repo's own convention
  (`SUPERSEDED.md`).
- **`docs/decisions/SUPERSEDED.md`**: new row recording 0491 → 0492.

## What was not built

No change to any backend route or to the layout CSS beyond what was
already there. No focus management on the OK button beyond the
browser's own default (no existing pop-out in this codebase does
this either, so adding it here would be new scope, not parity). The
now-unreachable `"note"` grid-template-area rows in `app.css` are
left in place, as described above.

## Verification

- `node --check public/viewer.js`: clean. `npx eslint public/viewer.js
  test-browser/viewer.test.ts`: clean.
- `workers/vf-ui`: `viewer.test.ts` (browser) **219/219**. Full
  unfiltered browser suite (`vitest run --config
  vitest.browser.config.ts`, all 48 files) **1146/1147** — the 1
  remaining failure is `typography.test.ts`'s pre-existing, unrelated
  `app.css` finding, the same one already present on an unmodified
  checkout (confirmed again this session via `git stash`).
- `workers/vf-licence`: `string-coverage.test.ts` **10/10**; full
  suite **320/320**.

## Still to do, operator side

Push and deploy both `vf-ui` and `vf-licence` (this decision adds a new
migration, `0171_note_ok_string.sql` — apply it before or with the
deploy, same as any other string-only migration). Once live: trigger
any of `note()`'s callers (Reassign or Return with nobody eligible is
the easiest to reproduce) and confirm a pop-out alert appears with the
message and a single OK button, and that OK is the only way to close
it.
