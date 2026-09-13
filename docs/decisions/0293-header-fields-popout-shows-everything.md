# 0293 — "All invoice header fields" now genuinely means all of them

**Status: built.**

---

## What was reported

> I'm a bit confused with the latest change - we seem to only show 3
> fields in the pop-out

Checked directly rather than assumed: with the operator's own earlier
screenshot as reference, decision 0292's "overflow only" filtering was
working exactly as built — Business process, Specification, and Total
without VAT were precisely the three fields not already on the
curated card. Explained back, and the operator's own follow-up named
the actual mismatch:

> I had thought that the pop-out would show fields on the card, and
> any additional fields not shown on the card... Hence the pop-out
> title — "All invoice header fields."

Decision 0292 solved a real duplicate-id risk by narrowing what the
pop-out showed. The fix was correct; the title never changed to match
it, and "All invoice header fields" showing nine-tenths of them was
always going to read as broken rather than intentional.

## The fix

The pop-out shows every field configured for the stage again, exactly
matching its own title. What changed is how a field already on the
card renders inside it: forced read-only, under its own `hf-${field}`
id rather than the card's own `f-${field}` — the card already holds
the one real, editable copy, and a second editable one here, even
genuinely distinct in the DOM, would be an input `save()` never reads
from, since that looks for `f-${field}` specifically and nothing else.
An edit typed into a second copy would look accepted and then silently
not exist. Read-only says correctly that this is the same value a
second time, not a second place to change it. Only fields the card
doesn't already show render as their own, real, editable copies — the
same behaviour decision 0292 built, now correctly scoped to the fields
it was actually meant for.

**`field()` gained two small, optional parameters** rather than a
second, parallel rendering function: `options.id` to render under a
different DOM id, and `options.forceReadOnly` to render as text
regardless of the field's own visibility. Both default to the
existing behaviour, so every other call site — the Seller card's own
unmatched-state fields, the curated summary itself — is unchanged.

## What has coverage

Two new tests, one rewritten. The pop-out lists every configured
field, including the genuine overflow and everything already on the
card, matching its own title. A field already on the card renders in
the pop-out as read-only text under its own distinct id, while the
card's own copy stays a real, editable input — probed directly by
reverting the fix and confirming this specific test, and no other,
fails. One bug caught in the new test itself before trusting it: its
first version opened the viewer with a field set that had no overflow
at all, meaning "Header Fields" never rendered and the test failed for
the wrong reason (nothing to click) rather than the one it was meant
to check.

vf-ui: 49 Worker, 365 browser. No migration.
