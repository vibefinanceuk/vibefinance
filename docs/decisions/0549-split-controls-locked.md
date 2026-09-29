# 0549 — Split coding's shares and switches were locked for everyone

**Status: built and tested locally, not yet pushed or deployed.** This
session has no push access, so it is delivered as a git bundle. It
touches `vf-ui` only (`viewer.js`); no migration.

## What was reported

After deploying 0548, the operator split a line and found that "the
percentage split field cannot be changed manually and the field is
locked", and that "By %" could not be changed to "By amount".

## What was found

The viewer's `el()` helper (`tasks.js`) writes every property it is given
as an attribute. 0548 passed `disabled: canSplit ? undefined : "disabled"`,
so an editable split got `disabled="undefined"`. Any `disabled` attribute
disables a control, whatever its value. Three controls were affected, for
every user and at every stage:

- the share or amount inputs;
- the By % | By amount switch;
- each row's Cost centre | Project switch.

The pickers, "+ Add a split", "Stop splitting" and "Put it on the last
row" carried no such property, which is why those worked.

0548's tests missed it because they called the inputs' handlers directly
rather than typing, and never clicked the switches. Every other screen
already uses the right pattern (`...(locked ? { disabled: "disabled" } : {})`);
only 0548's new code did not.

## What was decided

- The three controls now carry `disabled` only when the split is read-only.
- The tests now type into the inputs with a real `input` event, after
  checking that they are enabled.
- A new test finds no split control carrying `disabled` where coding is
  editable. It clicks By amount, types two amounts that balance, and turns
  a row to Project.
- Another new test checks that the shares are read-only where coding is
  not editable.

## Verification

- `vf-ui` `viewer.test.ts`: with the previous `viewer.js`, the three tests
  that type or click **failed** (the new one included); with the fix, all
  10 split tests pass, and the whole file passes 291/291.
