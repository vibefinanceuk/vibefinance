# 0180 — Who a task belongs to

**Status: fixed.** A task says who it belongs to, and the heading reads
as one list.

---

## "Owner: Nobody yet" about a task in its owner's own queue

> It says "Owner Nobody yet", even though it is assigned to my user.

**`lockedBy` appears only once somebody claims a task.** Decision 0176
read it as the owner, so a task **assigned** and not yet **claimed** had
no `lockedBy` — and the screen reported nobody.

`owner_user_id` and `owner_team_id` were loaded on every row and never
reported.

### And I first drew a distinction the system does not make

The fix reported ownership and a claim as **two separate facts**. The
operator:

> Claimed by sets ownership — it is the same thing.

**Right, and the code already said so.** `ownershipOf` returns `"mine"`
for *either* an assignment or a claim, and migration 0008's invariant
means **a claim only exists on a team task** — a task assigned to a
person needs none, because it is already theirs.

So there is one owner. My version reported the **team** for a task
somebody had claimed, which is the opposite of useful: **the claim is
precisely the news.**

Resolved in the order a person would ask it: whoever took it, else
whoever it was given to, else the team it is waiting in. A team still
answers where nobody has taken it, because *"the AP team"* tells
somebody whether it is theirs.

---

## Four facts, one voice

> "Stage", "Unique Ref", "Waiting" and "Owner" should all have the same
> font and colour and be equal distance apart.

They were three treatments: a bold heading, a subtitle, and a row of
two. **They answer the same kind of question** — what is this, and where
does it stand — so they read as one column now, evenly spaced.

The heading keeps its weight, because it is the heading. Everything
under it is one size and one colour.

---

## What is not built

- **Where a task came from is not shown.** A team task claimed by Alice
  says *"Alice"*, and *"Alice, from the AP team"* would say more — but
  the claim is the fact that matters and the row is one line.
- **The document manager does not show ownership at all**, though it now
  could.
