# 0635: Agents ask the data: a question read as the model wrote it, and put right once

**Status: built and tested locally, not yet pushed or deployed.** It
touches `vf-app`, `vf-ui` and `vf-licence`. It needs **vf-licence
migration `0280`** (strings) and no vf-app migration. Deploy vf-licence,
then vf-app and vf-ui.

## What was asked

After 0634 went live, Dan tried his Monday words again, *"Every Monday at
12.10pm, check for invoices over £100,000 and email"*:

> *"I'm not experiencing the behaviour of a 'to write a question', rather
> it seems to insist on a report being selected."*

His screenshot showed what happened:

- The model did write a question, but our check refused its filter on the
  total. The plan said *Could not ask about "total": it is not something
  an agent can ask about here*, and the report was left unchosen.
- That refusal was right to leave the report unchosen (0634: never
  approximate). Its words were wrong, though: the total can be asked
  about. What failed was how the amount or its currency was written (a
  number with a separate `currency` code is all 0633 accepted), and the
  model had no second chance.
- The plan's *Narrowed* line still showed *highlighted past 60 days*. That
  came from the form's previous report, though no report had been
  chosen.

## What was built

### Reading an amount as written (`agent-query.ts`)

- **`readAmount`** accepts an amount however a model may write it, when
  its currency is plain:
  - `100000`, `"100000"`, `"100,000"`;
  - `"£100,000"`, `"100000 GBP"`;
  - `"100k"`, `"1.5m"`;
  - `{"amount": 100000, "currency": "GBP"}`.
- **`currencyCode`** accepts `"GBP"`, `"gbp"` or a symbol (£, €, $, ¥).
- The currency comes from the filter, or failing that from the amount. An
  amount with no currency anywhere is still refused, since money is never
  compared across currencies (0633). What is kept is always the plain
  form: a number and a code.

### Put right once (`agent-understand.ts`)

- When our check refuses the model's question, the model is asked **once
  more**, with its answer, the checker's reason and the part, and told
  how money is written. The corrected answer is checked as before. If it
  still fails, it is refused in words. There is never a third try, and
  the second costs one more call.
- The prompt gains a worked example of a money filter.

### Saying what went wrong

- **A new refusal, `question_unclear`**, is for a part that is in the
  catalogue but written so it cannot be read: a value, an operator or a
  currency. It names the part by its meaning (*"the total including
  VAT"*) and suggests saying it with the amount and its currency.
- `cannot_ask` is kept for fields and datasets that are not there.
- **The plan's *Narrowed* line** says *Follows from the report* while no
  report is chosen, rather than the previous report's options.
- **vf-licence `0280`** has both lines in English and German.

## Verification

- **`vf-app`** `agents-query-words.test.ts`, 2 new tests and 1 changed:
  - the same filter written four ways (`"£100,000"`, an object,
    `"100k"` with `£`, `"100000 GBP"`) is read as 100,000 GBP each time;
  - a question with an unknown field is sent back once with the reason,
    and the corrected answer is used;
  - an amount with no currency anywhere is refused, after the retry, as
    `question_unclear` naming the total by its meaning.
- **`vf-ui`** browser `agents.test.ts`, 1 new test: the unclear part in
  words, and *Follows from the report* with no report chosen.
- **Full runs**:
  - vf-app 3586, of which 3584 pass (the two known failures);
  - vf-ui browser 1549, of which 1548 pass (the known
    `typography.test.ts` 10px gap), with the same 331 unhandled errors;
    worker 111 of 111;
  - vf-licence 361 of 361.

  **Migrations** replay: vf-licence 280.
