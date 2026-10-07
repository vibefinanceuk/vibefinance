# 0669: AP Setup's Save, and the coding lists' actions, as an icon with its word

**Status: built and tested locally, not yet pushed or deployed.** It is
`vf-ui` only, with no migration. Deploy vf-ui.

## What was asked

Dan, 7 October 2026:

> On the AP Setup screen, please can you change the Save button to be
> smaller, with text to the right on the Matching, Account Coding and
> Approval Hierarchy tabs. In the account coding tab, another tab
> emerges - please can you update the buttons / icons in the Cost
> Center, Project Commodity Code and General Ledger Code tabs. Each
> contains a CSV Template, Load CSV and Add button.

## What was built

These are now `compactLink`s (0662): a 16px icon with its word, softer
at rest and brighter on hover (0664).

| Where | Action | Icon |
| --- | --- | --- |
| Matching | Save (the tolerances) | `save` |
| Account Coding | Save (Cost centre and project) | `save` |
| Approval Hierarchy | Save (the mode and Default Approver) | `save` |
| Cost Centre, Project, Commodity Code, General Ledger Code | CSV Template | `download` |
| Cost Centre, Project, Commodity Code, General Ledger Code | Load CSV | `load` |
| Cost Centre, Project, Commodity Code, General Ledger Code | **Add** | `addcard`, a plus |

**Add's icon changed.** It used `create`, an arrow into a tray, which
read as a download once drawn small beside its word. Add now uses the
plus already used for adding a card or setting something up.

**Left as they were:**

- The other actions on these tabs: Approval Hierarchy's override rows,
  Return Reasons, and Stage Restrictions.
- The pop-out forms' Save, Create and Close.

They can follow if wanted.

## Verification

- **`vf-ui`** browser:
  - `ap-setup.test.ts`: Matching, Account Coding and Approval Hierarchy
    each draw a compact Save;
  - `coding-lists.test.ts`: on Cost Centre, Project, Commodity Code and
    General Ledger Code, CSV Template, Load CSV and Add are each compact,
    beginning with its icon.
  - All 115 tests of the two files pass.
- **Screenshots** of Matching and of Account Coding's Cost Centre tab,
  in Day and Night.
- **Full run**: vf-ui browser 1617, of which 1616 pass (the known
  `typography.test.ts` 10px gap).
