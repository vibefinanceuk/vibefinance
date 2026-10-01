# 0584: `intake.source` — which source an invoice arrived through, for rules

**Status: built and tested locally, not yet pushed or deployed.** It
touches `shared` and `vf-app`, and needs **`vf-app` migration `0117`**.
There is no `vf-ui` or `vf-licence` change.

## What was asked

0583 found that a rule cannot tell which source a read invoice came
from. `mandate.channel` is the structural channel ("Structured XML",
"Image") for anything that was read, and the source's name only for a
document nothing could read. Dan: *"I would like that you add a fact
that records each invoice's source. It might be useful to have a rule
like you mentioned - rules such as 'invoices from the UK mailbox go to
Anna'"*.

## What was decided

### The fact

**`intake.source`** is the **id** of the source the invoice arrived
through: a mailbox, AP upload, or an HTTPS source. It is text, in the
invoice vocabulary beside `intake.format`. It is the id, not the name,
so renaming a source (0582, 0583) never changes what a rule matches.

It is set by `buildIntakeEnricher`, which every capture through a
source passes through:

- XML;
- Factur-X;
- a supplier's mapped XML or CSV;
- batch rows;
- images;
- a document nothing could read;
- an invoice keyed by hand;
- reading again with a newer mapping.

The other enriched facts (supplier, org) are worked out again whenever
a rule asks. This one cannot change, so `handleCaptureIntake` also
**stores it in `facts_json`**, for rules at any later stage.

**Migration `0117`** fills it in on invoices already received, from the
route message that made them (0555, 0571), where that message arrived
on a source. Invoices from before route messages, or made with no
message, are left without it.

### The compiler

The compiler is shown, as it is already shown teams and stages:

- **REAL SOURCES**: every source not retired, by id, name and how it
  arrives. It is told to test `intake.source` against the matching id,
  by meaning ("the UK mailbox"), never `mandate.channel`, and to refuse
  rather than invent an id;
- **REAL PEOPLE**: `org_users` by id and name. `assign_task` already
  took `{ "user": … }`, but the compiler had never been shown any users.
  "Goes to Anna" now resolves to her id, or is refused when nobody, or
  more than one person, matches.

After compiling, a rule whose `intake.source` names an id that is not a
source is **refused**, with the sources it could name (`sourceValues`).
Otherwise it would compile, activate and never fire, as 0148 warns.

`mandate.channel` is unchanged, and its description now points to
`intake.source` for "from a source".

## Not built

- **Showing a rule's source by name** in places that print the compiled
  condition. Rules are listed by the sentence the person wrote, which
  names the source. The compiled form holds the id.
- **Refusing to retire a source a rule names.** The rule simply stops
  matching anything new, which is what retiring means.

## Verification

- **`shared`**, `prompt.test.ts`, 3 new tests:
  - sources and people are listed by id and name;
  - the model is told to test `intake.source`, not `mandate.channel`;
  - `intake.source` is described in the vocabulary;
  - nothing is added where none are given.

  `compiler` and `interpreter`: 164 of 164. Full `shared`: 403, of which
  399 pass, 1 skipped (the three known failures).
- **`vf-app`**:
  - `source-capture.test.ts`, 3 new tests:
    - `intake.source` is on XML, an image, an unreadable document and a
      keyed invoice, while `mandate_channel` stays "Structured XML";
    - it stays the source's id after a rename;
    - migration `0117` fills it from the message's source, leaves a
      message with no source alone, and changes nothing when run again.

    2 fail against the code before this change.
  - `compile-route.test.ts`, 2 new tests:
    - the prompt lists live sources (a retired one left out) and people;
    - a rule testing a name, or an unknown id, for `intake.source` is
      refused, naming the sources, and nothing is stored.

    Both fail against the route before this change.

  With `https-in` and `supplier-mappings`: 84 of 84.
- **Migrations** replay 117.
- **Full `vf-app` run**: 3373 tests, of which 3371 pass (the two known
  failures, 0511).
