# 0282 — A checkbox was never a text box

**Status: built.**

---

## What was reported

> In the Documents page, the check boxes appear very large and
> cumbersome.

## The real cause

`tokens.css` sets the appearance of every form control with a bare
`input` selector — `background`, `border`, `border-radius`, `padding`,
then a second rule adding `min-height: 32px`, `width: 100%`,
`box-sizing: border-box`. Written for text-like inputs, and correct
for them: decision 0124's own reasoning for `min-height: 32px` and
`width: 100%` is exactly right for a box somebody types into.

**A bare `input` selector matches a checkbox exactly as it matches a
text box.** `<input type="checkbox">` in the Documents column picker
inherited the same 32px-tall, full-width, padded, bordered appearance
built for prose — a checkbox rendered as a giant blue square is what
that produces, matching the screenshot precisely.

## Where it was checked, not just where it was fixed

Searched the whole app for every checkbox before touching anything:
exactly one, in the Documents column picker. The fix excludes
`[type="checkbox"]` and `[type="radio"]` from both rules in `tokens.css`
— the second even though nothing uses it today, the same "add now,
unused, clearly flagged" precedent this project already applies
elsewhere, so the same bug cannot reappear the day a radio button
does.

**The sign-in form's own, separate `input, select` rule got the same
treatment**, even though nothing on that form is a checkbox today —
the next field added to it should not have to rediscover why one
would look wrong.

## A deliberate size, not whatever was left over

Excluding the checkbox from the global rules doesn't give it a size —
it gives it back to the browser, which renders a bare checkbox
differently on every platform. `.columnlist input[type="checkbox"]`
now sets an explicit 14px, sized against the `--text-sm` label it sits
beside, the same discipline this app's type scale already applies
everywhere else rather than leaving an appearance to chance.

## What broke while proving this, and what it taught

**The first version of the regression test was wrong, and its own
probe caught it.** Counting occurrences of the bare string
`:not([type="checkbox"])` in the stylesheet also counted this very
record's own explanatory comment, which names that exact string while
describing the fix — inflating the count and letting a probe that
removed one of the two real rules pass anyway. Rewritten to search for
`input:not([type="checkbox"])` specifically, which the comment's prose
never happens to contain, and reprobed to confirm removing either real
rule's exclusion now fails the test.

**A second, unrelated existing test broke for a real reason**, found
by running the full suite rather than trusting the new test alone: a
typography test located the same rule by its exact old selector text
(`"input,\ntextarea,\nbutton,\nselect {"`), which no longer exists
verbatim once the exclusion was added. Updated to the new selector
text rather than loosened — the test still proves the same thing, on
the rule as it actually reads now.

vf-ui: 49 Worker, 336 browser. No migration.
