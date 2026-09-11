# 0223 — A token nothing defines

**Status: fixed.** The pop-out has a background, and the card holds its
own contents.

---

## Transparent is not an error

```css
background: var(--bg-panel);
```

**`--bg-panel` does not exist**, and neither does `--bg-hover`. I
invented both in decision 0222's stylesheet, and CSS does what it always
does with an undefined variable: **nothing.**

So the pop-out rendered as a box with no background at all, every word
of the page behind it showing through — which the operator saw and no
test did.

**Nothing failed and nothing logged.** No type checker, no linter and
two hundred and twenty-six tests, none of which look at a colour.

### The real name was three characters away

Every panel in the app uses `--surface-2`, defined on `:root` in
`tokens.css` along with `--surface-0` and `--surface-1`. **I did not
look**, and invented a name that sounded right.

---

## And a column that would not shrink

```css
grid-template-columns: 1fr auto;
```

**`auto` sizes a track to its content and refuses to go below it.** The
address block held *United Kingdom of Great Britain and Northern
Ireland* — ISO 3166's own name for `GB`, which decision 0221 chose
deliberately — and the column pushed it straight out through the side of
the card.

**`minmax(0, 1fr)` is what says otherwise**, and it is needed on the
inner row too: an email has no spaces to break at, so the value track
would widen rather than wrap. `overflow-wrap: anywhere` handles the
rest.

---

## Two tests, and one of them I nearly wrote wrong

**The token test reads both stylesheets as text** and asserts that every
`var(--x)` in the page is defined in one of them. **Watched to fail** by
putting `--bg-panel` back.

It took three attempts. The first read files with `node:fs` — which
`workerd` has no filesystem for, exactly as decision 0215 found. The
second imported `tokens.css?raw` and got an **empty string**, because
vite processes a CSS import regardless — *"a test that checks nothing
and passes"*, which is the worst shape available.

**A virtual module already existed** for this, used by two other tests.
I found it by looking rather than by inventing, which is the lesson of
the whole record twice over.
