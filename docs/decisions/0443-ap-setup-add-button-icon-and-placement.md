# 0443 — AP Setup: the Add button becomes an icon button, top-right of its own card

**Status: built, tested. Not yet pushed or deployed** — this session
still has no push access to `vibefinanceuk/vibefinance`; delivered as a
git bundle for the operator's own pull/push/deploy sequence, the same
path decisions 0391, 0415–0442 already used.

---

## What was asked

Once decision 0442 deployed (reorder-and-search on the two override
lists), the operator asked for two more things, from a screenshot of
the live screen: *"Please can you create a suitable icon for the Add
button and move to the top-right of each card. Also the apsetup hint
in each of the boxes, does not seem to be translated."*

## The Add button

**Not a new pattern — the same one this file already uses one form
above.** `modeForm()`, right above these two sections on the same tab,
already renders its own Save button as `actionLink("save", {primary:
true, onclick})` inside `el("div", {class: "cardhead"}, [h3, el("div",
{class: "statebuttons"}, [save])])` — `.cardhead`'s own CSS is already
`display: flex; justify-content: space-between`, which is what puts an
`.actionlink` at the card's top-right, matched to the title's own
baseline (`app.css`'s own `.cardhead > .actionlink { margin: -6px -4px
0 0 }`). Every other screen's Create/Save button
(`access.js`, `processes.js`, `sources.js`) already uses this exact
shape. The plain `<button>Add</button>` in each override section's own
add-row form, and the separate `.memberpickerrow` div it sat in below
the form, are both replaced with `actionLink("create", {primary: true,
label: t("apsetup.add"), onclick})` inside the section's own `cardhead`
— the `create` icon (an upload-style glyph) rather than inventing a
new one, since that's what this app already draws for "add/create a
new record" everywhere else (`access.js`'s own person/role/team/unit
creation, `processes.js`'s stage creation, `sources.js`'s source
creation). The label stays "Add" (`apsetup.add`, unchanged), not
"Create" — `label` overrides the icon's own default `action.create`
text for exactly this reason, the same override `sources.js`
(`"Load CSV"`/`"CSV Template"`) already uses.

No new strings, no new icon, no CSS changes — every piece this needed
already existed, used by a sibling on the very same tab.

## The untranslated hint text

**Not a code bug — migration `0146` (decision 0442's own new search
strings) had not actually been applied to the live `vf-licence-poc`
database.** `t()` returns the raw key when a string is missing
(`strings.js`'s own documented behaviour, deliberately, so a gap is
obvious rather than a blank), and the two keys shown untranslated —
`apsetup.supervisoroverridesearchhint`, `apsetup.limitoverridesearchhint`
— match `ap-setup.js`'s own calls and migration `0146`'s own rows
exactly; there is no naming mismatch to fix in code. This is the same
shape decision 0441's own second finding already was: "deployed and
pushed" confirms the worker code, not that a migration was separately
applied — a step this project has always kept deliberate and
operator-run (`apply_migrations.py --remote`), for `vf-licence-poc`
just as much as `vf-app-poc`. Nothing to build here; the fix is running
that command, named to the operator directly rather than guessed at in
code.

## Tests

`workers/vf-ui/test-browser/ap-setup.test.ts` — one new test, for both
override sections: the Add button lives at `.cardhead .statebuttons
.actionlink`, carries a real `<svg>` glyph (not just text), still
reads "Add", and the old `.memberpickerrow` row is gone. 18 → **19**.

`vf-ui` browser suite: 978 → **979** (+1), 975 green, 4 failed — the
same already-documented, pre-existing `document-window.test.ts` flake
decisions 0440–0442 all already found, unrelated here. `vf-ui`
plain-Worker suite unaffected (74). `vf-app`/`vf-licence` untouched —
no route, schema, or string change in this decision. `eslint .` clean.
