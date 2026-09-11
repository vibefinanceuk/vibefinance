# 0239 — A dashboard, and the stages it cannot name

**Status: evaluation, no code.**

---

## Most of it is already answerable

The data is there, and better than I expected.

| What was asked | What answers it |
| --- | --- |
| Items at each stage | `process_instances.current_stage_id`, or `tasks.stage_id` for the ones with work attached |
| Items pending on my teams | `org_team_members` joined to `tasks.owner_team_id` — decision 0202 already computes this for the task list |
| Sorted by waiting time | `tasks.created_at`, which has been there since decision 0008 |
| High-value invoices | `invoice_headers.total_with_vat` |
| Processed today, this week | `tasks.completed_at`, and `ended_at` for the ones that were returned or discarded |
| Invoices received this week | `invoice_headers.created_at` |
| Most common exception | `stage_visits.validation_failures`, JSON, readable with `json_each` |
| Exceptions by supplier | the same, joined through `invoice_headers.supplier_id` (decision 0209) |

**Nothing in the list needs a new table**, which is unusual for a
request this size and is worth saying plainly before estimating.

---

## The trap: the stages are not ours to name

Six of the metrics name a stage — *Validation*, *Review*, *Approval*,
*Matching*, *Coding*, *Awaiting Payment*.

**Those are this customer's stages.** `process_stages` is customer data
(decision 0008), a customer may rename them, and decision 0150 versions
them. A dashboard with six hardcoded cards is a dashboard that is wrong
for the second customer and stale for the first.

**So the card is *items at a stage*, parameterised** — and the six
become six instances of one thing, configured rather than coded.

**Which is also what makes a library possible.** A card that takes a
stage is a card somebody can add twice.

---

## And a second, quieter one

**A dashboard is a set of queries that ignore decision 0202.**

That record made the task list unit-aware: a German validator is not
shown French work. **A count is a disclosure** — *"47 items in
Approval"* tells somebody there are 47 invoices they may not see.

Every query here must go through the same filter, and **that is the
part most likely to be got wrong**, because a count feels like less than
a list.

---

## Metrics worth adding

**On the work itself:**

- **Oldest item, by stage.** Not the count — the count says *how much*
  and the age says *how bad*. A queue of 3 with one from August is worse
  than a queue of 40 from this morning.
- **Items I have claimed and not finished.** Decision 0180 distinguishes
  owned from claimed; work somebody took and left is invisible today.
- **Items returned to me**, which decision 0031's `return` action
  creates and nothing surfaces.
- **Unplaced documents** — `org.unplaced` is recorded and read by
  nothing (decision 0204), so a queue can build invisibly.
- **Suppliers awaiting the ERP** (decision 0231), which is a team's
  work rather than an invoice's.

**On flow rather than stock:**

- **Average time at each stage**, which is where a process is actually
  slow — a count tells you where things are, not where they wait.
- **Straight-through rate**: invoices that reached payment-eligible with
  no task raised at all. **The number this product exists to move.**
- **First-time-right**: how often a keyed field was corrected later.

**On the supplier side, now that the mirror exists:**

- **Invoices from held suppliers** (decision 0230).
- **Duplicate suspicions** — `invoice.duplicate_confidence` is computed
  and nothing surfaces it.

**One I would not build:** *most common exception sorted by country*.
Two dimensions in one card, and the useful question is almost certainly
*which suppliers send bad invoices* — which is already on the list and
actionable in a way a country is not.

---

## On my clock

The operator asked for a worklist of ageing items, sortable by ageing or
by payment due date. **Both, because they measure different things and
disagree.**

**Ageing is my responsiveness** — how long a task has sat with me.
**The due date is the supplier's expectation**, and `BT-9` has been on
the invoice since decision 0007.

They come apart routinely: an item held two days and due tomorrow is
urgent; one held thirty days and due next month is embarrassing but not
yet costly. **So both columns are shown at once**, and the sort chooses
which to lead on.

**A third sort is worth having and was not asked for: soonest due.**
Ageing answers *how long have I had this*; the due date answers *when do
they expect it*. **Neither answers *what should I do next***, and days
remaining does.

### What *mine* means

Decision 0180 found that `lockedBy` is not the owner and separated them.
A task can be:

- **assigned to me** — `owner_user_id`
- **claimed by me** — `claimed_by`
- **owned by a team I am in** — `owner_team_id`

**The first two are mine; the third is available.** The operator agreed
on that reading, and it matters because the two lists differ a lot: a
team queue is work nobody has taken, and putting it on somebody's clock
would make every member responsible for all of it.

### And the value sort replaces a card

*High-value invoices, sorted descending* was a separate metric in the
original list. **It is better as a sort on this one** — the question is
*which of my items is big*, not *which invoices in the system are big*,
and the second is a report rather than a workload.

---

## The library

**A dashboard is a list of card instances**, each a type plus its
settings — `{ type: "items_at_stage", stage: "validation" }`.

**Per user**, because the point is *"what is my workload"*. A shared
default per role would be a second concept and can wait until somebody
asks.

**And the card types are a closed set**, for decision 0031's reason:
a catalogue somebody picks from is safe in a way an arbitrary query is
not, and every type is a query we wrote and can scope.

---

## Effort, honestly

**A first version is small**, because the data is there:

- **One migration** — `dashboard_cards`, keyed by user, with a type, a
  position and a JSON of settings.
- **One route** that runs a card's query, with the decision 0202 filter
  applied in one place rather than per card.
- **A screen**, plus an *add a card* picker.
- **Six or seven card types** to start.

**Perhaps two or three days**, and the bulk of it is the screen rather
than the data.

**What would make it a week** is the flow metrics — average time at a
stage, straight-through rate, first-time-right. Those need thought about
what counts as *started* and *finished*, and at least one needs a stage
visit's own timing rather than a task's.

---

## What I would settle first

1. **Is a card's audience the person or the team?** *"Items pending on
   teams I am in"* is a team question and *"items I claimed"* is a
   personal one. Both are reasonable, and a card that quietly changes
   which it means is worse than two cards.

2. **Does a count respect decision 0202's filter?** I think it must, and
   it means some numbers will differ between two people looking at the
   same queue — which is correct and surprising.

3. **How many cards before it stops helping?** Fourteen metrics were
   listed. **A dashboard of fourteen numbers is a wall**, and the
   library exists so somebody can choose four.
