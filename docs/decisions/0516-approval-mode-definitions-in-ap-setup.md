# 0516 — Each approval mode's definition, shown in AP Setup

**Status: built and tested locally, not yet pushed or deployed.** This
session has no push access, so it is delivered as a git bundle. It
touches `vf-ui` and `vf-licence`, and needs `vf-licence` migration
`0181` applied as its own step. There is no `vf-app` change.

## What was asked

> Can we look at the "Route To Approver" conditions. I would like the
> following definitions to be highlighted in the AP Setup, to define
> the approval configuration options

The operator supplied four definitions: Manual, Cost Object,
Organisational Approval (Employee Supervisor), and API. They are
recorded verbatim in migration `0181`.

## What was decided

- **Under AP Setup's Approval Hierarchy mode picker, all four
  definitions are listed** (`modeForm` in `ap-setup.js`). The one
  currently selected is highlighted, using the accent border and
  background tokens, and the others are muted. The highlight follows
  the picker as it changes, before Save, so the choice is made with
  every alternative in view.
- **The text is the operator's own**, with "third part" corrected to
  "third-party". It has German translations.
- **Two labels are renamed to the operator's headings**: "Organisational
  Approval (Employee Supervisor)" and "Cost Object". Manual and API
  keep their labels.

## How far each definition is true today

This change only displays the definitions. Where the running system
differs from a definition, that difference is recorded here rather than
hidden.

- **Cost Object: matches.** One task per coded, enabled dimension
  (0452). The owner comes from the coding lists, and every task must be
  completed before the stage advances.
- **Organisational Approval: mostly matches.** It walks up the
  supervisor chain until someone's limit covers the amount (0439).
  There are two differences:
  - It assigns **one** task, straight to that person. The people below
    them in the chain are not each asked to approve in turn.
  - It starts from the person who coded the line, so a coder whose
    limit covers the amount gets the task themselves. 0513's exclusions
    don't reach this mode.
- **Manual: partly true.** The submitter chooses from the users who
  hold the permission at the invoice's org (0512/0513). **The chosen
  user's approval limit is not checked**, and the chosen user cannot
  route it on.
- **API: not built.** No `awaiting_approval_api` tag and no API exist
  yet. An invoice in API mode goes to the Default Approver, as it
  always has.

## What was verified

- **New `ap-setup.test.ts` test:** all four definitions are listed in
  mode order, the configured mode is the only one highlighted, and the
  highlight moves with the picker. It **failed** with `ap-setup.js`
  stashed. The file passes 77/77.
- **`vf-licence`:** 320/320, including `string-coverage.test.ts` with
  the four new keys.
- **`npx eslint`** on `ap-setup.js`: clean.
