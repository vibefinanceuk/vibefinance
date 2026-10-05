# 0637: Agents ask the data, slice 4: the other datasets, each by its own permission

**Status: built and tested locally, not yet pushed or deployed.** It
touches `vf-app`, `vf-ui` and `vf-licence`. It needs **vf-licence
migration `0282`** (strings) and no vf-app migration. Deploy vf-licence,
then vf-app and vf-ui.

## What was asked

Slice 4 of the query layer as agreed (0633): the other datasets and their
joins. Dan, after 0636 went live: *"please go ahead with the next slice -
4"*.

## What was built

### Eight more datasets (`agent-query.ts`)

Each dataset needs the permission of the screen that shows the same
thing, and is scoped as that screen scopes it.

| Dataset | One row is | Needs | Scoped by |
|---|---|---|---|
| `lines` | an invoice line | AP.Analysis | its invoice's organisation |
| `coding` | a coding split of a line | AP.Analysis | its invoice's organisation |
| `stage_visits` | a time an invoice was at a stage | AP.Analysis | its invoice's organisation |
| `returns` | an invoice returned to its supplier | AP.Analysis | its invoice's organisation |
| `suppliers` | a supplier on file | AP.Supplier | the supplier's organisation, as Suppliers (0317) |
| `purchase_orders` | an order line | AP.Validate | the order's organisation, as Purchase Orders (0374) |
| `deliveries` | an invoice's delivery to a destination | Integration.Monitor | its invoice's organisation |
| `files` | a file received | Integration.Monitor | none: files belong to no organisation |

What each offers:

- **Lines**: description, item, net amount, VAT rate, the cost centre as
  received, and the purchase order it is paired with.
- **Coding**: GL code, cost centre, project, amount and the line's
  description. This is spend by GL code, cost centre or project.
- **Stage visits**: the stage, when the invoice reached it, when it moved
  on, days there (until now while still there), and the outcome.
- **Returns**: when the invoice was returned, days since, the reason and
  the comment. Also whether a corrected invoice has arrived, which uses
  the same test as decision 0632. That test, `REPLY_ARRIVED_SQL`, now
  lives here and `agents.ts` re-exports it.
- **Suppliers**: name, ERP identifier, VAT number, country, city, status,
  on hold and why, payment terms, and matching.
- **Purchase orders**: order, date, supplier, status, item, amount,
  currency, and whether an invoice line is paired with it.
- **Deliveries**: destination, status, when queued, when delivered, and
  the last error.
- **Files**: when received, from whom, the subject, status, where it
  failed, and the error.

**The joins are ours.** Lines, coding, stage visits, returns and
deliveries also offer their invoice's own fields: number, supplier,
currency, date, received, status and stage (`invoiceFields`). These come
through one fixed join to the invoice, never one the AI makes.

**What the datasets themselves can do:**

- A dataset may have a fixed condition, such as "a return is a returned
  process", and may have no organisation scope.
- A dataset may have no record of when a row arrived. For those,
  "only what is new" is refused (`query_since_invalid`), and the builder
  does not offer it.

**Fields that never count across organisations.** No dataset offers
counts or sums drawn from another dataset (for example, invoices per
supplier). Each such count would need its own scoping, so a person asks
for invoices grouped by supplier instead.

**Data with no organisation (files)** is asked once, and only by someone
holding the permission somewhere. Its table has no organisation column.

### Each agent by its dataset's permission (`agents.ts`)

- **`permissionOf(report, options)`** gives the permission a question
  needs: its dataset's. Otherwise it is the report's own permission.
- **Saving checks the organisations against it.** Sam, who sees
  suppliers in Germany only, may save a suppliers question for Germany
  and is refused for the UK.
- **Each run checks the author's organisations and each recipient's copy
  against it**, as for any report.
- **The catalogue gives each dataset its organisations**, and whether
  "only what is new" can be asked of it. *Your own question* is offered
  wherever any dataset may be asked about.

### Plain words and the builder

- **The model is told what one row of each dataset is**, and which
  datasets do not take "only what is new".
- **The organisations offered** include those where only a dataset may be
  asked about, such as Sam's suppliers. A question's organisations are
  its dataset's.
- **In the builder**, choosing a dataset keeps only the organisations
  where it may be asked about, and offers "only what is new" only where
  it can be.

### Words

- The datasets, 28 new column labels, and the values of supplier status,
  matching, order status, delivery status and file status, on screen
  (vf-licence `0282`) and in the email, in English and German.
- **Help line 41.**

## Not built (next slice)

Slice 5:

- event agents and prepared actions on a question;
- the licence switch and daily allowance;
- indexes where runs are slow;
- moving the simple reports onto questions.

## Verification

- **`vf-app`** `agents-query-datasets.test.ts`, 9 tests:
  - coding added up by GL code per organisation and currency, with
    Documents ids;
  - lines with their invoice's fields and paired order, for Uma's UK only;
  - days at each stage, the current one counted to now;
  - a return with no reply;
  - suppliers for Sam's Germany only, and none for Uma, who lacks
    AP.Supplier;
  - purchase order lines with their supplier and whether they are
    invoiced;
  - deliveries and files for Ivy, files with no organisation column, and
    none for Uma;
  - "only what is new" refused for suppliers;
  - each person's catalogue (Sam: suppliers in Germany; Ivy: deliveries
    and files; Dan: all ten). *Your own question* is offered to Sam for
    Germany;
  - a suppliers agent saved by Sam for Germany, and refused for the UK.
- **`vf-ui`** browser `agents.test.ts`, 1 new test: a dataset's own
  organisations and no "only what is new" in the builder.
- `agents-query.test.ts` and `agents-query-words.test.ts` now expect all
  six AP.Analysis datasets in Dan's catalogue.
- **Full runs**:
  - vf-app 3595, of which 3593 pass (the two known failures, with those
    two expectations updated and rerun);
  - vf-ui browser 1552, of which 1551 pass (the known
    `typography.test.ts` 10px gap), with the same 331 unhandled errors;
    worker 111 of 111;
  - vf-licence 361 of 361.

  **Migrations** replay: vf-licence 282.
