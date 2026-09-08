# 0181 — Four lines that did not match

**Status: fixed.** The heading reads as one list.

---

## Set twice, and the later one won

> Same font, same weight, same size. They look different.

They did. `.topbar .sub` was declared **twice** in one stylesheet: once
by decision 0180 at `--text-sm`, to match the subhead, and once further
down at `--text-base`.

The second won, so `Unique Ref` sat a size above `Waiting` and `Owner`.

**The third name collision in a day** (decisions 0177, 0179 were the
others), and the same cause each time: a hand-written stylesheet where a
later rule quietly beats an earlier one and nothing says so.

One rule now, and a test refuses a second `font-size` on that selector.

---

## Labels that are also column headings

`Waiting` and `Owner` needed colons to match `Stage:` and `Unique Ref:`.

**But `tasks.waiting` and `tasks.owner` are column headings in the task
list**, where a trailing colon reads wrong. One key cannot be both a
label in a sentence and a heading over a column.

So the viewer has its own — `viewer.waitinglabel`, `viewer.ownerlabel` —
rather than a colon appended in code, which would put punctuation in a
screen whose words come from D1 (decision 0107).

---

## What is not built

- **Nothing prevents the next duplicate rule.** The test names this
  selector; the stylesheet is still hand-written and 1,000 lines long.
- **A team-owned task shows the team, not an address**, which is
  correct and is not what somebody expects when the task is waiting for
  them. Claiming it makes it theirs (decision 0180) — and nothing on
  this screen offers to.
