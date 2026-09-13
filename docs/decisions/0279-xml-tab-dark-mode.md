# 0279 — The XML tab was never this app's own page

**Status: built.**

---

## What was reported

> I've noticed that the XML tab view, is difficult to read, when the
> dark UI mode is applied.

## Why the app's own dark mode never reached it

The XML tab's `<iframe>` points directly at the signed document URL,
serving the original file as raw `application/xml`. A browser handed
that content type reaches for its own built-in XML viewer — a
genuinely separate document, rendered by the browser rather than this
app, styled for a light page by default. This app's own `data-mood`
CSS variables have no way to reach into it: it was never this app's
page to style in the first place.

## The fix

The route now recognises an XML content type specifically and returns
real HTML this app writes and controls — a `<pre>` on a dark
background, in the same colours (`#0d1626`, `#e8eef7`) used throughout
the rest of the interface — instead of handing the browser raw XML and
hoping its own viewer looks acceptable. Every other content type
(PDF, image, generated rendering) is served exactly as before,
unaffected.

**Deliberately not mood-aware.** The rest of the app tracks day and
night, but threading the viewer's current mood through the
token-minting flow for this one screen would be real plumbing for a
distinction nobody asked about — a code viewer conventionally keeps
its own consistent theme regardless of the page around it, and that
convention is what this follows.

**`white-space: pre-wrap`, not plain `pre`.** A real UBL invoice is
routinely one unbroken line with no formatting whitespace of its own —
visible in the operator's own screenshot, which the browser's native
viewer had already wrapped for exactly that reason. Preserving that
without truncating or reformatting keeps the fix scoped to what was
asked: readable colour, not added structure nobody requested.

## The real risk this touches, and how it was checked

An invoice's XML arrives from a supplier — an external, untrusted
source — and this change puts its raw content inside an HTML `<pre>`
element for the first time. Escaping is not incidental here; a
document containing `</pre><script>...` served unescaped would execute
arbitrary script in this app's own origin. Reused the exact reasoning
`peppol-render.ts`'s own `esc()` already states for the same underlying
risk, written again rather than imported — the two exist for genuinely
different purposes (rendering an invoice's fields vs. showing a raw
file's source) and sharing one dependency between them would be a
coupling neither actually needs.

**Proven, not assumed.** A dedicated test constructs exactly that
payload — a hostile document ending its own tags and opening a real
`<script>` block — and confirms the escaped output never contains the
literal break-out sequence. A second test checks the more easily
missed case: escaping `&` itself, so an already-escaped `&lt;` cannot
be mangled back into a live `<` by a later pass. Probed by removing
the escaping function's own body entirely and confirming three tests
fail, not by inspecting the code and trusting it.

vf-app: 1516 tests. No other Worker touched; no migration.
