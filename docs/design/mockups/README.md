# Mockups

Static HTML, openable directly in a browser. **Nothing here is built, and
nothing here is code the product uses.** These exist so the design work
survives the conversation that produced it.

*Written before any of it was built.* **Much of it has been since** —
the keying screen from decision 0106 onward, the activity panel as
decisions 0267–0269 — and these files were not updated to match. The
decision records say what was built and where it departed from the
mock-up; treat these as the starting picture, not the current one.
*(Note added in decision 0380.)*

The reasoning behind each is in `../operator-interface.md`; these files
carry only the decisions that are easier to see than to describe, as
comments in the markup.

| File | Shows | Reasoning |
| --- | --- | --- |
| `key-from-document.html` | The Validation-stage keying screen | section 3 |
| `activity-panel.html` | System events and messages in one chronology | section 5 |
| `stage-rail.html` | Stage history with tasks, and the greyed remainder | section 6 |
| `white-labelling.html` | The same screen under three liveries | section 7 |
| `cost-object-approval.html` | Cost-Object Priority (Approval Hierarchy tab) and an Approval Limit column (Account Coding tab) — proposed additions to AP Setup, a screen already built | `../cost-object-approval-hierarchy.md` |
| `tokens.css` | The token layer all five share | section 7 |

**`cost-object-approval.html` is a different case from the other four**,
worth flagging so it is not read the same way: it does not predate a
build, it proposes an addition to one — AP Setup's Approval Hierarchy
and Account Coding tabs are real, live screens (decisions 0440, 0444).
Proposed elements are marked inline with a dashed amber box and a
"Proposed — not built" tag rather than left to blend into the rest of
the mock-up, so a screenshot of it is never mistaken for the shipped
screen. Its own reasoning lives in `../cost-object-approval-hierarchy.md`,
not `../operator-interface.md`.

## Why these are static files rather than a running app

They were produced in conversation, where they would have been lost. A
static file diffs, opens without a build step, and can be edited by
anyone looking at the design — which is the same reasoning that keeps the
numbered design documents as markdown rather than Word.

## What blocked building any of it — and no longer does

**This section described a blocker that has since gone.** It said
`key-from-document.html` could not be built because captured documents
were read and discarded, with no R2 access on the capture path.

Since then: documents are **retained** (decision 0068), **correctly
typed** (0069), reachable through a **short-lived signed URL** a pop-out
window can open (0073), and the **retention period** is a configured
benchmark rather than an open question (0077). Keying itself is built
(0071).

There is now a document to show.

**What blocks it now is different and smaller:** nothing lists a
person's tasks, so there is no way to reach the screen. Decision 0103
covers that.

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
