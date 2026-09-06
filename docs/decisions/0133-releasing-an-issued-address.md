# 0133 — Releasing an issued address

**Status: built.** Deletion refused by default, with an explicit
confirmation that names what would be released.

---

## The question

> So if an email address was issued, the record cannot be deleted?

Correct, under decision 0130 — and **the reasoning was weaker than the
other case.**

An address may sit in a supplier's ERP, so deleting the source does not
stop them sending. True. But **if nothing ever arrived, nobody was
necessarily told the address.** It was *reserved*, not *published* —
which is exactly the mistake-correction case 0130 allowed for a source
with no address.

**The real distinction is whether the address was ever given out, and
nothing records that.** We know it was issued; we do not know if a
supplier saw it.

---

## Only a person can know

So the server refuses and asks, rather than guessing either way.

`DELETE /sources/:id` returns **`confirm_required`** with the address
itself; `?releaseAddress=true` proceeds. A query parameter rather than a
body, because `DELETE` with a body is carried inconsistently by proxies
and **this must not be one of the things that silently does nothing** —
decision 0131 having just been that.

### The question names the address

*"An address will be released"* is not something anybody can check.
`ap-mailbox.acme@vibefinance.com` is.

A person is then deciding about a specific address they can recognise,
rather than agreeing to something abstract.

---

## Confirmation does not override history

A source that documents arrived through is still **retired**, confirmed
or not.

The address is the only thing a person can vouch for. A document already
citing this source's name in `mandate.channel` is not, and no
confirmation makes it so.

---

## And the address is freed

The point of releasing it: a name refused as taken works once the source
holding it is gone. A test asserts exactly that round trip — create,
release, recreate with the same name.

---

## What is not built

- **Nothing records whether an address was shared.** That is the fact
  this whole decision works around. A *"published"* flag set when
  somebody copies the address, or a note field, would let the system
  answer instead of asking.
- **`window.confirm`.** It works, blocks the page, and looks like 1998
  — the same note decision 0130 made about the rename prompt.
- **No confirmation anywhere else.** Retiring a source that documents
  arrived through is irreversible and asks nothing, and decision 0122
  records the same for the viewer's own destructive actions.
