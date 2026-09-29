# 0557 — Routes, slice 3: routes, instances, and Process routes in place of Sources

**Status: built and tested locally, not yet pushed or deployed.** This
session has no push access, so it is delivered as a git bundle. It
touches `vf-app`, `vf-ui` and `vf-licence`, and needs **`vf-app` migration
`0107` (apply before deploying `vf-app`) and `vf-licence` migration
`0208`**.

## What was asked

Slice 3 of the Routes design (`docs/design/routes-phase1-data-model.md`
section 7): routes, their versions and where each is placed; each
process's entry and exit stages; the Routes screen (standard routes,
read-only); and Process routes replacing Sources, as mocked up and agreed
(with the operator's refinement: Sources deliver to the process's entry
stage, Intake, and Destinations read from its exit stage, Payment
Eligible). The one menu change the design accepted comes with it.

## What was decided

- **Migration `0107`**:
  - `routes` (Source or Destination, standard or copied), `route_versions`
    (the five parts, at most one live version per route) and
    `route_instances`.
  - **Six standard routes.** *Email in* and *HTTPS in* are live, as they
    work today. *SFTP in*, *File import* and *EDI in* are named source
    mechanisms (0060) that nothing receives by yet, so their versions are
    drafts. *ERP CSV file* is the one Destination.
  - **Every source is a Source instance with the same id**, of the route
    for its mechanism, so route messages (0555) and everything else
    naming a source keep working. A Source instance takes its name,
    status, address and org from its source; the instance row adds only
    the route. A Destination instance has its own name and status.
  - **An ERP Destination for each process that has a source**, reading
    from its exit stage.
  - **Entry and exit stages are on the process** (`processes.entry_stage_id`,
    `exit_stage_id`), set to the first and last stages of its current
    version: Intake and Payment Eligible in the Standard AP Process. The
    design note put a `route_role` on the stage. On the process is
    simpler, because a process then has at most one of each by
    construction, and a one-stage process can be both. A stored stage
    the current version no longer has is not used: the first or last
    stage stands in (`processEnds`), as it does for a process created
    after 0107.
  - Standing invariants: every source is a Source instance; a Source
    instance has no name or status of its own and a Destination instance
    has both; each places a route of its own direction; a Source
    instance is in its source's process. A test applies 0107 to a
    database that already has sources (`migrations/tests`).
- **Creating a source creates its instance in the same batch**, and a
  process's first source gives it an ERP Destination. Deleting a source
  nothing used deletes its instance too.
- **A source that has received any message is retired, not deleted.**
  Since 0555 a message is kept even when it made no invoice, and deleting
  its source would orphan it (and fail on the foreign key). Renaming is
  refused for the same reason.
- **`GET /routes`**: every route with its current version's five parts,
  whether it is live, and the processes it is placed in (retired sources
  not counted). **`GET /process-routes?process=`**: one process (the one
  asked for, else the first with a source) as its stages, entry and exit,
  Source instances with this week's messages and open failures from the
  Route monitor's records, and Destination instances. The ERP's
  "waiting" count is the ERP export's own (0552). **Gated on
  `Admin.Configure`**, as Sources was: this is the screen that replaces
  it, and changing where invoices arrive still goes through the same
  `/sources` routes. `Integration.Configure` waits until routes
  themselves can be configured.
- **The Routes screen** (Integration menu): Sources beside Destinations,
  each route's gateway and format in and out, where it is placed, and its
  version as Live or Draft; the chosen route (the first live source by
  default) as its five parts, the model in the middle marked. Read-only,
  and it says so: copying and new versions come with the mapping editor.
- **The Process routes screen** (Integration menu), drawn as the mock-up:
  - the process's Source instances on the left, joined by a connector
    each to its entry stage; its stages in order, the entry and exit
    stages marked "Sources deliver here" and "Destinations read from
    here"; its Destination instances on the right;
  - a card says each source's route, address and state (receiving, no
    address yet, failures, not yet available for a draft route, retired)
    and the ERP's waiting count;
  - **choosing a source opens the Sources screen's own actions**: create
    its address, its org, rename and retire. `sources.js` now exports
    them with a refresh hook, so both screens share one copy;
  - choosing the ERP shows what it reads from and opens the ERP export,
    which works exactly as before;
  - **Add a source** creates one in this process, from its name and how
    it arrives, with the identifier shown as it is typed;
  - a chip per process.
- **The menu**: Sources leaves Configuration. Integration now reads
  Routes, Process routes, Route monitor, ERP export. As the design
  accepted, some screens change colour: Purchase Orders, Rules and
  Processes each move one place. Anything that still opens `sources`
  is taken to Process routes.
- Two new nav icons (a box with an arrow in and out; sources fanning into
  stages), and strings in English and German (`vf-licence` `0208`).

## Not built / worth knowing

- **The ERP export is not yet driven by its Destination.** Its
  eligibility, per-process scope and messages come in slice 4.
- Routes cannot yet be copied, versioned or edited, and a process's entry
  and exit stages cannot be changed from the screen.
- The old Sources screen still exists behind Process routes (it opens if
  called directly), and its tests still pass. It can be removed once
  nothing needs it.
- The `stage-permissions` test's known failure is unchanged.

## Verification

- **`vf-app`** `routes.test.ts` (9): the six standard routes and their
  parts; creating sources makes their instances and one ERP Destination;
  deleting an unused source removes its instance; a source with a message
  is retired, and cannot be renamed; entry and exit stages, stored or
  standing in; one process as a flow, with week and failure counts; the
  process chosen; where each route is placed. With the previous
  `source-route.ts`, 4 of the 9 failed (the others test the new module
  alone). `index.test.ts`: both routes 403 without `Admin.Configure`, 200
  with it.
- **Migration**: `migrations/tests/test_0107_routes_backfill.py` on a
  populated database (processes with and without stages and sources,
  email, HTTPS and a retired SFTP source, a message) passes;
  `vf-app` replay 107, all assertions held.
- **`vf-ui`**: `routes.test.ts` (browser, 7) with the real strings: both
  tables; a route's five parts and another chosen; the flow, cards and
  connectors; a source's actions, creating an address and reloading the
  flow rather than Sources; the ERP Destination; Add a source; switching
  process. `tasks.test.ts` and `sources.test.ts` updated for the menu:
  Integration for `Admin.Configure`, Sources gone, Processes and Rules one
  colour earlier; 130/130. `index.test.ts`: both paths proxied.
- `vf-licence`: string coverage lists all 110 keys; 322/322; replay 208.
- **`vf-app`**, a full, unfiltered run: 137 files and 3247 tests, of which
  **3245 passed**; the two failures are the ones already known (0511).
- **`vf-ui`** browser: 1324/1325 (the known `typography.test.ts` 10px gap),
  after `rules.test.ts`'s own menu list was updated too.
- Day and Night screenshots of both screens, a source and the ERP open,
  and Add a source, checked by eye.
