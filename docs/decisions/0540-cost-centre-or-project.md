# 0540 — A coded line carries a Cost Centre or a Project, set in AP Setup

**Status: built and tested locally, not yet pushed or deployed.** This
session has no push access, so it is delivered as a git bundle. It
touches `vf-app`, `vf-ui` and `vf-licence`, and needs **`vf-app`
migration `0098` (apply before deploying `vf-app`) and `vf-licence`
migration `0195`**.

## What was asked

From a discussion of Cost Centre (an ongoing department, operating
cost) and Project (a temporary initiative with its own budget):

> I think that either cost-centre OR project are mandatory fields, but
> neither should be selected at the same time. So a line item cost is
> either related to a cost centre OR a project

Asked whether this should be fixed or configurable, since some
organisations book a project line against its owning department as
well:

> Okay - lets make it an AP Setup option

## What was decided

- **An AP Setup setting**, on the Account Coding tab above the lists:
  "Cost centre and project", with **One or the other (recommended)**
  (`exclusive`, the default) or **Both allowed** (`both`, the
  behaviour before this decision). It is stored in a new singleton,
  `org_coding_config` (migration `0098`), read and written whole
  through `GET`/`PUT /coding-config` (`Admin.Configure`, like
  `/matching-config`). If the setting can't be read (before the
  migration), nothing is imposed.
- **With "one or the other" on:**
  - **The Coding pop-out** shows one full-width card with a **Cost
    centre | Project** switch, opening on whichever the line holds.
    Switching alone changes nothing; **choosing a value** for one clears
    the other. Accepting a suggested project (or cost centre) does the
    same and turns the switch.
  - **Save** (`key-fields-route.ts`): keying one of the two on a line
    that holds the other clears the other, a supplier's own BT-133
    included, and records it in `keyed_fields`. The `cost_centre`
    column follows. A save keying **both** is refused
    (`422 cost_centre_and_project`, shown as "Not saved. A line carries
    a cost centre or a project, not both (line n)."). A line that held
    both before, saved for another reason, is left alone: only what the
    save changes counts.
  - **Complete at a coding stage** (`codingGapsForTask`, 0513/0537):
    where either is editable, the two are one requirement, "Cost centre
    or project": a line with neither is `missing`, a line with both is
    `both`. Whichever one is there is still checked against its list
    (0511). Commodity and GL codes are unchanged.
  - **Suggestions** (0539) don't draw on earlier lines that held both.
- **With "both allowed"**, everything behaves as before this decision.
- **Approvals.** With one of the two per line, the approver comes from
  whichever it is. Routing to a project's approver needs AP Setup's
  approval mode set to Cost-Object, with the Project dimension turned
  on (0452). Not changed here.

## Not built / worth knowing

- **Existing lines holding both** are not changed. Under the default
  they will be asked to choose at their next coding Complete. To see
  whether there are any (read-only, `vf-app-poc`):

  ```sql
  SELECT invoice_id, line_number FROM invoice_lines
  WHERE json_valid(facts_json)
    AND trim(coalesce(json_extract(facts_json, '$."BT-133"'), '')) != ''
    AND trim(coalesce(json_extract(facts_json, '$."coding.project"'), '')) != '';
  ```
- **A cleared field is stored as an empty value**, not removed from the
  line's facts. Every reader treats empty as not coded.
- From the discussion, still open: project status and budget, GL codes
  linked to cost centres, a supplier "needs a project" setting, the
  invoice's own project reference (BT-11) as a suggestion, and split
  coding.

## Verification

- **`vf-app`**:
  - `coding-config.test.ts` (3): the default is either/or; the setting
    is written whole and only the two values are accepted; nothing is
    imposed when it can't be read;
  - `key-fields.test.ts` (4): keying a project clears a supplier's cost
    centre (facts, column, trail) and back again; keying both is
    refused; a line already holding both is left alone on an unrelated
    save; "both allowed" keeps both;
  - `index.test.ts`: Complete treats the two as one requirement (neither,
    both, a project not on the list, then success); `/coding-config`
    through the router (401, 403, write and read back). 0513's own test
    now runs under "both allowed", the behaviour it documents, and
    0537's Non-PO test expects the new "Cost centre or project" gap;
  - `coding-suggestions.test.ts`: lines holding both are skipped under
    either/or and used under "both allowed".
  With the previous commit's `coding-validation.ts`, `key-fields-route.ts`
  and `coding-suggestions.ts`, the 4 tests of the new behaviour
  **failed**; the 3 that passed check behaviour that should not change
  (a line holding both left alone, "both allowed", and the route).
- **`vf-ui`**: `viewer.test.ts` (6: the switch card and which side it
  opens on, choosing a project clears the cost centre, switching alone
  changes nothing, accepting a suggested project, the refusal wording)
  and the gap wording for "Cost centre or project"; `ap-setup.test.ts`
  (2: the setting shown and saved; the default shown when it can't be
  read). All 8 new tests **failed** with the previous `viewer.js`,
  `ap-setup.js` and `app.css`. Three AP Setup / Account Coding tests
  that took the first panel, warning or Save on the tab now look in the
  lists' own panel or pop-out, since the new setting sits above them.
- Migrations: `vf-app` replay 98, all assertions held; `vf-licence`
  0195's assertion (20 rows) checked on a replay.
- Browser 1267/1268 (the known `typography.test.ts` 10px gap). Worker
  75/75. `vf-licence` 320/320.
- **`vf-app`**, a full, unfiltered run: 129 files and 3144 tests, of which **3142 passed**. The two failures are the ones already known on untouched `origin/main` (0511).
- Screenshots of the Coding pop-out on Cost centre and on Project
  checked by eye.
