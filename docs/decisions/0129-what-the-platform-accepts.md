# 0129 — What the platform will accept

**Status: built.** Three real limits, found by a question.

---

## The question

> Do we not have to limit the user in part to a naming convention that
> relates to the Cloudflare platform and instance?

**The characters were never the problem** — decision 0126's slug already
produced `[a-z0-9-]`, which a mail system and a URL both carry. Three
other things were.

---

## A name with no letters produces no address

`!!!` slugs to nothing, and the address becomes
**`.acme@vibefinance.com`** — a leading dot, which is not an address.

A source would have been created that could never receive an invoice,
and nothing would have said so.

---

## And a long one exceeds RFC 5321

The local part is capped at **64 characters**, which Cloudflare
enforces. An 80-character name produced an 85-character local part.

---

## Accents were being destroyed, not folded

*"Rechnungen für Köln"* became **`rechnungen-f-r-k-ln`**.

Every non-ASCII letter was replaced by a hyphen, so a German source name
came out unreadable. **The interface is translated (decision 0107)
precisely so those customers exist**, and their source names were being
mangled by the code that makes their addresses.

Normalising to NFD and dropping the combining marks folds `ü` to `u`
rather than removing it, and `ß` is spelled `ss` the way German spells
it when it must. **`rechnungen-fur-koln`** and **`grosskunden`**.

Watched to fail: removing the fold breaks it.

---

## Said while somebody is still typing

The screen shows **the identifier a name will become**, updating as they
type. A name becomes a URL and an address, and somebody should see that
before it is permanent rather than discover it afterwards.

It also refuses both bad cases **before posting anything**, so nobody
creates a source that cannot be given an address.

**The server checks the same things.** The screen is the courtesy, not
the guard — and the slug function exists in both places, which is two
copies of one rule and a real risk. The alternative is a round trip to
preview an identifier on every keystroke, which is worse.

---

## What is not built

- **A source cannot be renamed**, so a name refused at address time
  means creating another source. The error says *"rename the source"*
  and nothing can.
- **Nothing checks the two slug functions agree.** They are eight lines
  each and identical today.
- **The customer id is not validated.** It comes from provisioning
  rather than from a person, and a customer id with no ASCII letters
  would produce the same broken address from the other side.
