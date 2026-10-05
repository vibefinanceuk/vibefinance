# 0633: Agents ask the data: the query layer, slice 1

**Status: built and tested locally, not yet pushed or deployed.** It
touches `vf-app`, `vf-ui` and `vf-licence`. It needs **vf-licence
migration `0278`** (strings) and **no vf-app migration**: a query is kept
in the agent's options, so in its plan versions too. Deploy vf-licence,
then vf-app and vf-ui.

## What was asked

Dan wrote a free-text agent: *"Every Monday at 12.10pm, check for invoices
over £100,000 and email"*. It became Outstanding payables, whose minimum
is per supplier, in any currency: close, but not what he asked. He then
asked what it would take for agents to ask the tables themselves, as
*"the agent functionality is limited to dimension that the reports
provide"*.

The proposal (`claude/agents-design.md`, with mock-ups) offered a
**governed query layer**:

- a catalogue of datasets, fields and joins, each with its permission;
- the AI fills in a structured query from closed lists, never SQL;
- our code checks it, writes the SQL and adds each person's access.

Dan liked it *"if you think this would provide most flexibility without
lack of control points"*. He then agreed the four open questions:

1. It comes **before** the rest of phase 3.
2. **Anyone who can make an agent** (AP.Agents) may write a question.
3. A **licence switch**, on by default, with a daily allowance per tier.
4. The **simple reports move** onto the query layer. Duplicates,
   accruals and ageing stay as code.

Agreed slices: (1) the query and its compiler for invoices and tasks,
with tests that try to see too much; (2) plain words write queries;
(3) Edit steps as a query builder; (4) the other datasets and joins;
(5) events, actions, the licence switch and allowance, indexes, and the
simple reports moved. This record is (1).

## What was built

### `agent-query.ts`: the catalogue, the check and the SQL

- **Two datasets.**
  - **Invoices** (AP.Analysis): invoice number, supplier, supplier
    country, issued, due, received, total, net, VAT, currency, buyer
    reference, purchase order, status (in process, through the process,
    returned, archived, not in a process), stage, days at stage, days
    past due, and whether it is at the ERP.
  - **Tasks** (AP.Analysis): stage, person, team, status, created, age,
    claimed, ended, and the invoice and supplier it is about.
  - Each field has a kind (text, a closed set of values, money, days or
    a date), a fixed SQL fragment, its column label, whether rows may
    be grouped by it, and the vocabulary field it shows (BT-*).
- **A query** has these parts:
  - the dataset;
  - up to 10 filters;
  - everything, or only what is new since the last run;
  - the columns, up to 12;
  - or grouping by up to 2 fields, with count, sum, average, smallest and
    largest;
  - up to 2 sorts;
  - a limit, 100 by default and 500 at most.
- **Filters by kind:**
  - text: is, is not, one of, contains, empty, not empty;
  - closed sets: is, is not, one of;
  - money: over, under, between, **always in a named currency**;
  - days: is, over, under, between;
  - dates: in the last N days, more than N days ago, before, after,
    between, empty, not empty.
- **`checkQuery`** refuses anything not in the catalogue, with a reason:
  - `query_dataset_unknown` and `query_field_unknown`;
  - `query_op_invalid`, `query_value_invalid` and
    `query_currency_missing`;
  - `query_group_invalid`, `query_measure_invalid` and
    `query_measure_without_group`;
  - `query_sort_invalid`, `query_limit_invalid` and the other limits.

  It also fills in what is implied, and the plan will say so:
  - a currency column beside money;
  - grouping by currency where money is added up, so money is **never
    added across currencies**;
  - a count where rows are grouped.
- **`runQuery`** writes the SQL from the fixed fragments, and binds every
  value, including the run's time.
  - **Each statement adds the dataset's permission and the person's
    scope**: `unitsWherePermitted`, then `scopedToChosenOrg` and
    `unitClause` per organisation, where nowhere means nowhere.
  - Each row is counted once, in the first organisation it is found
    under, as the reports do.
  - Rows carry `invoiceId`, or `_ids` when grouped, so they open in
    Documents (0629).
  - It reads at most the limit, or 5,000 rows when grouping. It says
    when the answer was cut short (`cutShort`), and it refuses a
    statement past D1's 100 bound values.
- **Hidden fields** (0038) are not offered by the catalogue. Saving or
  running a question that uses one is refused (`query_field_hidden`).

### Agents

- **A report `query`** ("Your own question"), marked `custom`. Its only
  option is the query, checked as above. It is kept with the plan, so a
  change to the question is a new plan version (0625).
- It runs with **each recipient's own access**, as every report does.
- **"New since the last run"** is measured from the start of the last run
  that finished, by when an invoice was received or a task created.
- Plain words do not offer it yet (slice 2), and nor does the form's
  report list (slice 3).
- **`GET /agent-catalogue`**: what this person may ask about.
  **`POST /agent-query/try`**: a question run now with their own access,
  20 rows shown, saving nothing. Both are for anyone with AP.Agents, and
  vf-ui passes both through.

### Reading the answer

- A column may carry `enumKey`, so a value from a closed set is said in
  words (`agents.qstatus.in_progress` → "In process").
- A measure's label names its field: "Total, added up", or "Received,
  earliest" for a date. This works on Tasks, in the email, in the CSV and
  in the table the AI summary is written from.
- A cut-short answer says *"Only the first 100 rows are here. Narrow the
  question to see the rest."*
- **vf-licence `0278`**: those words in English and German.

## Not built (next slices)

- Plain words writing a question (2).
- The query builder in Edit steps (3).
- The other datasets: invoice lines and coding dimensions, stage visits,
  suppliers, returns, purchase orders, files and deliveries (4).
- Event agents and prepared actions on a question, the licence switch
  and daily allowance, indexes, and moving the simple reports (5).

## Verification

- **`vf-app`** `agents-query.test.ts`, 10 tests:
  - refusals for anything outside the catalogue, including a field named
    with SQL in it;
  - money shown with its currency, and grouped by currency when added up;
  - Dan's Monday question answered as asked: per invoice, in pounds only,
    still in process. The UK and German invoices are in, and the euro and
    finished ones are out, with totals;
  - **Uma (UK only) asking for both companies sees only the UK**. Ned,
    with no analysis anywhere, sees nothing. Tasks are scoped the same
    way;
  - filter words with SQL in them are only words;
  - grouping per organisation, supplier and currency, with Documents
    ids; cut short at the limit;
  - a hidden field: not in the catalogue, refused on save, refused on
    run;
  - Try with the person's own access, refused for an organisation they
    cannot see;
  - an agent asking only what is new since its last run;
  - measures and values in English and German in the email and CSV.
- **`vf-ui`** browser `agents.test.ts`, 1 new test: measure labels,
  values in words and the cut-short note. The form leaves out the custom
  report. The worker test covers the two new paths.
- **Full runs**:
  - vf-app 3579, of which 3577 pass (the two known failures);
  - vf-ui browser 1547, of which 1546 pass (the known
    `typography.test.ts` 10px gap), with the same 331 unhandled errors;
    worker 111 of 111;
  - vf-licence 361 of 361.

  **Migrations** replay: vf-licence 278.
