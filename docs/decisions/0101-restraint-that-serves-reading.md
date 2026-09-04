# 0101 — Restraint in service of legibility

**Status: built.** CSS and markup only, no new assets.

---

## The brief, and its second half

*"Design minimalism, like Apple, but not."*

The **"but not"** is the operative part. Apple's minimalism is
aspirational — air, very few elements, the product as object. This is a
tool somebody uses all day doing careful work, so the same restraint has
to make the work **easier to read** rather than make the page look
expensive.

Fewer things on screen, but the things that remain dense and legible
rather than sparse and beautiful.

---

## What was wrong with the first version

Not decoration — there was none. **Composition.**

The card floated mid-field, every gap was the same size, and the
heading, the fields and the button all carried equal weight. It read as
one undifferentiated list of six things.

---

## Three changes, no new assets

**Vertical rhythm that groups.** A label sits close to its field and far
from the next pair — roughly a one-to-four ratio. The eye then reads
three pairs rather than six items. This is the change that does most of
the work and is the least visible.

**One element leading.** The heading steps up, everything else steps
down from it. Before, nothing led.

**No card.** A border and panel make the form an object floating on a
surface. Letting it sit in space is more confident — and only works once
the composition holds it together, which is why it is third rather than
first.

Plus one wash of the brand colour behind the page: a single radial
gradient, **not a background image**. An external image would make a
customer's login page depend on a third party, which is an availability
question on the authentication path and a data-protection one in a
finance product.

---

## Two details that are judgement, not polish

**Only the border moves on focus.** A shifting shadow or a size change
makes a form feel unsteady under the hands.

**A mistyped password is not an emergency.** The message is text in the
warning colour rather than a red panel; treating an ordinary event as an
alarm is how people learn to ignore alarms.

---

## `--brand-name` was a token nothing consumed

The first screenshot showed it plainly: the bar turned blue and the
heading still read **VibeFinance**.

The colours apply themselves because CSS variables do. The name does
not — something has to read it and write it into the page. **A declared
value nothing reads** is the pattern this project has found nine times
in code, and it turns out to happen in CSS too.

Now read after the branding stylesheet loads, since the variable does
not exist until it has, and written with `textContent` because the value
comes from an API.

---

## And a test that passed for the wrong reason

`/tokens.css` was asserted to serve the stylesheet. **Static assets are
not served in the test environment** — every request reaches the Worker
and takes the fallback, which returns `index.html`.

That page happened to contain `--brand-bar` in its own styles, so the
assertion passed. Changing that one variable to `--brand-fill` made it
fail and revealed the test had never checked what it claimed.

The fifth instance today of a check pointing somewhere that did not
answer the question asked of it. The test now asserts only what it can
see, and says why.

---

## Also fixed

- **The environment selector is disabled until it has options.** A
  dropdown reading "Sign in to choose" that can be opened is an
  invitation to do nothing.
- **A single instance is selected automatically.** Making somebody
  choose from a list of one is a step that exists only because a list
  exists.

---

## Not addressed

- **A customer backdrop** — cityscapes or similar. Attractive, and it
  has a real constraint: the login screen does not know the customer
  until *after* the password is verified, so anything customer-specific
  can only appear at the moment the environment list populates. Generic,
  then suddenly Frankfurt, is odd choreography. Keying on the URL would
  fix it and depends on the custom-domain decision.
- **The signed-in state.** The confirmation appears below a form still
  full of the person's details, because there is nowhere to go yet.
  Honest, and it looks like nothing happened.
