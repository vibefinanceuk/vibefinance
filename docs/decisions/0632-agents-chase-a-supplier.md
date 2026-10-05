# 0632: Agents phase 3, slice 2: chasing a supplier about a return with no reply

**Status: built and tested locally, not yet pushed or deployed.** It
touches `vf-app`, `vf-ui` and `vf-licence`. It needs **vf-app migration
`0136`** and **vf-licence migration `0277`** (strings). Deploy
vf-licence, then vf-app and vf-ui.

## What was asked

Slice 2 of phase 3 as agreed (0631): chase a supplier, in the AP team's
name and address. Dan, after 0631 went live: *"yes please"*.

## What was built

### A report: returned to the supplier, no reply

- `returned_no_reply` (AP.Analysis). It lists invoices returned to
  their supplier (decision 0498) more than `waitDays` ago (1–90,
  default 7), within the last 90 days, with **no corrected invoice
  since**. A corrected invoice is a later invoice with the same number
  from the same supplier: the matched supplier, or the same printed
  name where none is matched (`REPLY_ARRIVED_SQL`).
- Columns: organisation, invoice, supplier, returned, days since, why
  returned, total and currency.
- Invoice rows, so they open in Documents (0629).

### An action: a letter chasing the supplier

- **`chase_supplier`** needs **AP.ReturnToSupplier**, as Return To
  Supplier itself does, and is prepared by `returned_no_reply`. There is
  one letter per return, not again within 7 days. It lapses after 5
  working days, as every prepared action does.
- **Where it goes, never chosen by the AI.** It goes to the supplier's
  address on file, or failing that where the return itself was sent.
  With neither, nothing is prepared. It is copied to the AP team address
  (decision 0498's `ap_team_email`) where one is set.
- **In the supplier's language.** German for DE, AT and CH (BT-40),
  English otherwise. The subject and our own letter give the dates,
  total, return reason and the comment made when it was returned, and
  sign off as the company (the legal entity above the invoice's unit),
  Accounts Payable or Kreditorenbuchhaltung.
- **The AI only words it** (`agent-chase.ts`):
  - It is told to write the facts only as placeholders (`{invoice}`,
    `{returned}`, `{total}` and so on), and our code fills them in.
  - What comes back must use `{invoice}` and `{returned}` and no
    placeholder we do not have, and carry no digit, address or link of
    its own. Otherwise our own letter is used.
  - Each wording counts against the day's AI allowance (0626).
- **Approving:**
  - The approver may change the subject and letter.
  - It is refused if any number in it is not the invoice's own
    (`strayInChase`: the facts set aside, any digit left over), or if it
    carries an address or link.
  - It waits, untouched, where email is not set up.
  - It is checked again: if a corrected invoice has arrived (`replied`)
    or the supplier's address has changed (`address_changed`), it is not
    sent.
  - It is claimed before sending, so two people approving at once send
    it once.
  - It is sent through Resend from the app's address to the supplier,
    copied to the AP team, as text and HTML. A send that fails is marked
    `failed` (`send_failed`).
- **The invoice's Timeline** says *"Dan Young chased Lager Nord GmbH
  (billing@lager-nord.de), as an agent prepared"*, with the subject.

### Migration `0136`: the kinds of action leave the schema

0135 listed the kinds of action in CHECKs. A new kind would have meant
rebuilding `agents`, which many tables point to (0055 shows what that
takes). The code already checks every action against `AGENT_ACTIONS`,
so:

- `agents.action_kind` takes over from `agents.action`, its values
  copied across, and the old column is left unused;
- `agent_actions` is rebuilt without the list on `kind` (nothing points
  to it), its statuses still checked.

New kinds now need no migration of their own. A claimed but unfinished
action (being sent) is neither offered nor lapsed.

### vf-ui

- **The form** offers *Returned more than (days) ago*, and *Also
  prepare: a letter chasing the supplier for each return*.
- **For your approval** shows a chaser card:
  - who it is to and the copy;
  - the subject and letter to change, with how it was drafted;
  - **Approve and send** and Reject.

  A number not on the invoice is said and the card stays open to fix.
  Once it is sent, or cannot be, the card closes and says why.
- **Ready-made**: *Chase returned invoices*, every working day at 9am,
  preparing a chaser for each.
- **The Timeline** shows the chase line. Help lines 36 and 37.

## Not built (next slices)

Away and cover (3), send early to the ERP (4), tacit approval as a stage
policy (5). Resend's delivery events (0498's webhook) are not yet
followed for chasers.

## Verification

- **`vf-app`** `agents-chase.test.ts`, 6 tests:
  - the report: only returns older than the days, with no corrected
    invoice since; too recent and corrected ones left out;
  - a German letter to the address on file, copied to the AP team, with
    the facts in German forms and the comment from the return; an
    English one to where the return went when none is on file; nothing
    for someone without AP.ReturnToSupplier;
  - the AI's wording used around our facts; one with a number of its
    own refused for ours;
  - an edited letter with a stray number or an address refused; a kind
    one sent with the copy, in text and HTML; the Timeline line; decided
    once only;
  - not sent after a corrected invoice arrived, or the address changed;
  - waiting untouched where email is not set up.
- **`vf-ui`** browser `agents.test.ts`, 3 new: the chaser card, kept
  open on a stray number; sent, and where; the ready-made one with its
  action.
- **Full runs**:
  - vf-app 3569, of which 3567 pass (the two known failures);
  - vf-ui browser 1546, of which 1545 pass (the known
    `typography.test.ts` 10px gap), with the same 331 unhandled errors;
    worker 111 of 111;
  - vf-licence 361 of 361.

  **Migrations** replay: vf-app 136, vf-licence 277.
