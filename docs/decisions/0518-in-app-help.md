# 0518 — In-app Help: a stage-aware side panel, with live reasons and an AI answer

**Status: pushed (`57c88e3`), deployed, and migration `0183` applied, as confirmed by the operator on 27 September.** The question box later moved to its own Ask panel (0519).

## What was asked

> a help button at the top, between the language and sign-out options.
> The help button needs an icon also. The help button would default to
> the page that the user is in and be stage aware. So someone asking
> for help as an approver would be able to see actions available to
> them, and be able to understand why they see a complete, or route to
> approver button. They would also see other buttons they could use,
> such as Return for example.

The operator then answered three questions:

- **Content: "a combination of 1 and 3"**, meaning written help plus
  live reasons, *and* an AI assistant.
- **Presentation: a side panel.**
- **Scope: stages in the viewer first**, with a short summary on every
  other screen.

## What was decided

**The button** sits between Language and Sign out on every screen's
topbar (`tasks.js`). It uses a new `help` icon, a question mark in a
circle, and toggles the panel.

**What it explains** is tracked in `tasks.js`:

- the screen is the existing `current`;
- the task is set by `openViewer` (`setHelpTask`);
- any screen change clears the task.

**The panel** (`help.js`) has three sections, top to bottom:

1. **About this page.** Written help for the screen, or for the viewer
   when a task is open (`help.screen.*`).
2. **At *stage*: your actions.** Each of the task's own `actions`,
   exactly as the server offered them, with its label, its icon,
   written help (`help.action.*`), and the live reasons for it,
   highlighted. Reasons about the task as a whole (claimed by someone
   else, missing permission) sit above the list.
3. **Ask a question.** An AI answer, with a note that it is
   AI-generated.

**The live reasons, `GET /help/tasks/:id`** (`help-route.ts`), explain
the buttons; they never decide them. They are computed with the same
functions that do decide:

- `rerouteContext` (0517);
- the next stage's approval hierarchy and Manual mode (0495);
- `resolveApprovalLimit` (0439);
- `codingGapsForTask` (0513/0514);
- the configured return targets the invoice has visited (0490/0515);
- `stageAllowsDiscard` (0502).

So an explanation can't disagree with what the server enforces. Each
reason is a code with parameters, and `help.js` fills the translated
template (`help.reason.*`). Only someone who could act on the task
(its owner, its claimer, or a holder of its permission at the
invoice's org) gets an answer. Anyone else gets a 403.

**The AI answer, `POST /help/ask`**, uses the same `env.AI` binding and
`CompilerModel` wrapper as the rule compiler and AP Expert. The prompt
carries only:

- the help text the panel is showing (sent by the screen, capped at
  8,000 characters);
- the live reasons, recomputed on the server rather than taken from the
  request;
- the question (at most 500 characters).

The model is told to answer only from those, to say so when they don't
cover the question, and to answer in the reader's language. It has no
tools and no other data. Any signed-in person may ask, because help is
for everyone, and a task's facts only reach the prompt when that person
could see the task.

**Proxy allowlist:** both routes were added to `vf-ui` in this same
change.

**`vf-licence` migration `0183`:** 44 keys in English and German — the
button and panel labels, 12 screen summaries, 9 action descriptions and
12 reason templates.

## What was verified

- **`index.test.ts`, through the real router:**
  - At Coding, Route To Approver is explained as choosing the Approval
    stage's approver.
  - At Approval over the limit, the reason carries the limit, amount and
    currency.
  - At Approval within the limit, Complete is explained.
  - Unfinished coding is reported against the right button.
  - A stranger gets a 403.
- **`help-route.test.ts`, with a stub model that records its prompt:**
  - An empty or over-long question is refused, without calling the
    model.
  - The prompt carries the help text, the instruction to use nothing
    else, the reader's language and the question.
  - A task the person can't see adds no facts.
- **`help.test.ts`, in the browser:**
  - With no task, only the page help and the question box show.
  - With a task, each action shows with its filled-in reason.
  - The question is posted with the task, locale and on-screen text,
    and the answer is shown.
  - The button toggles the panel, and Escape closes it.
- **`tasks.test.ts`:** Help sits immediately between Language and Sign
  out, with an icon.
- **Screenshots:** the panel was rendered in Chromium with the real CSS
  and strings, in light and dark, before shipping.

## What was not built

- **Other screens have a summary, not deep help.** The operator chose
  this scope for the first version.
- **Help does not follow the user around.** The panel explains the
  screen and task it was opened on. Opening another task or screen means
  reopening Help.
- **No usage limit on AI questions** beyond the question length. It
  runs on the same Workers AI binding as AP Expert.

## Verification

- **`vf-app`**, a full, unfiltered whole-suite run: 126 files and 3082
  tests, of which **3080 passed**. The two failures are the ones
  confirmed on untouched `origin/main` since 0511.
- **`vf-ui`**: Worker 75/75. Browser 1203/1204 across 49 files. The one
  failure is the known `typography.test.ts` `10px` gap.
- **`vf-licence`**: 320/320, with all 44 help keys required by
  `string-coverage.test.ts`.
- **`npx eslint`** on every touched file: clean.
- **`check-citations.py`**: 518 records, none dangling.
