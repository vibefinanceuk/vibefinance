# 0183 — A task about one line

**Status: built.** A task says which invoice line it is about.
**Serial approval is not built** — see the end.

---

## Line-level approval, and eight rows that looked the same

> I want the ability to spawn multiple approval tasks.
>
> This was to handle serial line level approval.

**Most of it already existed.** Decision 0027 gave a stage an
`evaluation_scope` of `per_line`, so its rules fire once per invoice
line rather than once against the header. `assign_task` has carried the
line number through to the task ever since.

So an eight-line invoice already raises eight tasks. **The task list
never reported which line**, so they arrived as eight identical rows:
same supplier, same amount, same stage, nothing to tell them apart.

**Eight identical rows teach somebody the list is broken**, which is the
mirror of decision 0172's *"a column that never has a value teaches
somebody to ignore columns"*.

The line is reported now, in the list and in the viewer's heading —
because the viewer opens the **whole document** either way, and somebody
approving line three should not have to work out that it is line three.

**Null means the whole document**, which is what most tasks are.

---

## What "multiple approval tasks" turned out not to need

Decision 0074 removed `require_second_approval` on the grounds that
*"parallel approval is a workflow question"*. This is not that question:
**these tasks are not competing approvals of one thing, they are
approvals of different things.**

So none of the hard parts apply. There is no quorum, no first-past-the-
post, and no conflict between an approver who accepts and one who
rejects — each task owns its own line.

---

## And completing a task advances nothing

Worth stating plainly, because it surprised me while looking: `handleCompleteTask`
marks a task done and **does nothing to the stage**. Advancing is
`route_to`, fired by a rule.

That means eight line tasks can be completed in any order and the
invoice sits where it is until a rule moves it. Which is correct today
and is **not serial**.

---

## What is not built

- **Serial.** Eight lines produce eight tasks **at once**, all claimable
  in any order. If line two should wait for line one, nothing sequences
  them and nothing knows the order was intended.
- **Nothing advances when the last one is done.** A rule at the stage
  would have to test *"no open tasks remain"*, and no field says so.
- **The viewer shows the whole invoice**, with the line named in the
  heading and no emphasis on the line itself. Somebody approving line
  three reads a table of eight.
