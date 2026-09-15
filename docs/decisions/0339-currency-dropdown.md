# 0339 — A Closed Set of Currencies for Approval and Spend Limits

**Status: built.** "Please can you make the currency box in the
person properties a drop down of value CCY values for approval and
spend limits?" Checked first: nothing in this project fixes a
currency vocabulary anywhere else — an invoice's own currency (BT-5)
is deliberately free text, since a real supplier can arrive in any
real-world currency and constraining that would refuse legitimate
documents. An approval or spend limit is a different case: a person's
own administrator is choosing it directly, not reading it off an
incoming document, so a short, closed list a mistyped code can never
slip through is the safer default here — the two fields are related
but not the same question.

---

## The list, and why

`CHF, EUR, GBP, USD` — EUR, GBP, and USD are already what every worked
example, seed row, and test fixture in this project already uses;
CHF added as the one further major currency a customer already
operating across France, Germany, and the UK is likely to need next.
This is a real, stated assumption, not a researched requirement — a
genuinely different scope, a fifth currency or removing one, is its
own, later decision.

## Where it applies

Both fields it was asked for — the Properties pop-out's own approval-
limit and spend-limit currency — and, for consistency, the same two
fields on the New Person form, which sets both at the same moment it
creates the person. Leaving one form a closed dropdown and the other
free text would have meant the one place a mistyped currency code
could still slip through was also the very first time it was ever
entered.

One shared function, `currencyPicker`, used in all four places rather
than four separate option lists that could quietly drift apart from
each other over time.

## What has coverage

Two existing tests broke because they queried `.editgrid input` or
`.memberpickerrow input` specifically, no longer finding a currency
field that is now a `<select>` — fixed by querying the right element,
not by weakening what either test checks. Two new tests confirm the
closed set itself, in the Properties pop-out and on the New Person
form, each checking both the approval-limit and spend-limit fields
independently. Probed directly: truncating the shared list to a
single currency failed exactly both new tests.

`vf-app`: unchanged (frontend-only). `vf-ui`: 63 Worker (unchanged),
498 browser (was 496).
