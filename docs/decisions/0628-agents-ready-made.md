# 0628: Agents phase 2, slice 1: ready-made agents

**Status: built and tested locally, not yet pushed or deployed.** It
touches `vf-ui` and `vf-licence` only. It needs **vf-licence migration
`0272`** (strings), and no vf-app migration. Deploy vf-licence, then
vf-ui.

## What was asked

With the six agreed slices live (0622–0627), Dan said *"great lets go -
phase 2"*. Asked how, he chose:

- **The order**: the ready-made library first, then links into
  Documents, then agents started by an event.
- **First events**: an invoice stuck N days at a stage, a possible
  duplicate, an invoice from an unapproved supplier, and a supplier file
  that could not be read.
- **Event delivery**: gathered, at most hourly.
- **Deferred**: AR agents (no AR data yet; AR issuing is a later phase
  of the routes design), and a *bank details changed* event (suppliers
  have no bank or payment-account field today).

This record is the first of those slices: the design's **Examples**
(phase 2, "examples library, like the Route library").

## What was built

### vf-ui

- **Ready-made** on the Agents screen, beside New agent, for people who
  make agents. It opens **Ready-made agents**: a card for each of the
  design's use cases whose report the person may use, with its name,
  the words it is described in, its report and when it runs.
- **Use this** fills in a new agent: the name, the words (in the
  Describe it box), the report, **every organisation the person can see
  it for**, when, the report's options, the AI summary on, and email as
  well as the task list where the example sends one and email is set up
  (the task list alone otherwise). The plan is shown in words, as after
  Understand. Nothing is saved until they save it, paused, through the
  same checks as any agent.
- **The seven** (`EXAMPLES` in `agents.js`):

| Ready-made agent | Report | When | Options | Email |
|---|---|---|---|---|
| Weekly outstanding payables | outstanding_payables | Monday 08:00 | highlight past 60 days | yes |
| Due soon, not yet payment-eligible | due_soon_not_eligible | working days 07:30 | within 7 days | no |
| Stuck work | stuck_work | working days 09:00 | older than 5 days | no |
| Past due, not yet payment-eligible | overdue_not_eligible | working days 08:00 | none | no |
| Month-end accruals | accruals | last working day 16:00 | none | yes |
| Team workload | open_tasks | Friday 15:00 | none | no |
| Fraud watch: possible duplicates | possible_duplicates | Monday 08:00 | none | yes |

### vf-licence

- **Migration `0272`**: the library's words, each agent's name and
  description in English and German, and help lines 27 and 28.

## Not built (the next slices)

Links into Documents at a report's filter (slice 2); agents started by
an event (slice 3). AR agents and the bank-details event wait as above.

## Verification

- **`vf-ui`** browser `agents.test.ts`, 3 new: only the ready-made
  agents whose report the person may use (fraud watch left out without
  fraud review); Use this fills the form, every organisation, the plan
  in words, and saves the report, organisations, schedule, options,
  delivery, words and summary; the task list alone where email is not
  set up. Each example's report checked against vf-app's reports.
- **`vf-licence`** 360 of 360; strings replay checks keys are lower case.
- **Full runs**: vf-ui browser 1531, of which 1530 pass (the known
  `typography.test.ts` 10px gap), with the same 331 unhandled errors;
  worker 111 of 111; vf-licence 360 of 360. vf-app unchanged since 0627
  (3549, of which 3547 pass). **Migrations** replay: vf-licence 272.
