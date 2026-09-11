# 0254 — A task without a stage visit

**Status: built, and one thing unresolved.** Read the last section.

---

## Three on the card, seven in the list

The operator's screenshots settled it: a Validation card reading **3**,
and the task list it opened showing **7**, every row Validation and
every one theirs.

**A task does not need a stage visit to exist**, and some do not have
one. The card joined through `stage_visits`; the task list asks only
`t.stage_id`. So the card could not see them.

### And my diagnostic queries joined the same way

Three hypotheses in a row were wrong — a multiplication, a stage
divergence, an idle instance — **because the query I was checking with
shared the fault of the code I was checking.**

`SELECT ... FROM tasks t JOIN stage_visits v ...` returned nine and
looked authoritative. **A check built from the same assumption as the
thing it checks is not a check**, which is the fourth time this month
(decisions 0223, 0235, 0241, 0249) and the first where I wrote the bad
check myself, live, three times running.

---

## Left joins, and the scope stays safe

The chain is still walked, because the filter needs the invoice. **Where
a task has no chain, `h.org_unit_id` is null** — so an unrestricted
reader sees it and a restricted one does not, which is the safe way
round for a count that is a disclosure (decision 0240).

---

## Two things the task list was also getting wrong

**Six stage ids were named by hand** in `filterBar`. Decision 0239
called that the trap in the dashboard and did not check for it here:
`process_stages` is customer data, and **a list that does not contain a
stage cannot select it.** The options come from what the list returns
now.

**And the select did not show the filter in force.** Arriving from a
dashboard card set `filters.stage`, the list filtered correctly, and the
dropdown still read *all stages* — so the screen was filtered and said
it was not, which is how the operator's screenshot looked like a
filtering failure when it was a labelling one.

---

## What is unresolved

**I could not make the fix fail.** Reverting the left join to an inner
one — verified on disk, in the file the test imports — left all
thirty-nine tests passing, including the one asserting an orphan task is
counted.

**That should be impossible**, and I do not know why. Either the test is
not exercising what it claims, or something is cached between runs.

**Until that is understood, the orphan test is not evidence**, and the
fix rests on reading the query rather than on watching it break.
**Recorded rather than glossed**, because a test I cannot make fail is a
test I should not trust.
