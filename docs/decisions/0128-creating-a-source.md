# 0128 — Creating a source from the screen

**Status: built.** The configuration screen creates sources, not just
lists them.

---

## What was missing, and why I said otherwise

Decision 0126 built a screen that listed sources and gave an address to
an email one. Decision 0127 made the create route reachable by a
signed-in person — and I said that made creating a source possible from
the screen.

**It did not.** The route accepted a session; the screen had no form.
Reported immediately: *"should I see a create source option?"*

A route being reachable and a screen calling it are different things,
which is the same distinction decision 0119 turned on when the
validation panel rendered and nothing filled it.

---

## Processes could be created and never listed

A source belongs to a process, so the form has to offer them — and there
was **no route to list processes**. Fine while a person creating a
source already knew the id; **offering a free-text box for an id
somebody has to remember is not a configuration screen.**

The list carries a **stage count**, because a process with no stages
accepts documents and does nothing with them. Worth seeing before
pointing a source at one, and the screen marks it.

---

## The form asks for no identifier

A source needs an `id`, and the screen derives it from the name.

**A person configuring where their invoices arrive should not be
inventing identifiers**, and every id this screen creates is one nobody
will ever type again — the API needs it, and the person does not.

The same reasoning as the address in decision 0126: generated, because
asking would be asking somebody to solve a problem that is ours.

---

## Two small things the screen says plainly

**Mechanisms are named in words.** `file_import` is a column value;
*"File import"* is what a person reads — the same distinction decision
0119 drew for `vat_arithmetic`.

**No process, no form.** Rather than offering one that cannot succeed,
the panel says *"a source belongs to a process, and none exists yet."*

And the form sits **below** the list, because somebody arrives to look
at what exists far more often than to add to it, and a form at the top
makes every visit start with a blank box.

---

## One test had to be narrowed

*"Asks for nothing when creating one"* asserted the screen contained no
`input` at all — true until this, and it was really a claim about the
**address** button.

Now scoped to that button. **A test that was right for an accidental
reason is a test that fails for an accidental reason**, and the fix is
to say what it actually meant.

---

## What is not built

- **Deleting or renaming a source.** Once created, it is permanent from
  the screen.
- **Creating a process**, which is still `curl` — so the form is
  offerable only where somebody has already made one.
- **The `default_org_unit_id`** decision 0111 added. The form does not
  set it, so a source created here places nothing.
