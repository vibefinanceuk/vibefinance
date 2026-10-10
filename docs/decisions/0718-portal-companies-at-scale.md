# 0718: Changing a supplier person's companies in place, and many companies kept manageable

**Status: built**, not yet deployed. vf-ui (`suppliers.js`, `app.css`); vf-portal
(`portal.js`); vf-licence migration `0324_portal_companies_strings.sql`. No vf-app or
vf-licence code change: the routes already existed (0713, 0715).

## What was asked

Dan, 10 October 2026, after testing the network end to end (an invoice did not show until
he re-invited himself for the company it was in):

> Can you implement the small improvements, 1 and 2. I'd like to think about how we present
> this in the supplier UI. If we have 10+ orgs, it might become difficult to see / manage in
> the current format.

1 was *Change companies* beside a linked person; 2 was saying, on an empty network list,
which companies it covers.

## What changed

**On a supplier's page (vf-ui):**

- **Change companies** beside each linked person (for `Supplier.Maintain`). It opens the
  company picker under the row with their companies ticked; *Save* replaces them
  (`POST /suppliers/:id/portal/links/:id/companies`, 0715); no new invitation or acceptance.
  The same limits hold: only companies the person holds `Supplier.Maintain` in, never none.
- **Companies said briefly.** Up to three by name; past that, the first two and *"+ 5
  more"*, with every name on hover. A person linked to twelve companies is still one line.
- **One company picker, for inviting and changing.** Six companies or fewer: a box each, as
  before. More: a *Find a company* search, *Select all shown*, *Clear*, a list that scrolls
  (about seven rows high) and *"7 of 12 chosen"*. Selecting all shown after a search picks
  just those, so "every Acme company in Germany" is two actions.
- The help line no longer says to invite again to change companies.

**On the supplier network (vf-portal):**

- An empty list says why. With a search or status chosen: *"No invoices match your search."*
  Without: *"No invoices yet for the companies you can see: Acme Corp: Acme GmbH"*, since an
  invoice for any other company is not shared.
- The customers line names up to three companies per customer; past that, *"Acme Corp (12
  companies)"*, with every company on hover.

## Tests

vf-ui `suppliers.test.ts` (3 new, 2 updated): a long company list as one line with all on
hover; the picker past six companies (search, Select all shown, the count, the invitation
sent with just those); Change companies opening with the person's companies ticked and saving
the new set. vf-licence: the 12 new strings in coverage. The network's empty state was checked
by hand against a mocked API; vf-portal's pages have no browser tests yet (0717).
