# Mockups

Static HTML, openable directly in a browser. **Nothing here is built, and
nothing here is code the product uses.** These exist so the design work
survives the conversation that produced it.

The reasoning behind each is in `../operator-interface.md`; these files
carry only the decisions that are easier to see than to describe, as
comments in the markup.

| File | Shows | Reasoning |
| --- | --- | --- |
| `key-from-document.html` | The Validation-stage keying screen | section 3 |
| `activity-panel.html` | System events and messages in one chronology | section 5 |
| `stage-rail.html` | Stage history with tasks, and the greyed remainder | section 6 |
| `white-labelling.html` | The same screen under three liveries | section 7 |
| `tokens.css` | The token layer all four share | section 7 |

## Why these are static files rather than a running app

They were produced in conversation, where they would have been lost. A
static file diffs, opens without a build step, and can be edited by
anyone looking at the design — which is the same reasoning that keeps the
numbered design documents as markdown rather than Word.

## What blocks building any of it

`key-from-document.html` is the screen an operator would use on a
document intake could not read (decision 0063). It cannot be built until
captured documents are **stored** — `intake-capture-route.ts` has no R2
access, so a document arriving at `/sources/:id/capture` is read and
discarded. Document 1 section 6 records long-term retention as proposed
with no code, and the retention period as an open compliance question.

There is currently no document to show.

## The token file is the white-labelling argument

`tokens.css` began as the host design system's variables and is
reproduced here so the files open standalone. That accident demonstrates
the point: every colour is a token, so a customer or partner livery is a
substitution in one place. The brand block at the bottom of that file is
the only part a deployment would replace.

## Two things the mockups found

Drawing them surfaced problems that reading the code had not:

- **Captured documents are not stored at all** — the blocker above.
- **Three workflow-engine gaps**, recorded as decision 0064: advancement
  after task completion is sequence-only so `route_to` cannot fire and
  send-back does not exist; `require_second_approval` is declared and
  implemented nowhere; and an instance advanced onto a rule-bearing stage
  sits there until something calls `visitCurrentStage` with facts.

Finding these by drawing the interface, rather than by hitting them in
production, is the cheapest way it could have gone.
