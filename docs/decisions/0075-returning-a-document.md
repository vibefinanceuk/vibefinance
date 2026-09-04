# 0075 — Returning a document

**Status: proposed.** Nothing here is built. Written for review before
code, because it touches the task state model that everything else
depends on.

Decision 0064 recorded that *"a task cannot complete negatively"* and
that send-back therefore does not exist. This is the answer to that.

---

## 1. Two capabilities, not one

| | Return to a stage | Return to supplier |
| --- | --- | --- |
| Where the document goes | Backwards, to a stage already visited | Out of the process |
| What it is | A correction request | Giving up on the document |
| Ends in | A task for a named person | A terminal instance state |
| Reversible | Yes — it comes forward again | No |

They share a word and almost nothing else. Building them as one thing
would produce an endpoint with two unrelated behaviours behind a flag.

---

## 2. Return to a stage

### What it does, in one action

Three things at once:

1. moves the instance back to the target stage,
2. creates **one task** there for a named person or team,
3. records the reason.

### It does not re-run the target stage's rules

The important decision here, and it is not obvious.

Re-evaluating Coding's rule set on return would produce whatever its
rules decide **plus** the task the returner assigned — two tasks for one
problem, with automation competing against a person's explicit
instruction.

A return is an instruction: *"Sarah, the cost centre is wrong, fix it."*
The rules already ran when the document came through the first time.
Running them again would be treating a correction as a fresh arrival.

Structurally this is `route_to` plus `assign_task` — initiated by a
person, and deliberately bypassing rule evaluation.

> **`route_to` already permits backwards movement.** It validates only
> that the named stage exists in the process, with no direction check,
> and `MAX_STAGES_PER_VISIT` guards the resulting cycle risk. An
> undocumented existing capability; this decision gives it a
> person-facing surface rather than inventing a mechanism.

### Only stages actually visited

The valid targets are those with a `stage_visits` row for **this
instance** — not the stages defined for the process.

This matters because `route_to` lets a rule skip ahead. A document that
jumped from Validation to Approval never visited Matching, and returning
it to a stage it has never been through would be sending it somewhere
new while calling it a return.

---

## 3. Return to supplier

The document leaves the process. The instance reaches
`returned_manually` — the terminal state decision 0055 section 5.4
already defines — carrying who dealt with it and a free-text note.

**The system sends nothing.** Decision 0055 section 5.3 records why:
`reject` takes no params, and a genuine return path belongs to the
source instance rather than the document — an email arrival has a
sender, an SFTP drop may have only a filename. Making the capability
conditional on arrival mechanism would mean it working differently
depending on configuration a user cannot see.

So this records that a person took responsibility, and the contact
happens outside the system. The alternative — a button that claims to
email a supplier and sometimes cannot — is worse than an honest record.

---

## 4. Permissions

Three, and they are different shapes.

| Permission | Grants | Also requires |
| --- | --- | --- |
| `AP.Return` | The ability to return | The current stage's own permission, **and** holding the task |
| `AP.ReturnAny` | Returning a task you do not hold | Nothing further |
| `AP.ReturnToSupplier` | The terminal case | — |

**`AP.Return` is a capability modifier.** It activates returning
*wherever you already have standing*, and nowhere else. Someone holding
`AP.Return` and `AP.Review` can return from Review and not from
Approval, because they have no business at Approval regardless.

The check reuses `tasks.required_permission` — the task already knows
what it demands, and returning demands the same thing plus one more.
No parallel notion of where somebody belongs.

**`AP.ReturnAny` is the opposite shape.** It grants standing you do not
otherwise have, on a task somebody else holds. A manager override.
Deliberately a separate permission rather than a flag on the first,
because "do more where you belong" and "belong everywhere" are different
grants and should be assignable separately.

> **A manager returning a claimed task takes work away from somebody
> mid-flow.** The record must show the manager did it, not the task's
> holder — otherwise Bob's queue changes without explanation and the
> trail says Bob returned his own work.
>
> This is also exactly the actor a fraud-reporting view exists to watch.
> Noted for that conversation.

**`AP.ReturnToSupplier` is separate** because it is terminal. Someone
trusted to send an invoice back to Coding is not automatically someone
who should tell a supplier their invoice is being rejected.

---

## 5. The task state model

The part that forces a schema change, and the reason this record exists
before the code.

Today a task is **open or completed**, tested as `completed_by IS NULL`
in three places. A return needs two more states:

| State | Means |
| --- | --- |
| `open` | Waiting on somebody |
| `completed` | The person did the work |
| `returned` | This person sent it back — they did **not** do the work |
| `cancelled` | A sibling task, moot because the document left the stage |

**`returned` is not `completed`.** Recording `completed_by` for a return
would put a lie in the audit trail: the person did not do the work, they
declined it and said why.

**`cancelled` exists because of parallel approvers.** Your Approval stage
raises several tasks at once. If one of three returns the document, the
other two cannot be completed against a document that is no longer
there — they are moot, not abandoned by their holders, and the
distinction should survive in the record.

### Consequence

`completed_by IS NULL` stops meaning "open". Three call sites change:
the completion write in `task-route.ts`, the re-visit guard (decision
0072), and the release check in `onTaskCompleted`. All three currently
mean *"still waiting on somebody"*, which becomes `status = 'open'`.

**This is the kind of change that goes wrong quietly.** A missed call
site would leave a returned task counting as open forever, blocking its
instance with nothing to complete. Every one needs a test that fails
without the change.

---

## 6. Coming forward again

A returned document, once corrected, walks forward through the sequence
normally — Matching, Approval — creating fresh tasks at each.

**Approvals given on a document that has since changed should be given
again.** That is the point of returning it. The cost is that a corrected
invoice takes the full trip a second time, which is real and, for a
financial control, correct.

A stage therefore accumulates several `stage_visits` rows. The stage rail
(`docs/design/operator-interface.md` section 6) should show them as
repeats rather than merging them: a document that came back from
Approval twice is telling you something about a supplier or a coder.

---

## 7. What I decided, that you have not

Flagged so they can be overruled cheaply:

- **A return creates exactly one task**, for the named assignee. Not
  several, and not whatever the target stage's rules would have made.
- **The reason is required**, not optional. A return with no reason
  leaves the next person guessing, and the field costs nothing.
- **Reason is free text**, not a closed list. A coded reason would be
  better for reporting and worse for the first hundred returns, when
  nobody yet knows what the categories are. Worth revisiting once there
  is data.
- **The returner's own task becomes `returned`**, and sibling tasks at
  that stage become `cancelled` — including under `AP.ReturnAny`, where
  the returner holds none of them.

---

## 8. Open questions

1. **Can a document be returned from the first stage?** There is nowhere
   behind Validation but the source. Return to supplier is presumably
   the only option, and the interface should offer nothing else.
2. **Does returning to supplier need the stage permission too**, the way
   `AP.Return` does? It is terminal, so arguably it needs *more* rather
   than less.
3. **Should a returned instance be visible as such?** `status` stays
   `in_progress` — it is genuinely still in progress, just backwards. A
   queue of "returned and not yet corrected" may want a real query.
4. **`AR` and `Expense` equivalents.** These permissions are `AP.*`. The
   same capability presumably belongs to the other processes, and the
   permission scheme is namespaced by category precisely so that is a
   one-line addition per category rather than a redesign.
