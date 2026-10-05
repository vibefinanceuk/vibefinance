# 0631: Agents phase 3, slice 1: prepared actions, and reminding whoever holds a stuck task

**Status: built and tested locally, not yet pushed or deployed.** It
touches `vf-app`, `vf-ui`, `vf-licence`, `vf-admin` and `shared`. It
needs **vf-app migration `0135`** and **vf-licence migrations `0275`**
(the licence switch) **and `0276`** (strings). Deploy vf-licence, then
vf-app, vf-ui and vf-admin.

## What was asked

Dan asked to look at phase 3, prepared actions (*"can you look at phase
3"*). The proposal (`claude/agents-design.md`, with mock-ups) offered
four actions; Dan chose all of them and added a fifth, **tacitly
approving an invoice after a period of time**, and chose that **the
agent's author or anyone holding the action's permission** may approve.
He then agreed the proposal: *"Agreed - tacit approval, per the
mock-up should be below a configurable threshold, and above a
configurable number of days."* The proposal's open questions were taken
as agreed:

- **Tacit approval** is a policy on the approval stage, set by an
  administrator, off by default; agents send the reminders.
- **Chasers** are sent in the AP team's name and address.
- **Away** can be marked by the person or their manager.
- **A prepared action lapses** after 5 working days.
- **Prepared actions** can be left out of a tier by the licence.

Agreed build order: (1) prepared actions and reminding a task holder,
(2) chase a supplier, (3) away and cover, (4) send early to the ERP,
(5) tacit approval. This record is (1).

## What was built

### vf-app

- **Migration `0135`**:
  - `agents.action` (what it also prepares; `remind_holder` for now);
  - `org_settings.agent_actions` (an administrator's switch, on by
    default);
  - `agent_actions`: what was prepared, for which invoice and
    organisation, with which permission needed, what it rests on
    (`payload_json`), and its status (`waiting`, `done`, `failed`,
    `rejected`, `expired`), who decided and when, their note, why, and
    what happened. One waits at a time for the same thing (a partial
    unique index on `subject_key`).
- **`agent-actions.ts`** (`AGENT_ACTIONS`): `remind_holder` needs
  **AP.TaskManage** and can be prepared by **stuck work** and **an
  invoice stuck at a stage** (0630).
- **Preparing**, after each run, from the **author's own copy**: for
  each invoice in it, each open task held by someone (`owner_user_id`
  or `claimed_by`) and older than the report's own days. One reminder
  each, unless one waits or one was prepared in the last 7 days. Lapses
  after **5 working days**.
- **The action is part of the plan.** It is checked against the report
  (`action_unknown`, `action_not_for_report`), kept on edit while the
  report is the same, and a change makes a new plan version.
- **`GET /agent-actions`**: what waits for this person, being those
  whose permission they hold where the invoice is. Nothing is offered
  while actions are off.
- **`POST /agent-actions/:id/approve` or `/reject`**:
  - checks the person may, that the action still waits and has not
    lapsed, and that actions are on;
  - **checks again** that the task is still open with the same person,
    or it is marked `failed` (`changed`) and nothing is done;
  - decides it once only, with a conditional update.
- **Approved, the reminder**:
  - an email to the holder in their own language, naming who asked, the
    invoice, the supplier, the stage and the days, with the approver's
    note (`buildReminderEmail`, English and German);
  - the invoice's **Timeline** says *"Maya reminded Uma Becker, as an
    agent prepared"*, with the note;
  - the agent's page lists what it prepared and what became of each.

  Without email set up, or without an address, it is still done and
  shown, and says no email went.
- **Lapsing** happens on the five-minute tick. Purging old runs keeps
  their actions.
- **`PUT /agent-settings`** also takes `actionsEnabled` (Admin.Configure).
- **`GET /agents`** says, per report, the actions it can prepare, and
  whether actions are on here and in the licence.

### vf-licence, shared and vf-admin

- **Migration `0275`**: `licences.agent_actions` (NULL or 1 allowed, 0
  left out). The token says `agentActions: false` only when left out;
  the shared claims check takes it.
- **vf-admin**: a *Prepared actions* tick box on the licence editor.

### vf-ui

- **Also prepare** on the form, for a report that can, with what it
  means. It says when actions are off here or not in the licence. The
  plan says *Prepares* when set.
- **For your approval** on Tasks, above the agents' notes: what will
  happen, the supplier, stage and days, the agent and when it lapses, a
  note to add, then **Approve** or **Reject**. Afterwards it says what
  happened, or why nothing was done.
- **The agent's page**: *What it prepared*, each one's status and who
  decided.
- **The Agents screen**: *Prepared actions are on / off* with **Turn
  off / Turn on**, for administrators where the licence allows.
- **Timeline**: the reminder line. Help lines 33 to 35.

## Not built (next slices)

Chase a supplier (2), away and cover (3), send early to the ERP (4),
tacit approval as a stage policy (5).

## Verification

- **`vf-app`** `agents-actions.test.ts`, 6 tests:
  - only an action the report can prepare; as part of the plan;
    offered per report;
  - one per held, old enough task, once, for those who may approve
    where the invoice is (Maya Acme UK only, Pat none); none again
    while it waits;
  - approved by Maya with a note: the holder emailed in German, the
    Timeline line, the agent's page; decided once only;
  - rejected; a task released since, so not done (`changed`);
  - lapsing after 5 working days, not prepared again within 7 days,
    a newly old task prepared;
  - nothing offered or approved while an administrator has actions off.
- **`vf-licence`** 361 of 361, a new token test for `agentActions`.
- **`vf-ui`** browser `agents.test.ts`, 4 new:
  - Also prepare only for a report that can, saved, dropped on another
    report;
  - For your approval, approved with a note;
  - why nothing was done;
  - the agent's page list and the administrator's switch.

  The worker test covers the new paths through the proxy.
- **Full runs**:
  - vf-app 3563, of which 3561 pass (the two known failures);
  - vf-ui browser 1543, of which 1542 pass (the known
    `typography.test.ts` 10px gap), with the same 331 unhandled errors;
    worker 111 of 111;
  - vf-licence 361 of 361; vf-admin 14 of 14;
  - shared 436, of which 432 pass and 1 is skipped (the known three).

  **Migrations** replay: vf-app 135, vf-licence 276.
