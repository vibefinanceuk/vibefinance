# 0723: The supplier network's top bar and message colours, as the application's

**Status: live** at `3156252`, pushed and deployed 10 October 2026. vf-portal (`topbar.js`,
`icons.js`, `mood.js`, `strings.js`, `portal.js`, `welcome.js`, the two pages, `portal.css`),
vf-licence (strings migration 0327).

## What was asked

Dan, 10 October 2026, against a screenshot of the network in Night: *"I'm actually not that keen
on the colours used here… 1. introduce the icons on the top right, in the same way we have in
the application. to include - Sign out, Day / Night, Help and Language (En, De). 2. Change the
comment colour on the night colour scheme to match that of the timeline / chat used in the main
application (lighter back colour)."*

## What changed

**The top bar.** An icon above its word, the application's own shapes and order: Night / Day,
Language (a code badge, EN or DE), Help, Sign out. Sign out only while signed in; the welcome
page has the other three.

- Night / Day is remembered in this browser (`vfn-mood`) and read before the first paint;
  without a choice, the machine's own setting.
- Language is remembered (`vfn-locale`) and switches in place: the words, the status filter and
  the list are redrawn.
- **Help** opens a panel on the right: what the network is, what each status means (with its
  chip), answering a question, who sees what, and that it is free for suppliers.

**The messages.** As the application's Timeline / Chat (0675): Day's light colours in both
themes. The customer's message light blue with a blue edge; the supplier's own a fuller blue,
on the right. Replaces the amber and green.

**Tests.** vf-portal's tests now read the stylesheet as it is (`css: true`): until now a
`?raw` stylesheet came back empty there, so the check added after 0721 for fixed severity
colours had nothing to check. New: the messages keep Day's colours; both pages leave the top
bar's controls to `topbar.js`. Checked in Chromium in both themes, with the language and theme
switched.

## To deploy

Migration: vf-licence `0327_network_topbar_help_strings.sql`. Deploy vf-licence and vf-portal.
