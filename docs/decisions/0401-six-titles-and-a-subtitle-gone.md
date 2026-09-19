# 0401 — Six titles, and a subtitle gone

**Status: built, tested, not yet pushed.** A direct wording request
against the Dashboard screen: six card titles reworded, and one
card's own explanatory subtitle removed outright.

---

## What was asked

The operator's own list, verbatim:

1. Change "Waiting for me" to read "My Tasks by Stage"
2. Change "Where Things Are" to read "All Open Tasks by Stage"
3. Change "How Long They Have Waited" to read "Task Aging Report"
4. Change "On My Clock" to read "My Priority Tasks"
5. Change "Suppliers Awaiting the ERP" to read "Supplier Setup Required"
6. Change "Done" to read "Tasks Completed This Week"
7. Remove the text "Assigned to me or claimed by me — not a team
   queue" from the "On My Clock" list.

---

## What was built

**Six UPDATE statements, one row deleted from the page, nothing
deleted from the database.** Every title is a `ui_strings` key
(`dash.waiting_for_me`, `dash.where_things_are`, `dash.ageing`,
`dash.on_my_clock`, `dash.suppliers_awaiting_erp`, `dash.done`) that
`dashboard.js` already read through `t(...)` — the keys themselves are
untouched, so nothing else that reads them needs to change. Migration
`0125` reworks their English and German values in place, the same
`UPDATE ui_strings SET value = ... WHERE key = ... AND locale = ...`
pattern decision 0307 (`0090`) used for the last Dashboard heading
rename.

The seventh item is a different kind of change: `dashboard.js`'s
`on_my_clock` card built its subtitle from `dash.myclocksub`
(`el("div", { class: "sub", text: t("dash.myclocksub") })`, added at
decision 0159). That line is deleted outright — the card no longer
renders a subtitle at all, matching what was asked (remove the text,
not reword it). `dash.myclocksub`'s own `ui_strings` row is left in
the database untouched: this project's migrations never delete a row,
following the same discipline every other migration here already
keeps, and an unread key does no harm. It comes out of
`string-coverage.test.ts`'s `KEYS_THE_INTERFACE_USES` list instead,
since the interface no longer asks for it.

**German wording, provided rather than left blank.** Every English
change has a German counterpart in the same migration, matching this
project's own standing bilingual requirement — nobody asked for German
specifically, but every other `ui_strings` migration in this project
seeds both locales, and this one does the same: *Meine Aufgaben nach
Phase*, *Alle offenen Aufgaben nach Phase*,
*Aufgaben-Alterungsbericht*, *Meine vorrangigen Aufgaben*,
*Lieferanteneinrichtung erforderlich*, *Diese Woche erledigte
Aufgaben*.

---

## Tests

`workers/vf-licence/test/string-coverage.test.ts` — `dash.myclocksub`
removed from `KEYS_THE_INTERFACE_USES`; migration `0125` wired into
`test/setup.ts`. Full vf-licence suite: **320/320**.

`workers/vf-ui/test-browser/dashboard.test.ts` — every fixture value
and every DOM-text lookup for the six renamed titles updated to the
new wording (roughly twenty call sites: `.includes(...)`,
`.toContain(...)`, `.toEqual([...])`, and test titles that quoted the
old name). Two occurrences were deliberately left untouched — both are
verbatim quotes of what the operator said live at the time (decision
0363's *"the Waiting for me card..."* and the *"across 4 stages"*
report) — those are a historical record of what was asked, not a
live assertion, and rewriting them to the new name would misquote the
past. `"Done"` needed care rather than a blind replace: it also
appears inside the unrelated `dash.done_arranging` string ("Done
arranging", the arrange-mode toggle button), so its two lookups were
updated to the new, now much longer and non-overlapping, "Tasks
Completed This Week" rather than assumed safe by substring alone.
Full vf-ui suite: **74 Worker + 709 browser**, both passing (same
count as before — a rename, not an added or removed test).

`eslint` clean. `scripts/check-citations.py` clean (401 records).
Touches `vf-ui` (`public/dashboard.js`,
`test-browser/dashboard.test.ts`) and `vf-licence` (migration `0125`,
`test/setup.ts`, `test/string-coverage.test.ts`) — no `vf-app` or
`vf-admin` change, so only those two Workers need redeploying.

---

## What is not built

Nothing deferred. All seven items are wording/removal only — no card
gained or lost data, no layout changed, and every key that any other
part of the app might reference stayed exactly where it was.
