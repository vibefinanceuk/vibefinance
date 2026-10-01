# 0583: A source can be renamed after invoices arrive, unless a rule names it

**Status: built and tested locally, not yet pushed or deployed.** It
touches `vf-app`, `vf-ui` and `vf-licence`, and needs **`vf-licence`
migration `0231`**. There is no `vf-app` migration.

## What was asked

0582 separated an email source's address from its name, but a source
that had received anything still could not be renamed (0130). Dan's
"test" source, with invoices, kept its name. He asked: *"Can you look at
Renaming sources that have received invoices"*.

## What I found

0130 refused the rename because a document records the source's name
as `mandate.channel`, and a rule written against the old name would
stop matching new documents. Looking at what capture actually writes,
that is narrower than 0130 assumed:

- a document that **was read** (XML, an image, a PDF) records its
  structural intake channel, such as "Structured XML" or "Image", not
  the source's name;
- only a document **nothing could read**, or one keyed by hand, records
  the source's name (`captureWithoutFacts`).

And 0130's check also refused any source with any route message (0557),
so in practice every working source was frozen. The real risk is a rule,
and rules can be checked directly. They are the only stored conditions
(`rule_versions.compiled_json`).

## What was decided

`PATCH /sources/:id` `{ name }` now renames a source whatever has
arrived through it. It refuses (409) only:

- **`rule_names_source`** — a current rule version (not yet ended,
  enabled or not) whose compiled condition tests `mandate.channel` and
  contains the source's current name as a value, in any case. The reply
  lists those rules by id and name (`rulesNamingChannel`). Change or end
  them, then rename;
- **`name_taken`** — another source in the same process has that name,
  in any case. Before, this reached the UNIQUE constraint.

What a rename does **not** change:

- documents already received keep the `mandate.channel` they arrived
  under. It is history, like an email's subject;
- the address (0582), the source's id, and its route messages.

The check is deliberately cautious. A rule that tests `mandate.channel`
and also mentions the name elsewhere is counted too, since saying so is
cheaper than a rule silently matching less.

**The rename pop-out** now says what a rename changes: the name is what
people read, the address never changes, and invoices keep the name they
arrived under. Refused, it names the rules, or says another source has
the name. `vf-licence` `0231` adds the strings, and corrects 0582's
Create the address text, which said a source could be renamed only
until invoices arrived.

Retiring and deleting (0130) are unchanged. A source anything arrived
through is still retired, never deleted.

## Not built

- **A source fact for rules.** A rule cannot test which source a read
  invoice came from, because `mandate.channel` is the structural
  channel for those. A stable `intake.source` fact (the source's id)
  would let rules route by source reliably. That is worth doing if rules
  by source are wanted.

## Verification

- **`vf-app`**, `source-email.test.ts`, 3 new tests, 1 replaced:
  - a source an invoice arrived through is renamed, and the invoice
    keeps "AP Mailbox";
  - a current rule with `mandate.channel` equal to "ap mailbox" refuses
    with that rule named. A rule on another field naming it, an ended
    rule, and a rule on another channel do not. Once the rule ends, the
    rename goes through;
  - a name another source in the process has is refused, in any case.

  3 fail against the code before this change. 41 of 41 in the file.
- **`vf-ui`**, `routes.test.ts`, 2 new tests with the real strings: the
  pop-out's explanation, the refusal naming the rules (by name, else
  id), and the name clash. Both fail against the interface before this
  change.
- **`vf-licence`** migrations replay 231.
- **Full runs**: `vf-app` 3368 tests, of which 3365 pass: the two known
  failures (0511), and `routes.test.ts`'s check that a source with a
  message cannot be renamed. That was 0130's rule, which this decision
  changes. It now expects the rename to succeed, and the file passes 9 of
  9. `vf-ui` browser 1404 of 1405 (the known `typography.test.ts` 10px
  gap), worker 89 of 89. `vf-licence` 322 of 322.
