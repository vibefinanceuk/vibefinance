# 0180 — Owned is not locked

**Status: fixed.** A task says who it belongs to, and the heading reads
as one list.

---

## "Owner: Nobody yet" about a task in its owner's own queue

> It says "Owner Nobody yet", even though it is assigned to my user.

**`lockedBy` appears only once somebody claims a task.** Decision 0176
read it as the owner, so a task **assigned** and not yet **claimed** had
no `lockedBy` — and the screen reported nobody.

These are different facts, and decision 0104 already named the
difference: **a claim is a lock.** It says somebody is working on it
now. Ownership says whose it is.

`owner_user_id` and `owner_team_id` were loaded on every row and never
reported. Both are now, joined for a name and an address, and the screen
says whichever it means.

**A team owns it and nobody in particular does** reports the team, not
*"nobody"* — *"the AP team"* tells somebody whether it is theirs to
take.

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

- **A task owned by a team and claimed by a person shows the team.**
  Both are true and the screen picks one; *"AP team, with Alice"* would
  say more.
- **The document manager does not show ownership at all**, though it now
  could.
