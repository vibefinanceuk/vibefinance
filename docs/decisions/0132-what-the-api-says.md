# 0132 — The API returns codes, not sentences

**Status: built.** Every source operation reports an outcome code, and
the interface supplies the words.

---

## The message that prompted it

> "Nothing ever arrived through it and it had no address, so it is
> simply gone."

Asked to be made *"more professional"*, and it should be — but the tone
was the smaller of two problems.

**It was written in English inside the API and printed verbatim.** A
German customer read it in English, in an interface that has been
translated since decision 0107 and whose every label comes from D1.

I wrote all of these — in decisions 0126, 0128, 0129 and 0130 — *after*
building the translation system. The screen's labels went through `t()`
and the messages the screen displayed did not, because they arrived from
the server already worded.

---

## The tone was wrong too

*"So it is simply gone"* explains **our reasoning** where a person wants
**the outcome**.

Each message now states what happened, then why, in that order:

> Source deleted. Nothing had been received through it.

> Source retired. Invoices received through it retain its name, so the
> record is kept.

---

## Where the line falls

Decision 0113 settled a similar question for code lists with a test:
*is this wording ours to change?*

**These are ours.** So they belong in D1 with every other visible word,
and the API returns `reason: "never_used"` — a code that means the same
thing in every language.

The error field keeps its English string. **That is for a developer
reading a response**, not for a person reading a screen, and the two
have different readers.

---

## An unknown code says nothing

`outcome()` returns empty for a code it has no words for, so a caller
falls through to whatever else it has rather than printing
`outcome.something` at somebody.

That is a **deliberate departure** from `t()`, which renders a missing
key as the key precisely so it gets reported (decision 0107). The
difference: a missing *label* leaves a screen unusable and must be
noticed; a missing *outcome* leaves a screen working with one less
sentence.

---

## And then most of them stopped being shown

Decision 0134: **a message restating what the list shows is noise.** A
retired source shows *"Retired"* beside the address that kept it; a
deleted one is gone from the table.

So the screen speaks only about **refusals** — the case where somebody
pressed something and the screen looks exactly as it did. The outcome
codes still matter, because a refusal needs the same treatment and for
the same reason.

---

## What is not built

- **Only the sources screen.** Every other route still returns English
  prose in `detail`, and the keying route's own messages are the largest
  of them.
- **Nothing enforces the rule.** A test asserts these four responses
  carry no `detail`, and a new route can add one freely.
