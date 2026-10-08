# 0692: Indexes for the tables that grow with every invoice

**Status: built**, in bundle 0992. vf-app migration
`0152_indexes_for_growing_tables.sql` (indexes only) and one query in
`usage.ts`.

## What was asked

Dan, 8 October 2026:

> Can you look at the table structure - are there any indexes that may need
> to be applied in support of improved performance. particularly those that
> would grow large like document tables, or task tables, or message tables.

## Method

The answer comes from the schema and the code, not from data, so it holds
whether the tables are empty (as now, after a runtime wipe) or large.

1. Every migration applied to an empty SQLite database: 113 tables.
2. Every SQL statement passed to `.prepare()` in `workers/vf-app/src` was
   extracted and run through `EXPLAIN QUERY PLAN`: 1,007 planned, 75 built too
   dynamically to plan automatically. The busiest of those 75 (the task list,
   the dashboards) were planned by hand with realistic filters.
3. A query whose plan reads a whole growing table (`SCAN tasks`, not
   `SEARCH tasks USING INDEX`) is one whose cost rises with every invoice ever
   processed.
4. Foreign-key columns on growing tables with no index starting with them were
   listed as a cross-check.

## What was found

**`tasks` had no index but its primary key.** Every inbox load, dashboard
count, "is anything still open on this visit" check (run after every task
action), cancellation on return or reject, and Throughput by user read every
task ever created.

Also read in full:

- the Documents list, sorted newest first with no org narrowing (a full sort);
- the Route monitor's "today" counts;
- the viewer's retained-page lookup (`pending_documents` by invoice);
- an invoice's ERP exports;
- the month's rule runs for usage reporting.

## Before and after

| Query | Before | After |
| --- | --- | --- |
| Inbox (open tasks, mine or my team's) | SCAN tasks | SEARCH tasks by status: open tasks only |
| Open tasks on this visit | SCAN tasks | SEARCH, covering index (stage_visit_id, status) |
| Cancel an instance's open tasks | SCAN tasks | SEARCH, covering index |
| My open tasks (dashboard) | SCAN tasks | SEARCH by status |
| Throughput by user | SCAN tasks | SEARCH, covering index (completed_by, completed_at) |
| Documents list, newest first | SCAN + temp sort | index order (created_at) |
| Tasks per invoice ("hands") | SCAN tasks | SEARCH visits by instance, then tasks by visit |
| Route monitor, today | SCAN route_messages | SEARCH by received_at |
| Retained pages (viewer) | SCAN pending_documents | SEARCH by invoice_id |
| An invoice's ERP exports | SCAN erp_export_rows | SEARCH by invoice_id |
| Usage, this month's runs | SCAN invoice_runs | SEARCH, covering index (created_at) |

**The query change.** Usage counted the month with
`strftime('%Y-%m', created_at) = ?`. A function wrapped around a column stops
any index being used, so it is now a range: `created_at >= 'YYYY-MM-01' AND
created_at < first of next month`. Both timestamp forms in use
(`YYYY-MM-DD HH:MM:SS` and ISO with `T`/`Z`) sort inside that range. A new test
covers December into January in both forms.

## The indexes (22)

- **tasks:** `(status, owner_team_id)`, `(status, owner_user_id)`,
  `(status, claimed_by)`, `(stage_visit_id, status)`, `(stage_id, status)`,
  `(completed_by, completed_at)`.
- **stage_visits:** `(stage_id)`.
- **process_instances:** `(process_id, status)`.
- **intake_capture_events:** `(process_instance_id)`.
- **invoice_headers:** `(created_at)`.
- **invoice_documents:** `(route_message_id)`.
- **pending_documents:** `(invoice_id)`.
- **route_messages:** `(received_at)`.
- **destination_deliveries:** `(message_id)`.
- **inbound_email_events:** `(source_id, occurred_at)`.
- **erp_export_rows:** `(invoice_id)`.
- **invoice_runs:** `(created_at)`.
- **rule_examples:** `(rule_id, rule_version)`.
- **agent_runs:** `(started_at)`.
- **agent_actions:** `(run_id)`.

## Deliberately not indexed

- **Columns that point at people** (`created_by`, `decided_by`, `actor_id`
  and the like, about 60 of them). They are read only through the record that
  holds them, never searched by. An index would cost every write and help only
  if a person were deleted, which the app does not do.
- **Small configuration tables** (stages, rules, routes, teams, org units).
  They grow with configuration, not with invoices.
- **One `json_extract` on `invoice_headers`**, in the check before deleting a
  source, which runs only when a source is retired.

## Cost

Each index is written on every insert or update of its table: a few
microseconds against reads that otherwise grow with every invoice processed.
D1 storage for the indexes is small beside the tables themselves.

## Tests

Applied in the test schema (`test/setup.ts`). The full vf-app suite runs
against it. `test/usage.test.ts` has a new month-boundary case.
