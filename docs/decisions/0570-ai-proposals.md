# 0570: Routes phase 2, slice 4: AI proposals, with a confidence our code works out

**Status: built and tested locally, not yet pushed or deployed.** It
touches `shared`, `vf-app`, `vf-ui` and `vf-licence`, and needs
**`vf-licence` migration `0220`**. There is no `vf-app` migration:
proposals are not stored, and an applied proposal is a line of the draft.

## What was asked

Slice 3 was complete and tested live on 30 September. Dan then asked to
move on to slice 4, **AI proposals**, as in the mock-up he approved on 29
September:

- each proposal has a confidence percentage, **based on names, values,
  and whether the invoice adds up**;
- the person applies everything at or above a threshold they choose;
- the rest are grouped: *you check* (60 to 89%), *weak guesses*, and
  *required fields with nothing found*.

## What was decided

### The model proposes; our code scores (`shared/ingestion/mapping-proposals.ts`)

The model is good at reading a supplier's element names in any language,
and suggesting which Business Term each becomes and what function reads
it. It is **not** asked how sure it is: a number a model writes about
itself cannot be checked. The confidence is computed by our code, from
three signals.

**Name** (`nameScore`) compares the element's name, and its group's,
with what the term is usually called. There is a list of names in English
and German for every term (`SYNONYMS`). Case, accents and punctuation are
ignored.

| The element's name | Score |
|---|---|
| is one of the term's usual names | 1 |
| contains one | 0.8 |
| its group contains one | 0.5 |
| none of these | 0 |

**Value** (`valueScore`) is what the sample becomes as the mapping reads
it (a whole-invoice amount from the lines is their sum):

| What the value is | Score |
|---|---|
| passes the term's own check: a real ISO date, a finite number, a three-letter currency, a VAT number's shape, a two-letter country, a known invoice type code, a unit code's shape, an e-mail address, a VAT rate from 0 to 100 | 1 |
| free text | 0.8 |
| text in an unusual form for the term | 0.3, with the reason |
| the wrong kind, or a function that fails on it | 0, with the reason |

**Adds up** (`arithmetic`) applies every proposal at once, so each sum is
checked with all its terms. It then checks, where the terms are present:

- the lines add up to the net total (BT-106);
- BT-106 equals the total without VAT (BT-109);
- BT-109 plus the VAT (BT-110) is the total with VAT (BT-112);
- BT-112 equals the amount due (BT-115);
- each line's net (BT-131) is its quantity (BT-129) times its price
  (BT-146).

A term in a sum that agrees gains, and one in a sum that does not loses,
with the problem "the invoice does not add up with it".

**Confidence** is 35% name, 30% value and 35% adds up for a term in a
sum, and 55% name and 45% value for any other term, as a whole
percentage.

**What is dropped, never shown.** A proposal is dropped when:

- its element is not in the sample;
- its term is unknown, or already mapped;
- its term appears twice;
- a function is not in the closed list;
- a look-up list does not exist;
- a line's term is drawn from outside the lines;
- a whole-invoice term other than an amount is drawn from the lines.

The response counts what was dropped. It also lists the **required terms
nothing covers**: no line, no rule and no proposal.

**The prompt** lists the sample's elements with their scope (*whole
invoice* or *each line*), their sample values and a CSV's column names.
It also lists the terms still to map (with their name, kind, scope and
whether required), the closed function list, and the customer's look-up
lists. Terms already mapped are left out. Proposals are sorted highest
first.

### The endpoint

`POST /supplier-mappings/:id/propose` is under `Admin.Configure`, like the
editor, and is proxied by `vf-ui` with its allowlist test.

- It reads the draft's (or live version's) sample as the mapping reads it.
- It refuses a retired mapping (`retired`), and a sample no longer kept
  (`no_sample`).
- **Nothing is saved.**

The Workers AI compiler model now takes `maxTokens`. Proposing asks for
12,000, since it answers a line for up to 35 terms after the model's own
reasoning. Rules and functions keep 4,096.

### The mapping editor

- **Propose with AI** sits beside Try on the sample. It says
  "Proposing…" while it works.
- A new mapping with no lines says: "No lines yet. Propose with AI to
  start, or draw them by hand."
- The **AI proposals** card sits at the top of the right-hand column:
  - a threshold slider, from 50 to 100% in steps of 5, starting at 90%;
  - **Apply K at or above N%**;
  - the groups **Ready, N% or more**, **You check** (60% up to the
    threshold), **Weak guesses** (under 60%) and **Required, nothing
    found**, the last with how to cover them (by hand, a fixed value, or a
    rule for the whole invoice).
- Each proposal shows:
  - the term and its confidence;
  - the element (by its CSV column name);
  - the sample and what it becomes;
  - its functions;
  - the model's reason;
  - any problem our checks found;
  - **Apply** and **Dismiss**.
- An applied proposal becomes a line with `origin: "ai"`. It is saved to
  the draft and marked **AI** in the right-hand column. The note asks the
  person to try the draft on the sample.

### Strings and help

`vf-licence` `0220` adds 24 keys in English and German, none with a `;`.
The mapping editor's help gains *AI proposals*, and says the confidence is
worked out by VibeFinance, not the AI.

## Not built

- **AI proposals for rules for the whole invoice.** Only lines are
  proposed. A required term nothing covers is listed, to be filled by
  hand or by a rule.
- **Learning from what people apply or dismiss.** Every proposal is fresh.
- **Clearing the AI mark when only a line's function changes.** A line
  redrawn by a person becomes theirs. A proposal whose function a person
  changes keeps its AI mark.

## Verification

- **`shared`**: `mapping-proposals.test.ts`, 10 tests. They cover:
  - names in English and German, a name inside another, and a group;
  - values: a term's own check, only the right kind, or neither, with
    reasons;
  - adding up per term, and a total taken from the wrong element;
  - a good mapping scored 80 to 100, with sums agreeing and what each
    sample becomes;
  - a wrong total scored under 60 because the invoice no longer adds up;
  - an amount left with a decimal comma scored under 60 on its value;
  - six kinds of bad proposal dropped;
  - an answer that is not JSON;
  - the prompt: scope, samples, and only the terms still to map;
  - the required terms nothing covers.

  The whole package: 388 pass. The three failures existed before this
  change.
- **`vf-app`**: `supplier-mappings.test.ts`, 2 new tests:
  - proposing on a CSV draft with one line mapped: the rest proposed and
    scored (the total with VAT at 100%, summed from the rows), an element
    not in the file dropped, BT-3 listed as required with nothing found,
    the prompt as above, and nothing saved;
  - a retired mapping, a sample that is gone, and an unknown mapping
    refused.

  `index.test.ts` checks that propose needs `Admin.Configure`. Full,
  unfiltered run: 141 files and 3317 tests, of which **3315 passed**. The
  two failures are the ones already known (0511).
- **`vf-ui`**: `mapping-editor.test.ts`, 3 new tests using the real
  strings:
  - proposals grouped at 90%, and regrouped when the slider moves to 70%;
  - applying everything at or above the threshold into the draft (marked
    AI), and dismissing one;
  - nothing proposed, and a failure.

  All fail against the interface before this change, and the proxy test
  fails without the allowlist entry. Full browser suite: 1377 of 1378
  pass. The one failure is the known `typography.test.ts` 10px gap. Worker
  tests: 75 of 75.
- **`vf-licence`**: 322 of 322 pass, with `0220` loaded and its keys
  covered.
- **Migrations**: `vf-licence` replays 220. `vf-app` is unchanged at 113.
- **Screenshot** of the editor with proposals in every group, checked by
  eye.
- **Not verified against the live model.** The tests use a model that
  answers as the prompt asks. How good the real model's proposals are is
  for Dan to see on his own supplier files. The confidence does not depend
  on it: it is our code's.
