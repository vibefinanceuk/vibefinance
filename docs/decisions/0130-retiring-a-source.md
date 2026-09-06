# 0130 — Retiring a source, and where the form sits

**Status: built.** Rename and retire, and the create form beside the
list rather than below it.

---

## Delete was the wrong verb

Asked for as *"an edit and delete button"*. **Deleting a source is
usually wrong**, and the reason is not a foreign key — nothing
references a source by id at all.

**A document records the source's *name*.** `mandate.channel` is set
from `source.name` at capture (decision 0060), it is a field in the
closed vocabulary, and customers write rules against it: *"if
mandate.channel is 'AP Mailbox' then..."*.

So removing the row leaves three things broken:

- **Every invoice that arrived through it** carries a channel name
  nothing explains.
- **Rules reference that name** and go on referencing it — silently
  never firing, which decision 0113 records as the worst kind of rule
  failure because it looks correct in every listing.
- **An issued address** may be in a supplier's ERP. Deleting the source
  does not stop them sending.

The same reasoning as decision 0078: discarding a document archives it,
because a record saying somebody did something is worse than one saying
nothing.

### But deleting is right where it is harmless

A source **through which nothing ever arrived and which never had an
address** is somebody correcting a mistake, not changing history. That
one is simply gone, and the route decides which case it is rather than
asking.

The response says which happened, because **a person expecting deletion
should know why they got something else**.

---

## Renaming is refused, with the reason

Once a document has arrived, its `mandate.channel` is a copy of the old
name — so renaming leaves every past invoice citing one name while the
source claims another, and a rule written against either is right about
half the documents.

Once an address exists, the address is derived from the name and
**never reissued** (decision 0126), so the two would disagree
permanently.

Both refusals carry a `detail` saying *create a new source instead*.
**"You cannot rename this" without a reason is an instruction to
guess.**

---

## Two invariants on the retirement itself

A retired source **says when and by whom**, and an active one claims
neither.

One without the other is worse than neither: a retirement nobody can
date, or a date attributed to nobody, is a change to how a customer
receives invoices with no account of who made it.

---

## The form moved beside the list

The create form is three short fields; the list is the reason somebody
came. Giving each a full width wasted both.

**Retired sources are listed, not hidden.** Somebody looking at where
invoices arrive should see what stopped as well as what runs — and a
source that vanishes from a screen is indistinguishable from one that
was never there.

---

## What is not built

- **Un-retiring.** A source stopped by mistake stays stopped.
- **Nothing stops a retired source receiving.** The routing rule does
  not exist yet (decision 0126), so retirement is a statement of
  intent — and when the rule does exist, retiring must remove it or the
  status will be a lie.
- **`window.prompt` for the rename.** It works and looks like 1998. A
  proper inline edit is a small piece of work nobody has asked for.
- **No confirmation before retiring**, which decision 0122 already
  records as missing for the viewer's own irreversible actions.
