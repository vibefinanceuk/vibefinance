# 0641: Absence and cover

**Status: built and tested locally, not yet pushed or deployed.** It
touches `vf-app`, `vf-ui` and `vf-licence`. It needs **vf-app migration
`0138`** and **vf-licence migration `0285`** (strings). Deploy vf-licence,
then vf-app and vf-ui.

## What was asked

Phase 3, slice 3 (0631's build order) was *away and cover*. Dan, asked
whether to build it as the phase 3 write-up described it:

> *"A user should be able to mark themselves as Absent, stating start and
> return periods. An AP Manager should be able to review all users in
> their team and also cancel or amend an entry. An absence should be able
> to reassign owned items to an alternate user."*

**This replaces the write-up's version, in which an agent prepared each
move for approval.** The person, or their AP Manager, arranging the
absence is the approval: their tasks pass to the cover on the first day
away. No agent and no separate approval step are needed.

## What was built

### An absence (vf-app migration `0138`, `absence.ts`)

- **`absences`** records:
  - the person;
  - the first day away and the day they are back (`starts_on <= today <
    returns_on`, in the organisation's time zone);
  - who covers;
  - whether their tasks pass to the cover, and whether what is still
    open comes back on return (both on by default);
  - a note;
  - who arranged it, amended it or cancelled it, and when.
- **Checked before saving:**
  - dates in order, and not starting in the past;
  - the cover shares a team with the person or is their manager;
  - the cover is not away themselves at the time;
  - the person has no other absence overlapping it;
  - a cover is named if tasks are to pass.
- **Who may arrange one:**
  - **The person themselves**: anyone signed in, for themselves.
  - **An AP Manager, for their team.** That is everyone who shares a team
    with them, or reports to them (`manager_id`). They see their team's
    absences, now and to come, and may arrange, amend or cancel one.
  - Nobody else.

### The tasks (the five-minute tick, and at once when an absence starts today)

**Passed while away.** Every open task the person holds passes to the
cover: a claim on a team's task (`claimed_by`), or a task named to them
(`owner_user_id`). New ones are passed as they arrive. Each move is
race-safe: it happens only if the task is still theirs.

**Only what the cover may do.** The cover needs:

- the task's permission where the invoice is;
- for an approval, an approval limit at least the invoice's total
  (`resolveApprovalLimit`, 0009 and 0334).

Anything else stays with the person, and the screen says why: *"1
stayed: above Ben's approval limit in GBP"*, or *"Ben does not hold
AP.Review there"*.

**Handed back on return**, once. What was passed and is still open with
the cover goes back to the person. What the cover finished or passed on
stays where it is.

**Amending and cancelling:**

- Changing the cover while the person is away hands back the old
  cover's share, then passes everything to the new one.
- Cancelling hands back at once.

**On the Timeline.** Each move is a `reassign` (decision 0489) by whoever
arranged the absence, to the cover, with the reason as its comment:
*"Away 2026-10-05 until 2026-10-08: passed to cover"*, or *"… back:
handed back"*. `task_action_events` needed no change.

`absence_moves` keeps what was passed, kept and handed back, and why.

### Routes

- `GET /absences`: one's own absences, and the team's for an AP Manager,
  with:
  - their states (planned, away now, back, cancelled);
  - what became of their tasks;
  - whom each person may have as cover;
  - whom one covers for today.
- `POST /absences`, `PATCH /absences/:id` and
  `POST /absences/:id/cancel`. vf-ui passes all of them through.

### The Absence screen (vf-ui `absence.js`)

- **In the menu**, last under Accounts payable, for anyone who works tasks
  (AP.TaskView) and AP Managers. It has its own colour, so no other
  screen's changes (0527).
- **I will be away:**
  - first day away;
  - back on;
  - who covers (only those allowed);
  - *pass open tasks to the cover*;
  - *hand back what is still open on return*;
  - a note.
- **My absences** and, for an AP Manager, **My team**, each showing:
  - when;
  - a state pill;
  - the cover;
  - what became of the tasks;
  - **Amend** and **Cancel absence** while it can still change.
- An AP Manager can arrange an absence **for someone in their team**.
- **"You are covering for Uma until Thu 8 Oct"** when someone's tasks are
  with you.
- **Help** for the screen, and every word in English and German
  (vf-licence `0285`).

## Not built

- **Telling the cover by email when tasks arrive.** The Absence screen
  and their task list say it for now.
- **Absences in the Workload view.**

## Verification

- **`vf-app`** `absences.test.ts`, 5 tests:
  - Uma away from today with Ben covering. Her claimed coding task and
    small approval go to Ben. The large approval (over his limit) and the
    review (a permission he lacks) stay, each with its reason. Ben is
    told he covers; the Timeline says who passed what;
  - a new task passed as it arrives. On her return, two come back and the
    one Ben finished stays; it happens only once;
  - a planned absence waits for its first day. Tasks can be kept, with no
    cover;
  - refused:
    - starting in the past;
    - the day back not after the first day;
    - a cover outside the team;
    - no cover named while tasks are to pass;
    - arranged by someone who is not her AP Manager;
    - a cover who is away;
    - an overlapping absence;
  - Maya, the AP Manager, arranges Uma's absence and sees it under her
    team. Pat sees nothing and may not cancel it. Moving the cover to
    Cara hands Ben's share back and passes all four to Cara. Cancelling
    hands everything back. An absence that is over cannot be amended.
- **`vf-ui`** browser `absence.test.ts`, 3 tests:
  - the menu item, and no team panel for someone who is not a manager;
  - marking oneself away with a cover, and the refusal in words;
  - a manager's team with what became of the tasks, being a cover, and
    cancelling.

  Separately, the navigation tests now include Absence. The worker test
  covers the four paths.
- **Full runs**:
  - vf-app 3605, of which 3603 pass (the two known failures);
  - vf-ui browser 1558, of which 1557 pass (the known
    `typography.test.ts` 10px gap), with the same 331 unhandled errors;
    worker 111 of 111;
  - vf-licence 362 of 362.

  **Migrations** replay: vf-app 138, vf-licence 285.
