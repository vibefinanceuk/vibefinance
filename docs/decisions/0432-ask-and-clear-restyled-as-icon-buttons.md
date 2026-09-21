# 0432 — Ask and Clear, restyled as icon-above-label buttons

**Status: built, tested, documented. Not yet confirmed pushed and
deployed** — this session still has no push access to
`vibefinanceuk/vibefinance`; delivered as a git bundle for the
operator's own pull/push/deploy sequence, the same path decisions
0391, 0415–0431 already used.

---

## What was asked

*"Please can you change the Ask and Clear buttons to be Icons, similar
to other buttons on the page, with text beaneath."* — the operator's
own direct request, once decision 0431 shipped, was pushed, deployed,
and confirmed directly. "Talk to an AP Expert" (decision 0430) had
shipped its own Ask and Clear buttons as plain text buttons
(`class: "primary"` / `class: "secondary"`), the only pair on the
whole AP Analytics screen not built from `viewer.js`'s own
`actionLink()` — the icon-above-label stack decision 0122 built for
the document viewer's action row and decision 0234 exported so
Suppliers, and now every card-heading action across the app, could
reuse it rather than invent a second version.

## What was built

**No new components, no new strings — a straight reuse of an
existing, already-shared control.** `sendButtonEl`/`clearButtonEl`
(`workers/vf-ui/public/ap-assistant.js`) now build through
`actionLink(name, { primary, label, onclick })`, imported from
`viewer.js` alongside `POPOUT_NAME`, the same module this file already
imports from. `label` overrides `actionLink`'s own default
`action.<name>` text with the strings this screen already has —
`apassistant.send` ("Ask"/"Fragen", decision 0430) and
`apassistant.clear` ("Clear"/"Löschen", decision 0430's seventh
addendum) — the identical technique decision 0374 already uses for
Purchase Orders' own "Load CSV"/"CSV Template" over the generic
`action.load`/`action.download` text.

**No new icons drawn.** Two existing, already-true shapes reused
as-is:

- **Ask** uses `post`'s own paper plane (decision 0268, first built for
  the activity panel's own "send a comment" button) — asking a
  question is the identical send action, not a second shape for the
  same idea, and `icons.js`'s own comment updated to name the second
  caller.
- **Clear** uses `restoredefault`'s own curling arrow (decision 0303,
  first built for the dashboard's own "restore default arrangement"
  button) — clearing this chat *is* restoring it to its own default,
  empty state (this screen has never persisted history anywhere, this
  file's own top comment already says so), not undoing one question at
  a time. `icons.js`'s own comment updated the same way.

**Ask keeps the one dominant weight on the row** — `primary: true`,
the same `.actionlink.primary` treatment every other card-heading
action already uses to keep one action reading as *the* action
(decision 0108). Clear stays the plain, secondary weight.

**One CSS fix, not cosmetic on its own.** `.actionlink`'s icon-above-
label stack is taller than the plain text input it now sits beside;
`.chatinputrow`'s default `align-items: stretch` was pulling the input
up to match the buttons' own height. Fixed with `align-items:
flex-end` on `.chatinputrow` — the input keeps its natural size,
aligned to the buttons' own bottom edge.

**Disabled handling untouched.** `send()`/`clear()` still toggle
`sendButtonEl.disabled`/`clearButtonEl.disabled` directly — a real
`<button>` element either way, `actionLink()` or not, so nothing in
the sending-state logic needed to change.

## Tests

`test-browser/ap-analytics.test.ts` updated, no new file — this is a
styling change to an already-tested panel, not a new one.
"renders the empty state, a text input and a send button" gained two
assertions: the Ask button carries the `actionlink` class and contains
a real `<svg>`. "renders a Clear button next to Ask" gained three:
both buttons carry `actionlink`, both contain an `<svg>`, and only Ask
carries `primary`. Every existing assertion in this describe block —
`textContent` equalling "Ask"/"Clear", click handlers firing, the
disabled/re-enabled cycle — is unchanged and still passes, since
`actionLink()`'s own `<span>` carries the same visible text a plain
button's `text` option did.

**Suite state, full runs:** `vf-ui` browser 948 → **948** (no new
test file; six new assertions added inside two already-counted tests).
Every other suite — `vf-app`, `vf-licence`, `vf-ui` Worker — untouched
by this decision.

`eslint .` clean across `vf-ui`.

## What is not built

Nothing new is deferred by this decision — it restyles two buttons
that already existed and already worked, with no behavioural change to
sending, clearing, or the download buttons beside them
(`.chatactions`, decision 0430's seventh addendum, left untouched).
