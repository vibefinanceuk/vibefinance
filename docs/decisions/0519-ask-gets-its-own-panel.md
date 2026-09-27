# 0519 — Ask gets its own button and side panel

**Status: built and tested locally, not yet pushed or deployed.** This
session has no push access, so it is delivered as a git bundle. It
touches `vf-ui` and `vf-licence`, and needs `vf-licence` migration
`0184` applied as its own step. There is no `vf-app` change.

## What was asked

> I think the Ask option is a little lost at the bottom of the help side
> menu. I think it makes sense to create a new button at the top of the
> page, called Ask, with an icon, that has its own space. Please can you
> remove the Ask feature from the Help side menu, and create it's owns
> side menu, exactly the same size and behaviour as the Help side menu,
> but simply an Ask side menu. With a comment box, and Ask button to get
> feedback from AI.

## What was decided

**The Ask button** sits beside Help, so the topbar reads *Language ·
Help · Ask · Sign out*. It uses a new speech-bubble `ask` icon.

**One panel frame** (`openPanel` in `help.js`) serves both panels, so
Ask is the same size, in the same place, with the same close button and
the same Escape as Help. The two share one slot:

- opening either closes the other;
- each button toggles its own panel.

**The Help panel** keeps "About this page" and "At *stage*: your
actions". Its question box is gone.

**The Ask panel** contains, top to bottom:

- a one-line introduction;
- the conversation, with each question shown as a bubble above its
  answer, so a follow-up can be read against the one before;
- the comment box and the Ask button (Enter asks, Shift+Enter starts a
  new line);
- the AI disclaimer.

**Answers are grounded exactly as before.** When a question is asked,
Ask builds, off-screen, the same sections Help would show for this
screen and task, and sends their text with the question. The server
side (`POST /help/ask`, 0518) is unchanged.

**`vf-licence` migration `0184`** adds `ask.button`, `ask.title` and
`ask.intro`, in English and German. The question box's own strings are
reused from 0183. `help.ask.heading` is no longer used.

## What was verified

The new tests **failed** with `public/` stashed (4 failed).

- **`help.test.ts`:**
  - Help no longer has a question box.
  - Ask is its own panel with its own title.
  - Ask posts the question, task, locale and Help's own text for the
    task, shows the answer under the question, and clears the box.
  - Help and Ask share one slot, and each toggles itself.
- **`tasks.test.ts`:** Help, then Ask, sit between Language and Sign
  out, each with an icon.
- **Browser suite:** 1204/1205. The one failure is the known
  `typography.test.ts` `10px` gap. Worker tests: 75/75. `vf-licence`:
  320/320.
- **Screenshot:** the Ask panel was rendered in Chromium, with a
  question and its answer.
