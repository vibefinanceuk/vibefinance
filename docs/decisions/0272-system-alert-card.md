# 0272 — A System Alert card, not an orange box

**Status: built.**

---

## What was asked

> I would like the message... to have the look and feel of the
> mock-up here. Identified as a "System Alert". it does not need to be
> highlighted in Orange. But it should be consistent with any other
> system alert.

The mock-up referenced is the collaboration-panel mock-up from earlier
in this series — a labelled card (icon, "System Alert," a headline,
supporting detail), styled as something the system is reporting rather
than a plain warning banner.

## Why this isn't just recolouring `.unreadable`

The app's own established convention for "something is wrong" is
plain coloured text — `.warn`, no card, no icon, used throughout
`suppliers.js` and `dashboard.js`. The mock-up asked for something
structurally different: a labelled card format, which nothing in the
shipped app had yet.

**Built as `.systemalert`, not `.unreadablealert`.** The Alerts tab —
still deferred from decision 0267 — will need exactly this shape for
its own real entries (an arithmetic mismatch, a duplicate suspicion).
Naming and building it generically now means that work reuses a card
already proven, rather than inventing its own version later and
risking two different-looking "system alert" styles in the same app —
the same drift this whole series keeps naming and avoiding.

## The icon exists, and stays honest regardless of colour

A warning-triangle-with-exclamation-mark, added to `icons.js`'s own
set. **Not built in orange.** The shape says "worth noticing"; colour
is a separate, later decision belonging to whatever card uses it —
this one uses the app's ordinary accent colour, per the operator's own
words, not the warning palette the mock-up itself had used.

## What was checked, not assumed

**The colour claim, read from the real stylesheet.** jsdom applies no
CSS at all, so a test asserting `.systemalert`'s own class name is
present proves nothing about what colour it renders. A new test reads
`index.html`'s actual CSS text and confirms neither `--bg-warning` nor
`--text-warning` appear in the rule — probed by reintroducing the
warning background and confirming it fails.

**The card only ever appears once, and only where asked.** The
existing decision 0271 test confirming the note appears in
Timeline / Chat and not under the document image was kept and
retargeted at the new class name, rather than replaced outright —
probed by removing the label and confirming that fails too.

vf-ui: 49 Worker, 313 browser. vf-licence: 320.
