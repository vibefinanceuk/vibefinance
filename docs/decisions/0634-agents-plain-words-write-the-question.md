# 0634: Agents ask the data, slice 2: plain words write the question

**Status: built and tested locally, not yet pushed or deployed.** It
touches `vf-app`, `vf-ui` and `vf-licence`. It needs **vf-licence
migration `0279`** (strings) and no vf-app migration. Deploy vf-licence,
then vf-app and vf-ui.

## What was asked

Slice 2 of the query layer as agreed (0633): plain words write the
question. Dan, after 0633 went live: *"yes, please proceed"*.

This also settles his earlier point: *"Every Monday at 12.10pm, check for
invoices over £100,000 and email"* became Outstanding payables. That
report's minimum is per supplier and in any currency, and its highlight
was a default nobody had said. Nothing told him so.

## What was built

### Understand (`agent-understand.ts`)

- **The model is shown what this person may ask about**
  (`catalogueWords`):
  - each dataset and field, with its kind, whether it can be grouped by,
    and what it means in plain English. The meaning is new, as `words` on
    each catalogue field;
  - only datasets whose permission they hold somewhere;
  - no field an administrator has hidden.

  Someone who may analyse nothing is told there is nothing to ask.
- **It is told to use a ready-made report only when it answers exactly as
  asked**: per invoice rather than per supplier, a currency, a status, a
  stage, a date, a person or an amount. Otherwise it writes a question
  (`"report": "query"`), the query shape and the operators by kind are
  given, and it is told plainly: *"Never approximate."* Money always
  names its currency (£ is GBP). For invoices, unless the words say
  otherwise, it asks only those still being processed and says so.
- **Our code checks the question as a saved one would be checked**
  (`checkQuery`, then hidden fields, then whether the dataset is one this
  person may ask about). A question that fails is **not** turned into
  something near it:
  - the report is left unchosen, and the plan says it still needs one;
  - a refusal `cannot_ask` names the part: the field, or "an amount with
    no currency", or "a field hidden here".
- **Organisations** are those where the person holds the dataset's
  permission, as for any report.
- **What was not said is marked** (`assumed`):
  - for a question:
    - the parts the model says it chose itself (a status, the order);
    - "everything" or "only what is new", and the limit, when the words
      did not say;
    - what our check added itself, such as grouping by currency or a
      count;
  - for a ready-made report: each option the words did not give, such as
    Outstanding payables' highlight.
- **A new refusal, `approximate`**, lets the model say a part can only be
  answered nearly.
- **`GET /agents`** also returns the catalogue, so the screen can say a
  question in words.

### The plan in words (vf-ui `agents.js`)

- **`queryWords`** says a question part by part, and each part the words
  did not say carries **(usual)**:
  - the dataset and its filters ("Invoices where Total is over 100,000.00
    GBP and Status is In process (usual)");
  - everything or only what is new;
  - the columns, or the grouping with its measures;
  - the order and the limit.
- **A ready-made report's** highlight, days and the like are marked
  (usual) where they were not said.
- **Edit steps** lists the report as *Your own question* while the draft
  is one. It shows the question in words, and it is changed by changing
  the words and choosing Understand again. The builder is slice 3.
- **Save** sends `report: "query"` with the question in its options. A new
  report or question from Understand drops an action the old report
  prepared.
- **Help lines 38 and 39.** vf-licence `0279` has the words in English
  and German.

## Not built (next slices)

- The query builder in Edit steps (3).
- The other datasets and joins (4).
- Events, actions, the licence switch and daily allowance, indexes, and
  moving the simple reports (5).

## Verification

- **`vf-app`** `agents-query-words.test.ts`, 5 tests:
  - Dan's Monday words: a question per invoice, over 100,000 GBP, still in
    process. Its usual parts are marked. The model was shown the
    catalogue and told never to approximate. Saved as drafted;
  - a field not in the catalogue, and an amount with no currency: refused
    in words, with no report chosen;
  - Uma's organisations only. Ned has nothing to ask and is refused. A
    hidden field is neither shown to the model nor asked about;
  - a ready-made report's unsaid option is marked usual, and the model's
    `approximate` is kept;
  - the catalogue with each field's meaning on `GET /agents`.

  `agents-understand.test.ts` now expects the `assumed` list.
- **`vf-ui`** browser `agents.test.ts`, 1 new test:
  - the question in words, with (usual) where it applies;
  - the refusal;
  - Edit steps showing *Your own question* and the question;
  - Save sending it.
- **Full runs**:
  - vf-app 3584, of which 3582 pass (the two known failures);
  - vf-ui browser 1548, of which 1547 pass (the known
    `typography.test.ts` 10px gap), with the same 331 unhandled errors;
    worker 111 of 111 (0633's record said 113 and is corrected);
  - vf-licence 361 of 361.

  **Migrations** replay: vf-licence 279.
