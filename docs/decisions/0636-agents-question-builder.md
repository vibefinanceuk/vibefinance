# 0636: Agents ask the data, slice 3: the question builder in Edit steps, and Try it now

**Status: built and tested locally, not yet pushed or deployed.** It
touches `vf-ui` and `vf-licence`. It needs **vf-licence migration `0281`**
(strings) and no vf-app change: the catalogue, the check and Try already
exist (0633, 0634). Deploy vf-licence, then vf-ui.

## What was asked

Slice 3 of the query layer as agreed (0633): the query builder in Edit
steps, with Try it now. Dan, once 0635 was live and his Monday words came
back as a question: *"that worked - please go ahead with slice 3"*.

## What was built (vf-ui `agents.js`)

- **The question can be chosen from the form.** *Your own question* is
  now in the report list wherever the person has something to ask about.
  Choosing it starts a question of the first dataset, with its first four
  columns and nothing narrowed (`startingQuestion`).
- **The builder**, under the question in words in Edit steps. Every pick
  comes from the catalogue `GET /agents` returns: this person's datasets
  and fields, with hidden ones left out.
  - **Ask about**: the dataset. Changing it starts again.
  - **Which**: everything that matches, or only what is new since the
    last run.
  - **Where**: conditions, each a field, an operator that suits it, and a
    value that suits both:
    - text, or a list separated by commas;
    - a closed set's values in words, ticked for *is one of*;
    - an amount with a three-letter currency (GBP unless changed);
    - days;
    - a date, or a number of days for *in the last* / *more than … ago*;
    - two values for *between*.

    *Add a condition* and *Remove*.
  - **Show**: one row each (tick the columns), or grouped with totals (up
    to two fields to group by, and for each group: count, or each amount,
    days or date field added up, averaged, lowest or highest, earliest or
    latest).
  - **Order**: a column shown, or a measure, largest or smallest first.
  - **At most** so many rows.
- **The question in words follows the builder as it is typed in**, so the
  plan and the builder never disagree. Typing does not redraw the field
  being typed in.
- **Try it now** sends the question and the organisations chosen to
  `POST /agent-query/try` (0633):
  - it runs with the person's **own access**, saving nothing;
  - it shows how many rows there are and the first 20, in the same table
    as an agent's note;
  - a question that cannot be asked is said in words (`agents.error.query_*`,
    one for each refusal the check gives).

  Any change of shape clears the last try.
- **Save** sends the question as built. The server checks it again, as it
  does on Try.
- The hint under the question says it can be changed here, or by changing
  the words. **Help line 40.**
- **vf-licence `0281`** has the builder's words, the operators and the
  refusals in English and German.

## Not built (next slices)

- The other datasets and their joins (4).
- Events, actions, the licence switch and daily allowance, indexes, and
  moving the simple reports (5).

## Verification

- **`vf-ui`** browser `agents.test.ts`, 2 new tests:
  - *Your own question* chosen from the form;
  - a condition built (Total over 100,000, with "gbp" typed and kept as
    GBP), and the words following it;
  - Try it now sending the question and organisations, then showing the
    count and the rows;
  - switching to grouped (by supplier, with a count);
  - Save sending exactly that.

  The second test says why a tried question cannot be asked. The form's
  report list now includes *Your own question*.
- **Full runs**:
  - vf-ui browser 1551, of which 1550 pass (the known
    `typography.test.ts` 10px gap), with the same 331 unhandled errors;
    worker 111 of 111;
  - vf-licence 361 of 361;
  - vf-app is unchanged since 0635 (3586, of which 3584 pass).

  **Migrations** replay: vf-licence 281.
