# 0642: Absence moves to the top bar

**Status: built and tested locally, not yet pushed or deployed.** It
touches `vf-ui`, `vf-app` (one field on `/whoami`) and `vf-licence`
(strings, migration `0286`). Deploy vf-licence, then vf-app and vf-ui.

## What was asked

After 0641 went live, Dan:

> *"My only comment about Absence is that it transcends workflows, and
> applies to AP, AR and Expense. When we eventually have all three. Does
> it make more sense to have the Absence icon on the top right bar?"*

I agreed and proposed the change below. Dan: *"yes please"*.

## What was built

- **Absence leaves the Accounts payable menu** and joins the top bar,
  with Night or Day, the organisation, the language, Help, Ask and Sign
  out. It sits just before the language.
  - It is offered to the same people as before: anyone who works tasks
    (AP.TaskView) and AP Managers.
  - The menu is back to how it was before 0641.
- **The button says the person's state:**
  - *Absence*;
  - *Away* while they are, with *Away until …* as its tooltip, in the
    warning colour;
  - *Covering* while someone's tasks are with them, in the accent colour.
- **The state comes from `/whoami`**, so every screen's top bar knows it
  without a request of its own: `absence: { awayUntil, covering }`, from
  `absenceStatus` in `absence.ts`. The Absence screen updates it when it
  loads or anything changes, so the button follows at once.
- **Nothing else changes.** The screen, the team panel, the rules and the
  Timeline lines are as in 0641.
- **AR and Expense, when they come.** The tasks an absence passes are the
  shared `tasks` table, so their tasks will pass the same way. Only the
  approval-limit check is AP's, and their own will be needed.
- vf-licence `0286` has the button's words in English and German.

## Verification

- **`vf-app`** `absences.test.ts`: `absenceStatus` says Uma is away until
  Thursday, and Ben covers one. The whoami and session tests pass
  unchanged (36 with the absence tests).
- **`vf-ui`** browser `absence.test.ts`:
  - the button in the top bar and not in the menu;
  - *Away* with its tooltip;
  - *Covering*.

  The navigation tests are back to the menu as it was before 0641.
- **Full runs**:
  - vf-ui browser 1559, of which 1558 pass (the known
    `typography.test.ts` 10px gap), with the same 331 unhandled errors;
    worker 111 of 111;
  - vf-licence 362 of 362.
  - vf-app's full run is not repeated for one field; it was 3605, of
    which 3603 passed, at 0641.
