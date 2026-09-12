# 0270 — Hidden was true; the pane still showed

**Status: fixed.** A real, live-reported bug in decision 0269's own
tab implementation.

---

## Reported live

> the timeline appears under the document image, and also within the
> Timeline / Chat tab. It need only appear in the Timeline / Chat tab

## Why every test for this had already passed

`el()`'s children pattern set `.hidden` as a genuine DOM property in
`documentPanel()`, and every test written for decision 0269 checked
exactly that property — correctly, and it was correctly `true`.

**`display: flex` on `.activitytabcontent` overrode it anyway.** The
browser's own default styling hides an element with `[hidden]` by
setting `display: none` — but that is a low-priority rule, and any
other rule that sets `display` on the same element beats it once
present. `.activitytabcontent { display: flex; flex-direction: column }`,
added for the pane's own internal layout, did exactly that: the
property was `true`, the attribute was present, and the element still
rendered, because nothing in that stylesheet said it shouldn't.

**Nothing in this app's test suite could have caught this by checking
the property.** jsdom, which every browser test here runs against,
never applies real CSS — `element.hidden` reads back exactly what was
set regardless of what the real page would show. The gap needed a
test that read the actual shipped stylesheet's text, the same pattern
already established for the exact same class of problem (decision
0257's stacking test, 0261's margin fix).

## The fix

`.activitytabcontent[hidden] { display: none; }` — a rule scoped to
the same element, with higher specificity than the bare class rule,
restoring the browser's own intent rather than fighting the layout
rule that broke it. `docContent`, the Document pane, was never at risk
the same way: it carries no class of its own, so nothing there
overrides its default hidden behaviour.

A new test reads the stylesheet's own text for this rule directly,
rather than asserting a DOM property a passing test had already
proven correct without proving anything real. Probed: removing the
rule from `index.html` fails it.

vf-ui: 49 Worker, 310 browser.
