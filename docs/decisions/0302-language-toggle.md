# 0302 — A language toggle, beside Night/Day and Sign out

**Status: built.**

---

## What was asked

> At the top of the page, between Night / Day, and Sign out, on each
> of the available screens, please can you add a Language button and
> icon, where English, or German can be selected. Use De, or En as
> the Icon perhaps. The selection should translate the page
> accordingly, of course.

## What already existed

This is not a new translation system — every string in this app
already carries an English and a German row (`ui_strings`, keyed by
locale), and `strings.js`'s own `loadStrings()` already fetches
whichever the browser asks for via `navigator.language`. The gap was
narrower than it looked: nothing let a person choose independently of
their own browser's language, and `vf-licence`'s own `resolveUiLocale`
already normalises both a bare `de` and a full `de-DE;q=0.9,...`
Accept-Language string to the same base code, so no backend change was
needed at all — only a way to ask for one explicitly, and somewhere to
remember having asked.

## What was built

**`vf-locale` in `localStorage`**, read once at `loadStrings()` time
and written the moment somebody picks a language, the exact shape
`mood.js`'s own `vf-mood` key already uses for the same kind of
choice. `null` still means "follow the browser," not "chose English" —
the distinction `mood.js` already draws between nobody having chosen
and somebody having chosen the default.

**`languagePicker()`, a toggle rather than a dropdown**, matching
`moodPicker`'s own shape (decision 0286's reasoning carries over
unchanged): two real, translated languages exist today, so a button
showing the current one and flipping it needs no menu. Offering more
than these two would have meant listing languages `vf-licence`'s own
`SUPPORTED` constant accepts but that have no actual rows behind them
yet — a selectable option that renders entirely in English regardless
of what was picked, which is worse than not offering it.

**A short-code badge stands in for the SVG `icon()` every other
topbar button uses** — the operator's own suggestion, since there is
no shape for "this is now in German" the way there is a sun for day
and a moon for night. Sized and weighted (`var(--text-sm)`, a 1px
border, 20×20px) to read at the same visual scale as the icons beside
it rather than sit as plain, undersized text.

**Native names, not translated ones** — the visible label reads
"English" or "Deutsch" regardless of which language the screen is
currently showing, since the entire point of a language picker is to
stay findable by someone who cannot read whatever language is
currently on screen, which a translated label would work against.

**A full reload, not a re-render in place.** Decision 0126 built no
router and no way, from outside a screen, to ask whichever one is
currently open to re-render itself — the same reasoning Sign Out
(decision 0283) already reloads rather than redraws. Every screen's
own `render()` calls `t()` throughout its own build, and a fresh
`loadStrings()` on the next load is the one place already guaranteed
to run before any of them do — reusing that rather than building a
second, narrower mechanism just for this.

**Wired into `topbar()` itself**, between `moodPicker(t)` and Sign
out, so it appears on every screen automatically the same way Sign
out itself does — no screen has to ask for it.

## What has coverage

Two existing, app-wide invariants — "every action has an icon," "no
action's own icon is left blank" — checked every `.actionlink` on the
page without exception, and genuinely broke against a button that, by
design, carries no `<svg>` at all. Both narrowed to a single, named
exception for the language toggle's own badge rather than loosened
generally, so a genuinely blank icon anywhere else on the page would
still fail exactly as before. A third, unrelated failure — a
hardcoded `10px` on the badge's own font size — was a real violation
of the "no size off the established scale" rule, not a test to work
around; fixed by using `var(--text-sm)` instead.

Five new tests: the button's own position between mood and sign out;
the default when nobody has chosen; that a stored choice survives a
fresh load; that clicking stores the other language; and that
`loadStrings()` genuinely requests the stored locale from the server,
not just that state was written somewhere. Each probed directly — a
wrong sort order, a hardcoded initial render, a `storedLocale()` that
always returns null, a missing `localStorage.setItem` in the click
handler, and a `loadStrings()` that ignores the override — each failed
exactly the test written to catch it, and only that one.

vf-ui: 49 Worker, 383 browser (was 378). No migration — the picker's
own labels are native language names, not translated strings.
