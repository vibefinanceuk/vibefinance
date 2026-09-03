# 0064 — What happens after a task completes

**Status: findings, nothing built.** Records three gaps found by reading
the workflow engine while designing the stage rail. All three are real;
none is fixed here.

---

## 1. Multiple tasks per stage already work

Worth stating first, because it is the part that behaves as expected.

`visitCurrentStage` blocks the instance the moment any task is created —
it stays at that stage rather than advancing. `onTaskCompleted` counts
open tasks **for the stage visit**, and only advances when the count
reaches zero. Several tasks in one stage therefore all have to complete,
and the last one to finish releases the instance.

Keying to `stage_visit_id` rather than to the instance is what makes
this correct on a revisit: a document returning to Approval gets a second
visit with its own tasks, and completing the first visit's tasks cannot
release the second.

---

## 2. `require_second_approval` is declared and does nothing

The fifth instance of this pattern, after `'warned'` (0040),
`validation.passed` (0044), `extraction.confidence` (0054) and
`set_field` (0049).

It is the worst of the five. A customer writing *"invoices over 10,000
require a second approval"* gets a rule that compiles, passes the
activation gate, fires on the right invoices, and has no effect
whatsoever. The rule looks correct in every listing.

### It is not merely unwired

A second **approval** is not a second **task**. Two tasks assigned to the
same team can both be claimed by the same person — nothing stops one
approver completing both, which defeats the entire purpose.

A real second approval requires the second approver to be a **different
person** from the first, and possibly senior to them. Tasks currently
carry an owner and a permission, and no relationship to each other, so
implementing this needs:

- a task to know it is a second approval **of** another task, and
- the completion check to refuse the same `completed_by`.

That is a schema addition, not wiring. Which is probably why it was
never done — and exactly the reason it should either be built or removed
from the vocabulary rather than left declaring an intention.

> **The interim is expressible.** Two `assign_task` actions on one rule,
> or two rules firing in `all_matches`, produce two tasks on one stage
> visit and the instance waits for both. That gives a
> two-people-must-act flow without the same-person guarantee.

---

## 3. A task cannot complete negatively

Completion is completion. There is no way for a task to complete with an
outcome, so someone who reviews the coding and thinks it wrong has no way
to say so through the task — they complete it and the instance advances.

The objection has to travel some other way: a rule at the next stage, or
a conversation nobody downstream is required to read.

---

## 4. Advancement after tasks is sequence-only

The consequence that makes point 3 harder to work around.

`onTaskCompleted` advances by `nextStageInSequence`. **It does not
evaluate rules**, so `route_to` cannot fire at that moment — meaning
nothing can redirect an instance once it has been released by task
completion. The only exit from a task-blocked stage is forward, in
sequence.

Send-back therefore does not exist in any form. Not because a task lacks
an outcome field, but because the moment a task completes is the one
moment no rule gets to run.

### What the function does instead, and why it is honest

```
if (next.rule_set_id) {
  // Stop here — this stage needs real facts to evaluate, which
  // this function deliberately never has.
  return;
}
```

`onTaskCompleted` knows it cannot evaluate rules without facts and stops
rather than pretending. That is the right call: guessing at facts, or
evaluating against an empty set, would produce wrong outcomes silently.

But it means an instance advanced onto a **rule-bearing stage sits
there** until something calls `visitCurrentStage` with facts. There is a
manual route (`POST /process-instances/:id/visit`), so the instance is
not stuck — but nothing advances it automatically, and nothing tells
anyone it is waiting.

---

## 5. What would fix it

Not proposed as work, only as the shape of the answer.

**The parked-instance problem** needs whatever releases a task to be
able to load the subject's facts. `onTaskCompleted` is deliberately
subject-agnostic, matching the engine's standing position that it never
assumes how to load facts for a `subject_type` — so the caller would
supply them, exactly as `visitCurrentStage` already requires.

**Send-back** needs a task outcome, and then a rule able to test it. If
the completing caller supplied facts, a re-evaluation could route on
something like `task.outcome`, and `route_to` would work at that point
because rules would run.

**The second approver** needs tasks to relate to one another, which is
independent of the other two.

---

## 6. Why this is recorded now

The stage rail (`docs/design/operator-interface.md` section 6) makes all
three visible. A rail showing "1 of 2 tasks" and "held here until both
are done" invites the question of what happens when the second finishes,
and the answer turned out to be more limited than expected.

Finding it by drawing the interface rather than by hitting it in
production is the cheapest way this could have gone.
