# 0348 — Real Pop-Outs, Not Native Browser Dialogs

**Status: built.** "I've noticed that the pop-up boxes for rename and
retire the source, appear to be cloudflare UI controls. Is that
avoidable, so that the UI appears like it is part of our site?"

---

## What was actually happening

Checked directly rather than assumed: neither dialog had anything to
do with Cloudflare, the hosting provider. `renameSource` called
`window.prompt`; `retireSource`'s own address-release confirmation
called `window.confirm` — both genuine, native browser dialogs, built
into the browser itself rather than drawn by this app. A native
dialog cannot be restyled by any CSS this project could write: the
browser always prepends the page's own origin to its own title bar
("app.vibefinance-ai.com says") as a trust measure, precisely so a
malicious site can never spoof a real system dialog — the same
property that makes it permanently look like it belongs to the
browser chrome, not the page.

## The fix

`openRenameSourceForm(source)` replaces `window.prompt` with the same
`.backdrop`/`.popout` shape every other write action in this app
already uses — Save and Close together in the header, the name
pre-filled, a real inline error (`sources.needname`, matching what an
empty name already said elsewhere on this screen) rather than
silently doing nothing the way the native prompt's own empty-string
case did.

`openReleaseAddressConfirm(source, emailAddress)` replaces
`window.confirm` the same way — the address still named directly in
the pop-out's own text, exactly as the native dialog's own message
did, since that reasoning (only a person can know whether the address
was already shared) has nothing to do with which UI asks the
question.

Nothing about *when* either dialog appears, what it asks, or what
happens on confirmation changed — only that a real, in-app element
draws it now instead of the browser itself.

## What has coverage

Two new tests, one per dialog, each stubbing the native `window`
method as a spy and confirming it is never called at all — not merely
that a pop-out also happens to appear alongside it. Both probed
directly: reintroducing the native call in each function failed
exactly the test built to catch it. Three existing tests needed
updating for the new flow: two ("asks, naming the address," "does
nothing when the answer is no") now interact with the pop-out
directly rather than stubbing `window.confirm`; one ("renders a
refusal in the reader's language") needed retargeting entirely, since
renaming now shows its own errors inline inside its own pop-out rather
than through the shared `sources-note` banner its own original version
checked — retargeted to Retire's own `!response.ok` branch, which
still speaks through that banner and still exercises the same
translation claim the test is actually about.

`vf-app`: unchanged (frontend-only). `vf-ui`: 63 Worker (unchanged),
506 browser (was 504).
