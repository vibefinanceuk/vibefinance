# 0142 — One screen, every stage

**Status: built.** The review screen is the validation screen, and
almost none of it was new code.

---

## The question, and a better answer than expected

> The same as validate, just with different actions, and with the
> information locked read-only. Is there a way to accomplish that which
> uses the same code, and leverages extensibility around the actions
> and role assignment?

**It already worked that way**, and checking rather than assuming
mattered — the honest answer was three small gaps rather than a screen.

- **Field visibility** already restricts a field per stage, and a stage
  may only tighten (decision 0114). *"Approvers should approve data, not
  edit data"* is configuration.
- **A task already reports its own actions** (decision 0103), gated on
  permissions rather than on a stage's name. An approval task offers
  `complete` and `return` where a validation one offers `key`.
- **The viewer already fetches both per stage**, since decision 0114
  wired `loadFields(task.stageId)`.

**And approve and reject already exist.** Completing an approval task
advances the process; returning it sends it back. No new actions, no new
permissions, no new routes.

---

## What was actually missing

### The viewer opened only for `key`

Which an approval task never offers — so the screen was unreachable
rather than absent.

**Opening a document is navigation, not an action.** Whether somebody
may look at a task is decided by the task being theirs; what they may
*do* by the actions it reports; what they may *edit* by field
visibility. None of that needs a fourth gate.

So the row's **document is clickable**, and any task opens. Making it a
button among the actions would have put navigation where decisions live.

### Save was the screen's own, always offered

An approval task has every field read-only, so **a Save that submits
nothing is a button promising an effect it cannot have** — which
decision 0122 already called worse than an absent one.

It appears where something can be saved, and the dominant action becomes
whatever the task actually offers.

**Read from what the stage permits, not from its name.** A customer who
makes Validation read-only gets a read-only Validation screen, and
nothing about the code changes — which is the property that makes this
configuration rather than a second screen.

### And the heading said "Validation"

On every stage. The screen naming a stage it is not on is the screen
lying about where somebody is.

---

## One thing found on the way

The task list still **disabled every action except claim, release and
key**, with a comment saying the proxy did not carry the rest.

Decision 0138 made that untrue yesterday. A comment describing a
limitation that has been lifted is worse than none: it tells the next
reader not to bother looking.

---

## What is not built

- **Nothing configures Approval as read-only.** The mechanism is there
  and the rows are not, so an approval task today shows editable fields
  and a Save. **This is data**, and belongs in a customer's own
  configuration rather than a migration — but until somebody writes it,
  the screen does not behave as this record describes.
- **No approval-specific view of anything.** An approver sees the same
  panels a keyer does. Whether they want a purchase order beside the
  invoice, or the approval history, is a question nobody has asked yet.
- **`AP.Approve` and `AP.Review` exist and gate nothing.** Actions are
  gated on the stage's `required_permission` and on `AP.Validate` for
  keying; neither of the approval permissions is consulted anywhere.
