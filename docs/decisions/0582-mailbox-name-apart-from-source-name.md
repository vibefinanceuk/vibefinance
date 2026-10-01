# 0582: An email source's mailbox name is chosen apart from its name

**Status: built and tested locally, not yet pushed or deployed.** It
touches `vf-app`, `vf-ui` and `vf-licence`, and needs **`vf-licence`
migration `0230`**. There is no `vf-app` migration.

## What was asked

On 1 October Dan asked:

> *"Today I think the Source name is directly transposed as the email
> address that is created. This makes the Source name in the Process
> route screen a little bit abstract. Would it be possible to Introduce
> a Source Name which is displayed purely for information purposes and
> an email address username which is freeform, with company name"*

## What was decided

### The mailbox name is chosen, the company part stays

Decision 0126 derived the address as `<name>.<customer>@<domain>` and
gave the reason why it is not chosen freely: every customer shares the
domain. The `.<customer>` suffix is what makes a clash impossible
without a registry. It also stays the same from trial to production
(0118).

So the suffix stays, and **the part before it is the customer's to
choose**:

- `POST /sources/:id/email` takes an optional `{ mailbox }`. Without
  one, the source's name is used, as before, so the older Sources
  screen behaves unchanged.
- `mailboxName` reduces it as names always were (accents folded, `ß` to
  `ss`, anything else to `-`), but **keeps single dots between words**:
  `Accounts.Payable` becomes `accounts.payable`. A name with no dots
  reduces exactly as before.
- `GET /sources/:id/email?mailbox=` **previews** the address, or why not,
  before anything is issued:
  - `address_taken`, when another of this customer's sources has it;
  - `name_unusable`, when there are no letters or the address would pass
    64 characters before the `@`;
  - `address_issued`, when the source already has one.

  An address is still never changed once issued.

### On Process routes

**Create address** opens a pop-out instead of issuing at once:

- it says the address cannot be changed, so choose with care, and that
  the source's name is only what people read, renamable until invoices
  arrive through it;
- **Mailbox name** is prefilled from the source's name and editable;
- **The address will be** shows the full address, checked as it is typed
  (250 ms after the last keystroke, a later answer replacing an
  earlier one), with the reason in words when it cannot be used;
- Create address issues the mailbox name shown.

### Renaming

A source with an address can now be **renamed**, and the address stays.
Renaming was refused because the address was derived from the name
(0130). It no longer is.

Renaming is **still refused once a document has arrived**, as 0130
decided. Each invoice records the source's name as `mandate.channel`,
and rules can be written against it. So a source like Dan's "test",
which has received invoices, keeps its name.

`vf-licence` `0230` adds the strings and updates the screen's help.

## Not built

- **Renaming a source that has received invoices.** It needs invoices
  and rules to refer to the source by its id rather than its name.
  That is a separate change.
- **A company part the customer chooses**, such as `.acmeuk`. It needs a
  register across customers in `vf-licence` to keep it unique.
- **Receiving on the customer's own domain.** Forwarding a mailbox on
  their domain to this address already works, with nothing built.

## Verification

- **`vf-app`**, `source-email.test.ts`:
  - 4 new tests:
    - the chosen mailbox name is issued with `.acme`;
    - `mailboxName` keeps dots, folds accents and `ß`, and leaves
      dot-free names as before;
    - with no mailbox name, the source's name is used;
    - the preview gives the address, or `address_taken`,
      `name_unusable` or `address_issued`, issues nothing, and gives 404
      for an unknown source.
  - "refuses once an address exists" became "renames one with an
    address, and the address stays".
  - The test that responses carry codes, not prose, drops the rename,
    which now succeeds.

  4 fail against the code before this change. 39 of 39 in the file.
- **`vf-ui`**, `routes.test.ts`, 1 new test and 1 updated, with the real
  strings:
  - the pop-out is prefilled `new-box`;
  - it previews as typed and says when the address is taken;
  - `UK.Invoices` previews as `uk.invoices.acme@…`, and Create address
    posts `{ mailbox: "UK.Invoices" }`;
  - Create address no longer issues at once.

  2 fail against the interface before this change.
- **`vf-licence`** migrations replay 230.
- **Full runs**, with 0581 and 0582 together: `vf-app` 3366 tests, of
  which 3364 pass (the two known failures, 0511). `vf-ui` browser 1402 of
  1403 (the known `typography.test.ts` 10px gap), worker 89 of 89.
  `vf-licence` 322 of 322.
