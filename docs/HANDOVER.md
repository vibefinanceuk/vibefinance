# Handover

**Written 4 September 2026, updated 17 September (six times), updated
18 September (four times), updated 19 September (thirteen times).**

**For a session starting cold.** Where things stand, what needs a
decision rather than work, what to do next, and the habits this project
has earned the hard way.

It holds **only what the other files cannot give you**:

- `docs/PROGRESS.md` — the map. What exists, what does not.
- `docs/decisions/` — the authority on *why* anything is as it is.
- `docs/decisions/SUPERSEDED.md` — what stopped being true.

**Nothing is struck through here.** When a thing is done it leaves this
page and appears in `SUPERSEDED.md`, because two copies of the same
history is one copy that lies — and the stale one is always the copy
nobody is told to check.

**Read `SUPERSEDED.md` before trusting an old record.** Records are never
rewritten to agree with later ones, so **contradictions between them are
real and neither is wrong** — they are dated. That page maps which
supersedes which, and it exists because the trap has been fallen into
twice.

---

## Where things stand

| | |
| --- | --- |
| `origin/main` | `f862d37` |
| vf-admin deployed | `8e27a34` · `https://admin.vibefinance-ai.com` · behind Cloudflare Access |
| vf-app deployed | `4d44b59` |
| vf-licence deployed | `a235713` |
| vf-ui deployed | `f862d37` · `https://app.vibefinance-ai.com` |
| Domain | `vibefinance-ai.com` · **email intake receives real invoices** |
| `vf-app-poc` migrations | through `0070` |
| `vf-licence-poc` migrations | through `0123` applied, all confirmed live — checksums `9e4d534bcef6…` (`0122`) and `79ff9f930fdb…` (`0123`), run by the operator via `apply_migrations.py --remote --migrations-dir workers/vf-licence/migrations --database vf-licence-poc` |
| Tests | vf-admin 9 · vf-app 1936 · vf-licence 320 · vf-ui 74 Worker + 709 browser · shared 278 (+3 known pre-existing failures) |
| Decision records | 400 |

**Decision 0394 (a column, two arrows, and a marker) is pushed and
deployed, confirmed directly by the operator opening the pop-out
window and seeing the Timeline / Chat column.** An evaluation request
— Timeline / Chat as a pop-out-only right-hand column at 25% width,
next/previous page cycling in the shared control row, and a
session-only rectangle highlight tool as a deliberate first cut of
"annotations" — mocked up with Playwright before anything was built,
then scoped by three explicit choices (25% over 20%; page cycling in
both the pop-out and the embedded card, since the control row is
shared; build a small first cut of annotations now rather than scope
the full feature first). Touches `vf-ui` (`app.css`, `icons.js`,
`page-renderer.js`, `viewer.js`) and `vf-licence` (migration `0123`,
`test/setup.ts`, `test/string-coverage.test.ts`) — no `vf-app` or
`vf-admin` change. Ten new tests, full suites vf-ui 74 Worker + 684
browser, vf-licence 320/320, all passing; `eslint` and
`scripts/check-citations.py` both clean.

**Decision 0395 (a fourth state, and a borrowed accent) is pushed and
now deployed** — confirmed live: a fetch of `/tokens.css` from
`https://app.vibefinance-ai.com` (cache-busted) returns
`--heading-accent: #854f0b;` and `--font-heading: "Big Shoulders
Display", var(--font-sans);`. First of four
decisions building out a look the operator liked from another product
this team built (e-invoicingcompliancecorner.com), narrowed down
through a mockup canvas (built and iterated directly with the
operator, outside this repository) to four pieces, with an explicit
fifth requirement running across all of them — Day and Night both, not
Day alone. Agreed build order: tokens first (this one, purely
additive, nothing visible changes); then the two global pieces — a
bold heading treatment and a rule beneath every card title — together,
since both touch every screen and need the widest regression check;
then the Document tab row restyled as a segmented pill, narrow and
independent; then red/amber/green severity on the validation screen
last, since that one still needs an answer to whether "mismatch" and
"needs review" already exist as separate claims anywhere upstream, or
whether the distinction has to be added there first — not yet
investigated.

**The push/deploy status is worth recording precisely, because it
is the opposite of this morning's gap.** The operator first reported
"deployed and pushed"; a live check of `/tokens.css` came back showing
only the pre-0395 properties; and — given today's earlier history of
that exact check being wrong against this exact site — this session
asked the operator to verify directly rather than trust its own fetch
again. **This time the fetch was right**: the operator confirmed vf-ui
has not actually been deployed yet. Same check, same site, and this
time correct — so the lesson from earlier today ("trust the operator
over this session's own fetch when they disagree") still holds; it was
never "the fetch tool is always wrong here," only that it had been
wrong more than once and so was not to be trusted *unquestioned*
either way. That deploy has since happened, alongside 0396's own —
see the confirmation above, and 0396's own paragraph below.

This decision only adds `--heading-accent` and a
`--bg-danger`/`--text-danger`/`--border-danger` trio to `tokens.css`,
Day and Night, `--heading-accent` reusing `--text-warning`'s own
proven pair rather than the reference site's raw orange (which read
under 3:1 against `--surface-2`). Two new tests in `mood.test.ts`,
watched to fail against the pre-change file first. Full suites: vf-ui
74 Worker + 686 browser (684 pre-existing + 2 new), both passing;
`eslint` and `scripts/check-citations.py` both clean (the citation
checker does not scan `.css` files at all — its own `SUFFIXES` list is
`.ts`/`.js`/`.sql`/`.md`/`.py` — so the record exists for the one
citation in `mood.test.ts`, not for anything inside `tokens.css`
itself). Touches `vf-ui` (`public/tokens.css`,
`test-browser/mood.test.ts`) only.

**Decision 0396 (a title in its own face, and a line beneath it) is
pushed and deployed too** — confirmed live the same way: a fetch of
`/app.css` from `https://app.vibefinance-ai.com` (cache-busted) returns
the exact `.panel > h3, .panel > .cardhead > h3` rule below, word for
word, including the `border-bottom: 1px solid var(--border-strong)`
line. The operator reported "deployed and pushed" together this time,
and both checked out directly — `git fetch` for the push (`origin/main`
at `0cd8c6d`, a docs-only commit on top of 0396's own `7ba798f`,
matching this session's `main` exactly) and the two live fetches above
for the deploy. Unlike this morning, no correction was needed. Second
of the four — the two global pieces
together, as agreed: every panel title now takes a self-hosted Big
Shoulders Display (one weight, 800, shipped the way Carlito was —
decision 0124), uppercase, in `--heading-accent`, at `--text-lg`
rather than `--text-base`; and a `border-bottom: 1px solid
var(--border-strong)` runs beneath every card title's own row.
CSS-only — no JS file touched, since every card already had exactly
one heading element to extend. Scoped deliberately to `.panel >
h3`/`.panel > .cardhead > h3` (not bare `.cardhead`), which keeps it
off every modal dialog's own title (access.js, sources.js,
suppliers.js, processes.js, purchase-orders.js all share `.cardhead`
for those) and off the dashboard's KPI tiles (`card-narrow` nests its
`cardhead` inside `.tilefg`, never a direct child of `.panel`) without
either exclusion needing to be written by name. Five new tests in
`test-browser/typography.test.ts`, watched to fail against the
pre-change files first (4 of 30 failed, exactly the new assertions).
Full suites: vf-ui 74 Worker + 691 browser (686 pre-existing + 5 new),
both passing; `eslint` clean; `scripts/check-citations.py` clean (396
records). Touches `vf-ui` (`public/app.css`, `public/tokens.css`,
`public/fonts/big-shoulders-display-latin-800-normal.woff2`,
`test-browser/typography.test.ts`) only. Not yet visually reviewed
across every screen — the widest-blast-radius piece of the four by
design, and that regression pass has not been done as part of this
change. Next: the Document tab row (piece three, narrow and
independent), then red/amber/green severity (piece four, still needs
the upstream data-model question answered first).

**Decision 0397 (the first live look back at 0396) is pushed and
deployed** — confirmed both directly, not taken on the operator's
report alone: `git fetch` puts `origin/main` at `6613e3d`, matching
this session's own `main` exactly; and two cache-busted fetches of
`/app.css` from `https://app.vibefinance-ai.com` return the new
`.panel > .cardhead { align-items: flex-end; }` and
`.panel > .cardhead > .actionlink { padding: 4px 6px; gap: 3px; }`
rules, the new `.panel > .tilefg > .cardhead > h3` selector reaching
the dashboard's tiles, and confirm the old
`.card-narrow > .cardhead > h3` text is genuinely gone rather than a
stale response happening to omit it. The operator's own first look at
0396 live, not the mock-up, produced two corrections. First: a card
whose action is
`actionLink()`'s icon-above-label shape (decision 0122) — Purchase
Orders' own CSV Template/Load CSV, wrapped in `.statebuttons` and so
outside `.cardhead > .actionlink`'s existing `-6px` pull, decision
0300 — made the whole heading row as tall as the action, with the
title pinned to the top by `flex-start` and a bare gap opening above
the new rule rather than the title sitting on it. Fixed with `.panel >
.cardhead { align-items: flex-end; }` plus a compacted, card-scoped
`.actionlink` override (smaller padding/gap/icon, only inside a card's
own heading — the control row and the pagination arrows keep the base
rule's own size). Second: the Dashboard's own KPI tiles
(`card-narrow`/`card-graphic`) had been deliberately left quiet by
0396's own scoping, reasoning they already had decision 0242's "no
verdict" treatment — but live, next to "On my clock" (which had picked
up 0396's rule on its own, since its `cardhead` sits a level shallower
than the other tiles'), the quiet tiles read as unfinished rather than
intentional. Three ways to resolve it were rendered against the real
stylesheet and shown side by side; **the operator chose directly**:
extend the heading and the rule to every tile. `.panel > .tilefg >
.cardhead > h3`/`.panel > .tilefg > .cardhead` reaches through the one
extra layer `dashboard.js`'s `panel()` helper adds, and the dead
`.card-narrow > .cardhead > h3` override — which never actually
matched, the same `.tilefg` nesting being why — is removed rather than
left contradicting a live rule beside it.

Both fixes were rendered against the real, unmodified stylesheet with
Playwright before being called done (Day and Night both, a card with
no action at all to confirm nothing untouched moved). Nine new tests
in `test-browser/typography.test.ts` (two existing 0396 tests updated
for the selector's new third line), watched to fail first (7 of 35
failed — 5 new assertions plus the two whose selector text had
changed). Full suites: vf-ui 74 Worker + 696 browser (691 pre-existing
+ 5 new), both passing — `dashboard.test.ts`'s own unhandled-rejection
noise confirmed pre-existing, not introduced here. `eslint` clean;
`scripts/check-citations.py` clean (397 records). Touches `vf-ui`
(`public/app.css`, `test-browser/typography.test.ts`) only — no new
token, no `tokens.css` change.

**Decision 0398 (a toggle for the document tabs) is pushed and
deployed** — confirmed both directly, not taken on the operator's
report alone: `git fetch` puts `origin/main` at `6b470c8`, matching
this session's own `main` exactly; two cache-busted fetches of
`/app.css` and `/tokens.css` from `https://app.vibefinance-ai.com`
return the new `.doctabs`/`.doctab`/`.doctab.on`/`.activitycount`
rules word for word — the pill background and `border-radius: 999px`,
the active tab's `box-shadow: var(--tab-active-shadow)`, the badge's
`--bg-accent`/`--text-accent` — and `--tab-active-shadow` itself in
all three places it should be: `0 1px 2px rgba(18, 26, 38, 0.12)` in
the plain `:root` (Day), `none` in both the
`@media (prefers-color-scheme: dark)` block and
`:root[data-mood="night"]`. Third of the four pieces from 0395's own
sequence — the
Document/XML/Timeline & Chat tab row, narrow and independent, as
agreed. Styling only, no JS file touched: `buildDocTabs()` in
`viewer.js` already builds `.doctabs`/`.doctab`/`.doctab.on`/
`.activitycount`, the same four class names before and after, and
`document-window.js`'s own pop-out picks up the same restyle with no
change of its own since it calls the same function. `.doctabs` becomes
a filled, fully rounded pill (`background: var(--surface-1)`,
`border-radius: 999px`, `padding: 3px`, tabs spaced 2px apart rather
than the old 18px margin); `.doctab` drops its underline entirely for
a transparent border ready to be filled; `.doctab.on` fills that
border, lifts onto `--surface-2`, and picks up a new
`--tab-active-shadow` token — a real shadow in Day, `none` in Night,
since the same value that reads as depth on a light surface is either
invisible or a smear on a dark one. `.activitycount`, the timeline's
own unread badge, moves from a neutral grey to `--bg-accent`/
`--text-accent`. Deliberately kept separate from `.tabbar`/`.tab`
(decision 0333, the Access screen's own Organizations/Roles/Teams/
People switcher) — that decision's own case for underline-only was
made for a row of *sections*, and Document/XML/Timeline & Chat are
views of one thing instead, closer to the reference site's own toggle
— with a test now guarding `.tabbar` stays exactly as 0333 left it.
Rendered against the real, unmodified stylesheet with Playwright
before being called done, Day and Night both — the actual markup
`buildDocTabs()` builds, inside `.cardhead` exactly as
`documentPanel()` returns it; this card's own `.cardhead` has no
`<h3>` at all when tabs are showing (the tab row *is* the card's own
head), and 0396/0397's own `align-items: flex-end`/compacted-
`.actionlink` rules already reached it correctly with no further
change needed. Five new tests in `test-browser/typography.test.ts`,
one new test plus a list entry in `test-browser/mood.test.ts`, watched
to fail first (5 of 55 combined failed, exactly the new assertions).
Full suites: vf-ui 74 Worker + 702 browser (696 pre-existing + 6 new),
both passing; `eslint` clean; `scripts/check-citations.py` clean (398
records). Touches `vf-ui` (`public/app.css`, `public/tokens.css`,
`test-browser/typography.test.ts`, `test-browser/mood.test.ts`) only.
Not yet reviewed live — the narrowest of the four pieces by design, so
unlike 0396 it did not get its own dedicated round of "look at it live
across several screens" before this write-up; that first look is
expected the same way it happened for 0396, any correction recorded
the way 0397 was. Next: red/amber/green severity (piece four, still
needs the upstream data-model question answered first — not yet
investigated).

**Decision 0399 (one pill for every tab) is pushed and deployed** —
confirmed both directly, not taken on the operator's report alone:
`git fetch` puts `origin/main` at `f862d37`, matching this session's
own `main` exactly. The live-deploy check needed more care than usual:
a first cache-busted fetch of `/app.css` asked to quote `.tabbar
.tab`'s rule body came back with `font-size`/`cursor`/`display`/
`align-items`/`gap` properties this decision never gave it — a fourth
instance of this exact fetch tool's documented unreliability against
this exact site, this time not a stale read but the summarization
model merging `.tabbar .tab` with the structurally similar, nearby
`.doctab` rule (confirmed by a follow-up fetch that had it name
`.tabbar .tab.on` — which exists nowhere in the file — as the
selector immediately following `.tabbar .tab`'s own closing brace,
plainly `.doctab.on` bleeding into the wrong answer). A third fetch,
asked explicitly to distinguish the two rules and count each one's
declarations separately, gave `.tabbar .tab` exactly five — background,
border, border-radius, padding, color — matching the source file
exactly, with `cursor`/`gap` correctly placed in `.doctab`'s own count
of ten instead. `.tabbar` itself and `.tabbar .tab.active` read
correctly on the very first fetch: `border-radius: 999px`/`background:
var(--surface-1)` on the container, `background: var(--surface-2)`/
`box-shadow: var(--tab-active-shadow)` on the active tab. Lesson
restated once more because it held again: **when this fetch tool's
own answer looks structurally too similar to a neighbouring rule, ask
it to distinguish the two by name and count rather than trusting a
single quote.**
The correction 0398's own write-up half-expected, though not from a
live review this time — asked directly, the same day 0398 shipped:
*"the most recent tab select update to pill box, also... applied to
the tabs in the Access screen. There are tabs for Org Units, Roles,
People and Teams."* This reverses 0333's and 0398's own stated
reasoning for keeping `.tabbar`/`.tab` underline-only and separate
from `.doctabs` — on purpose, per the operator's own direct request,
not an oversight of it; recorded in `SUPERSEDED.md` rather than
quietly edited away. Styling only, no JS touched: `tabBar()` in
`access.js` already builds `.tabbar`/`.tab`/`.tab.active`, the same
three class names before and after. `.tabbar` now takes `.doctabs`'s
own exact shape — filled `--surface-1` background, `border-radius:
999px`, `0.5px` border, `3px` padding; `.tab.active` lifts onto
`--surface-2` and reuses 0398's own `--tab-active-shadow` token rather
than a second one invented for the same job, since the same case for
"real shadow in Day, `none` at Night" applies here exactly as it did
there. Rendered against the real, unmodified stylesheet with
Playwright before being called done, Day and Night both. The old test
guarding `.tabbar` as underline-only (added at 0398) is replaced with
one mirroring the Document-tabs tests — pill background/radius, the
active tab's lift, the same shadow token reused rather than a new one
— watched to fail first (2 of 3 new assertions failed against the
pre-change file; the shadow-token check passed vacuously, since 0398
already shipped that token). Full suites: vf-ui 74 Worker (unchanged)
+ 704 browser (702 pre-existing, net +2 — one old test replaced by
three new ones), both passing; `eslint` clean;
`scripts/check-citations.py` clean (399 records). Touches `vf-ui`
(`public/app.css`, `test-browser/typography.test.ts`) only — no
`tokens.css` change, no JS file, no other Worker.

**Decision 0400 (three tiers for the fourth piece) is built, tested,
and visually verified — not yet pushed.** Closes the four-piece
sequence 0395 opened: red, amber, and green on the validation screen's
key fields and exceptions list. Investigated first, per the deferral
0395/0396/0397/0398 all left for it — no upstream distinction between
"mismatch" and "needs review" existed to repurpose — then three scope
questions went to the operator directly: wire the existing PO
three-way-match into the exceptions pipeline (**yes**), bring back the
hidden exceptions panel (**no**, left hidden), and the green state's
own definition (**Claude's judgement**). Backend: a new `po_mismatch`
check in `validation.ts`, gated on a real comparison having happened
(`po.variance_pct !== undefined`) rather than on `po.matched` alone,
since that field alone conflates "no PO referenced" with "PO
referenced but disagrees"; a required `severity` on every failure
("danger" for `po_mismatch` only — checked against a linked purchase
order, not the document's own numbers; "warning" for the original
six); and `confirms`, the deliberate positive twin of
`ValidationFailure`, withheld from `total_missing` on a pass since
presence is not agreement. Frontend: four new mood-invariant severity
tokens, pale in both Day and Night per the operator's own correction
to the first mock-up (*"can you use the paler 'day' colours for the
night scheme also?"*) rather than redarkening the general
warning/success tokens used in roughly fifteen other places; a
three-pass deterministic paint order in `markFields()` so a danger
always wins a field over a warning or an ok, never dependent on which
entry the backend happened to list first. Found and fixed, along the
way, a genuine pre-existing off-by-one in the line-cell marking logic
(`row.children[index + 1]` read the wrong cell — the field *after* the
named one, or the remove button's own cell for the last field — should
have been `index`; present since before this decision, caught only by
screenshotting a real line cell for the first time, which nothing
before this change had done). Visually verified against the real
integrated markup with Playwright — not just the standalone mock-up
already shown and approved — in both Day and Night. 20 new tests
across `vf-app` (15) and `vf-ui` (5), plus two existing `vf-ui` tests
rewritten in place for the new tiers, all fail-first verified. Full
suites: vf-app 1936/1936, vf-licence 320/320, vf-ui 74 Worker + 709
browser, all passing; `eslint` clean; `scripts/check-citations.py`
clean (400 records). Touches `vf-app` (`validation.ts`,
`invoice-facts-route.ts`, `key-fields-route.ts`), `vf-ui`
(`tokens.css`, `app.css`, `viewer.js`), and `vf-licence` (migration
`0124`, `test/setup.ts`, `test/string-coverage.test.ts`) — no
`vf-admin` change. `key-fields-route.ts` wires header-level
`po_mismatch` only, documented at the call site: its `lines.results`
is a pre-existing, unparsed line-facts shape this decision does not
reach into. Not yet pushed — waiting on the operator, same as every
other decision here before its own "pushed and deployed" line is
written and independently confirmed.

**A real gap in this session's own verification, worth recording
plainly.** `origin/main` fetched directly read the right commit at
every step, confirming the push each time — that part of the usual
"check, don't just trust the report" discipline held up. But this
session then fetched `viewer.js`/`page-renderer.js`/`app.css` from the
live site *repeatedly*, each time with a freshly generated,
never-before-used cache-busting query string, and every one of those
fetches reported the old, pre-0394 content — through two full
`wrangler deploy` runs, a cleared `.wrangler` cache, and a fresh
Cloudflare Worker Version each time (confirmed via `wrangler
deployments list`, each new version at 100% traffic). The operator was
asked to redeploy twice and consider a cache purge on the strength of
those fetches. **The deploy was correct the whole time.** The operator
opened the actual pop-out window in their own browser and the Timeline
/ Chat column was there. Re-fetching the exact same URL immediately
after that confirmation *still* returned the old content to this
session's own fetch tool — so the false negative was not fixed by the
operator's redeploys, because there was never anything for a redeploy
to fix. The likely cause is caching somewhere between this session and
the live site (this environment's outbound HTTPS runs through a
pre-configured proxy) that does not key on the query string the way
earlier decisions in this project assumed it did — decision 0384's own
handover notes a *15-minute* stale read that a cache-busted refetch
fixed; this one did not clear even after several distinct cache-busted
attempts spread over multiple minutes, which is a different and worse
failure mode than that earlier one. **Lesson for next time: when a
fetch-based deploy check disagrees with the operator directly looking
at the page, trust the operator** — do not ask for a second redeploy
or a cache purge on the strength of this session's own fetch alone
without saying plainly that the fetch tool itself may be the thing
that is wrong.

`vf-licence`'s migrations `0122` and `0123` have since been applied to
the remote by the operator, directly — `python3
migrations/apply_migrations.py --remote --migrations-dir
workers/vf-licence/migrations --database vf-licence-poc`, both
migrations landing with checksums and no errors (see the correction
below the decision-0393 paragraph: this session had first wrongly
reported no such process existed).

**A third instance of the same false negative, same session, same
endpoint — recorded rather than acted on again.** After the operator
ran the migration, this session checked `GET
/api/ui-strings?locale=en` on the live deployment and got a
part-right, part-wrong-looking result: `viewer.previouspage` and
`viewer.nextpage` showed the new wording, but `viewer.openinwindow`
still showed the old "Open in a separate window" and `viewer.highlight`
did not appear at all — reproduced identically across two independent,
freshly cache-busted fetches. Given the gap already documented above
(this exact fetch, against this exact site, giving a confident wrong
answer more than once today), this session declined to report it as a
confirmed bug and instead asked the operator to check two things
directly in their own browser rather than trust the fetch again: the
pop-out placeholder text, and the Highlight button's tooltip. **Both
came back correct** — the placeholder reads "Document open in a
separate window" (`0122`) and the Highlight button's hover text reads
"Highlight", not the raw key (`0123`). So `0122` and `0123` are both
fully live, and this session's own `/api/ui-strings` check was wrong a
third time, on partial data this time rather than a flat stale read —
worth noting as a *different* wrong shape from the first two instances
(entirely-stale content, twice, versus a plausible-looking mix of old
and new this time), which argues against a single simple explanation
like a slow-to-invalidate cache and for treating this session's fetch
tool against `app.vibefinance-ai.com` as unreliable in general, not
just slow. Restating the lesson already recorded above because it held
again: **when this session's own fetch disagrees with what the
operator sees directly, the operator is right.**

**Decision 0393 (filling the row, and a number to ring) is pushed and
deployed, with one part still outstanding**: every `vf-ui` change
(`app.css`, `viewer.js`) is confirmed live — the wording change is
data, not code, and needs the `vf-licence-poc` remote D1 migrated
separately from a `wrangler deploy`; that has not happened yet (see
"Where things stand" and the paragraph below). Everything else is
deployed and confirmed. Decision 0392 (more room
in every direction) was reported pushed and deployed, and checked
rather than taken on that report alone: `origin/main` fetched directly
reads `7d9a63b`, matching this session's own `main` exactly; the live
`app.css`, fetched cache-busted, has `#viewer .columns.docpoppedout`'s
`grid-template-areas` with `"parties parties header"`, `.vcanvas.zoomedin
{ max-width: none; }`, `.vcanvasholder.pannable { cursor: grab; }`, and,
inside the narrow `@media (max-width: 1100px)` block, the single-column
reset for `#viewer .columns.docpoppedout` — all exactly as built; the
live `viewer.js`, fetched cache-busted, has `setDocPoppedOut` toggling
`docpoppedout` via `classList.toggle`, and `documentPanel`'s second
`onPoppedOutChange` parameter called after toggling
`normalBody.hidden`/`placeholderBody.hidden`; the live
`page-renderer.js`, fetched cache-busted, has the `zoomedIn` toggle on
`.zoomedin`/`.pannable` and the `pointerdown`/`pointermove`/`pointerup`
drag handlers with `setPointerCapture`. Decision 0391 (the
Document card stops borrowing space) was reported pushed and
deployed, and checked rather than taken on that report alone:
`origin/main` fetched directly reads `bb818bb`, matching this
session's own `main` exactly; the live `app.css`, fetched cache-busted,
has `#viewer .columns`'s `position: relative`, `.c-document { ...
position: absolute; inset: 0; }`, `.c-document .vpreview { height:
100%; min-height: 0; }`, and, inside the narrow `@media (max-width:
1100px)` block, `.c-document { position: static; }` — all exactly as
built. Decision 0390 (three
fifths, two fifths, and a freed rail) was reported pushed and
deployed, and checked rather than taken on that report alone:
`origin/main` fetched directly reads `a9af7bb`, matching this
session's own `main` exactly; the live `app.css`, fetched cache-busted,
has `#viewer .columns`'s `grid-template-columns: minmax(0, 3fr)
minmax(0, 2fr)`, `#viewer .vrail { display: none; }`, and
`.c-document .vpreview { height: 100%; }` exactly as built. Decision
0389 (the country stays a code) was reported pushed and deployed, and
checked rather than taken on that report alone: `origin/main` fetched
directly reads `310b5fd`, matching this session's own `main` exactly;
the live `viewer.js`, fetched cache-busted, has `addressBlock()`
reading `party.country` alone, with no `party.countryName` anywhere in
its `lines` array. Decision 0388 (the
process row and Document card) was reported pushed and deployed, and
checked rather than taken on that report alone: `origin/main` fetched
directly reads `6de0573`, matching this session's own `main` exactly;
the live `app.css`, fetched cache-busted, has `#viewer .columns`'s
`grid-template-areas` exactly as built, `.exceptions { display: none;
}`, and the plain `.columns` rule Sources uses still reads
`align-items: start` with no named areas of its own. Decision 0387
(the Seller/Buyer cards) was reported pushed and deployed, and
checked rather than taken on that report alone: `origin/main` fetched
directly reads `8278aeb`, matching this session's own `main` exactly;
the live `viewer.js`, fetched cache-busted, calls `pair()` for Name
and VAT only and no longer for endpoint/email/phone, and
`addressBlock()` returns a plain `.sfield`; the live `app.css`,
fetched the same way, has `.sellergrid { grid-template-columns:
minmax(0, 1fr); ... }` and no `.sfield.address` rule anywhere. Bundle
0553, the previous one, is confirmed live too — a fresh clone of the
real `origin/main`, made while verifying this one, found it already
at `eadafef`, settling in the operator's favour a question this
handover had left open (whether that one genuinely reached the
remote). Decision 0383 (phase 3 of
the document viewer — a hybrid PDF's embedded XML retained as its own
artifact) touched `vf-app` (migration `0070`, plus
`document-storage.ts`, `document-token.ts`, `document-route.ts`,
`index.ts`, `invoice-facts-route.ts`, `source-capture-route.ts`) and
`vf-ui` (`viewer.js`) — no `vf-licence` or `vf-admin` file changed, so
neither Worker needed redeploying.
**Confirmed against the live origin, not just reported, as far as this
session can reach**: `origin/main` was fetched directly and reads
`4d44b59`, not taken on the operator's word alone. `vf-ui`'s deployed
`/viewer.js` was fetched and does contain `showXmlPreview`'s
`stored.embeddedXmlDocument` check. **`vf-app`'s own deploy and
migration `0070`'s application to `vf-app-poc` could not be checked
the same way from here** — every route that would show the third
document type sits behind session auth, and this session has no D1
credentials to query the remote schema directly — so those two rest on
the operator's own report of "pushed and deployed," the same standard
`git push` itself rested on before this session could fetch and check
it.
**vf-app's count reads 1921, up from 1912** — the third document
type's own tests, plus two real bugs caught before shipping:
`preferredDocumentType`'s `ORDER BY CASE` had no `ELSE`, so the new
type would have silently outranked both existing ones (SQLite sorts
`NULL` first, ascending); and `invoice-facts-route.ts` computed "which
document the preview shows" with its own ad-hoc query that had only
ever agreed with `preferredDocumentType()` by coincidence (0383).
**vf-ui's browser count reads 653, up from 651** — this phase's two
new XML-tab tests. Unhandled rejections read 137, was 135 at 0382 —
the same pre-existing class (0380), not investigated further this
arc.
`vf-admin` and `vf-licence` untouched this arc.

**Decision 0384 (phase 4 — the pop-out window) is built, pushed, and
deployed.** Touches `vf-ui` only (`viewer.js`, plus three new files —
`document-window.html`, `document-window.js`, `app.css` — and
`index.html` reduced to a `<link>` after its inline CSS moved out) and
`vf-licence` (migration `0121`, four new `ui_strings` keys, no Worker
code). `vf-app` and `vf-admin` untouched — confirmed via `git status`
showing zero files changed in `vf-app`, not assumed from the file list
alone, and its full 1921-test suite was rerun anyway.
**Confirmed against the live origin, not just reported, as far as this
session can reach**: `origin/main` fetched directly and reads
`abb300e`, matching this session's own `main` exactly. `vf-ui`'s
deployed `document-window.js` was fetched and matches this phase's
file exactly. Its deployed `viewer.js` was fetched too — the first
fetch came back from this session's own 15-minute cache and, read
literally, looked like a stale deploy (no `POPOUT_NAME`, no
`buildDocTabs`); a cache-busted refetch of the same URL found both,
plus `openDocumentWindow`, at the expected place in the file. Worth
naming plainly rather than quietly correcting: the first read was
wrong, not the deploy. **Migration `0121`'s application to the live
`vf-licence-poc` database could not be checked the same way from
here** — this session has no `CLOUDFLARE_API_TOKEN` to query the
remote D1 database directly (`wrangler d1 execute --remote` refuses
without one), and nothing public exposes `ui_strings` — so that rests
on the operator's own report, the same standard `vf-app`'s migration
`0070` rested on at decision 0383.

**There are four Workers now.** `vf-app` per customer, `vf-licence`
shared, `vf-ui` shared — the customer's interface, its own deployment
because binding it to `vf-licence` would mean every UI change
redeploying the component that mints licence tokens for the whole fleet
(0099) — and `vf-admin`, the operator's, behind Cloudflare Access
(0186).

`shared`'s own three known failures: two are time-expired JWT keys in
the licensing token tests, failing on `main` since before any of this
work. The third — `migration/table-classes.test.ts`, "names each one
exactly once" — reports six unclassified tables, not the four first
found on 15 September: `_supplier_links`, `dashboard_cards`,
`dashboard_cards_new`, `document_comments`, `org_spend_limits`, and
`org_teams_new`. The last two were added by decisions 0334 and 0333
respectively, before this update, and never classified either — worth
a real fix, still not done.

---

## What the system does

**`docs/PROGRESS.md` is the map** — what exists, what does not, and the
reasoning for each. This page does not repeat it.

In one paragraph: an invoice arrives by email, by upload, or as UBL. It
is captured whether or not anything can read it, evaluated against rules
a customer wrote **in plain English**, and routed through a process of
stages where people key, approve and return it. Every visible word comes
from the control plane and every colour from a token, so a wording fix
or a new language is rows rather than a deployment.

**Ten screens**, grouped in the side nav (0346): Dashboard, Tasks and
Documents under Accounts payable; Suppliers under Supplier management;
Access, Sources, Purchase Orders, Rules and Processes under
Configuration — and the viewer that serves every stage. *(This line
read "Seven screens" until decision 0380, from before the Dashboard,
Purchase Orders and Processes existed.)* **Roles was renamed Access and
restructured into tabs this arc** (0333) — Org Units, Roles, People,
Teams, no longer four sections on one long scroll, with Org Units and
Roles themselves hidden from a delegated administrator holding only
`Admin.UserManagement`. Roles itself dates to 0319–0331: read for
anyone holding `Admin.Configure` or a scoped `Admin.UserManagement`,
write (creating and editing a role, assigning and revoking one,
creating a person) for the same permissions, kept deliberately
separate — editing what a role itself grants is instance-wide and
never delegable, where assigning an existing role to a person already
was (0201) and stays so. **Teams are real** (0332): the two routes that
already existed gained the three that did not (list, remove a member,
rename), every one gated, and every team now belongs to exactly one
org (`unit_id NOT NULL`, migration 0064) rather than sitting outside
the scoping every person already has. **A person's own properties are
real too** (0334): cost centre, manager, address, and a derived Budget
Holder flag, plus a genuinely new spend limit distinct from the
existing approval limit. **Creating and editing an org unit is real**
(0335), closing a real, previously-unauthenticated `POST /org/units`
gap along the way. **The org list is a real tree, not a flat sort**
(0336) — a child now sorts immediately beneath its own parent, the
way the screen's own indentation had always implied it should.

**Role allocation and property assignment are two separate pop-outs
again** (0337), each reached by its own icon in the row rather than a
single click on the row itself (0338 moved those icons into their own
columns once stacking them beneath a cell's own text grew every row
too tall) — reported live as *"not very user friendly"* when 0334
first combined them into one. The approval and spend limit currency
fields are a closed dropdown now, not free text (0339), corrected
twice more after building: to the real, researched Peppol BIS Billing
3.0 / ISO 4217 list rather than a stated four-currency guess (0340),
then filtered to the 156 of those 178 codes a company can actually
purchase with — precious metals, bond-market units, and ISO 4217's own
"funds" excluded (0342) — with the field's own width fixed twice more
along the way (0341, 0343, 0344).

**The side nav is grouped under three static headings** (0346):
Accounts payable, Supplier management, Configuration — distinct from
a single, collapsible "Vibe AP" folder decision 0274 built and 0276
reverted; nothing here expands or collapses, and a heading with
nothing unlocked beneath it is never shown. **Sources gained icons on
Rename, Retire, and a repositioned Create action** (0347), and its own
Rename and Retire confirmations are real, in-app pop-outs now rather
than native browser dialogs, which could never be made to look like
part of this app (0348).

**An org switcher** sits in the topbar for the first time: a person
holding a role at more than one org picks which one they are looking
at, and Tasks, Documents, Dashboard, and Suppliers all narrow to it
(0313–0316) — narrowing what is shown, never granting anything a
person could not already reach some other way.

**An invoice bills a company** (decision 0226), matched on its buyer
VAT id or electronic address. **Which department bears the cost is a
line-level question** and is not built — decision 0225 named three
things that were sharing the word *business unit*, and decision 0226
settled the first. The Coding stage, where a line is charged to a cost
centre or GL code, **does not exist**.

**The supplier mirror is built end to end** (decisions 0207–0219): a CSV
loads from the customer's ERP, an arriving invoice matches on the
seller's endpoint or VAT id, a pay site wins where several sites share a
number, and a load re-matches whatever was unmatched. **Nothing reads
the terms, hold, match option or tolerances** — they load, they display,
and no process consults them.

**Both party cards show our own record beside the image** (decisions
0219–0229), with a search on each for choosing by hand.

**And a supplier can be recorded before the ERP has one** (decision
0231). `erp_identifier` is nullable, `supplier.awaitingErp` is a fact a
rule can test, and **the next load adopts that row** and fills the
identifier in — which is decision 0233, and the whole sequence the
operator described. **The trigger now exists** (0350): Supplier
Maintenance is a real, separate workflow, not a stage on the existing
AP process, closing a gap decisions 0231 and 0233 both named and
deliberately left open until there was a real team and stage to write
the routing rule against.

**The Suppliers screen is complete as a piece** (decisions 0230, 0234,
0236, 0237): load a file or record one, click a row to hold, release,
activate, deactivate or edit — with a warning on save that the ERP is
the master and the next load overwrites this. **`supplier.onHold` is
testable and no rule reads it**, which is the same shape. **Real,
permission-based scoping arrived later** (0358): reading the list had
never been unit-scoped at all, and the dashboard's own supplier card
was silently using the wrong permission's visible set. **Search and
real, server-side pagination followed** (0378, mirroring 0376's own
work for Purchase Orders below) — which forced a fix to the status
ring and its click-to-filter, both of which had computed themselves
over the fully-loaded array in the browser and would have silently
gone wrong the moment that array became only one page.

**A UBL invoice is rendered as a document** (decisions 0205, 0206), at
capture and stored beside the original — A4 portrait, using OpenPEPPOL's
own CSS, code lists and labels, with a notice saying it is a rendering
and what of. **We could not run their stylesheet**: it is XSLT 2.0,
browsers do 1.0, and SaxonJS fails on import inside `workerd`.

**Proven on real documents**, not only in tests: a photographed invoice
has been read automatically and reached Payment-eligible with nobody
touching it, and one the model could not read was retained, explained on
screen, and left to be keyed.

---

## Since 15 September (0349–0380)

**Three genuinely separate arcs**, each closing a gap this document
itself used to name as open, plus smaller fixes along the way.
Supplier Maintenance (0350) and Suppliers' own search, pagination, and
permission scoping (0358, 0378) are covered above, in context.

**Process version control, finally wired up** (0349, 0352–0354).
Decisions 0150 and 0160 designed and built the foundation and said
plainly what was missing — "nothing creates a v2." A draft is not new
schema: it is the rows already sitting at `processes.version + 1`,
real the moment the first edit is made, gone entirely if discarded.
Along the way, three more real, previously-unauthenticated or
unreachable write routes were closed, the same class of gap this
project keeps finding rather than a new kind. Two real bugs in the
Rules screen itself, both found live and both the same shape in
opposite directions (0351, 0355): a stage list with no `WHERE
process_id = ?` at all, and a rule list that showed everything rather
than nothing when a process had no stages.

**Purchase orders, built end to end** (0370–0377) — the largest single
piece of work in this window. Line-level matching against a real
Peppol BIS Order Only 3.3 vocabulary, CSV load alongside XML
ingestion, org derivation and real, permission-based access control
matching what Suppliers already had, then search, pagination, and a
full status lifecycle (Active/On-Hold/Closed, with Invoiced
Part/Full derived live rather than stored) mirroring Suppliers' own
mechanisms rather than inventing new ones. **A real SQL bug was found
and fixed by testing, not by inspection**: `GROUP BY status` silently
grouped by the real, underlying column rather than the computed
expression sharing its name, since SQL resolves an unqualified
identifier against a real column before a `SELECT`-list alias —
collapsing rows with genuinely different statuses into one group.

**The Dashboard reshaped, mostly in direct response to live reports**
(0359–0369): the default screen at login, two real width bugs found
one at a time because the first fix didn't look at the sign-in screen
too, the org switcher relaunching whatever is open instead of
reloading to the default, a bar chart for Waiting for Me with two of
its own bugs fixed after shipping, and card layout arrived at only
after two earlier attempts (0364, 0365) each made the same underlying
problem smaller without closing it — a card's own stored order and
the band sorting it into disagreeing — until the bands themselves were
removed entirely (0366).

**One bug, in two files, found only because a test exercised failure
after success**: `loadStatusCounts()`, on both Purchase Orders' and
Suppliers' own status charts (one screen's own version was written by
copying the other's), returned early on a failed fetch without ever
resetting its own counts to `null` — a chart that had once loaded real
data kept showing it, silently stale, after a later, genuine failure.
Fixed in both files the same day it was found.

**The viewer's document frame, and a premise measured before fixing
it** (0380). A review of every past discussion of the viewer found a
comment claiming the preview was "refreshed when somebody returns to
the tab" — nothing did. Measured in Chromium before building that: an
expired link breaks nothing while a frame sits, scrolls, zooms, hides
or the tab changes; it breaks only when the frame *loads again*, and
then shows `vf-app`'s JSON error rather than going blank. So the fix is
the frame's own `load` event, not a timer — a return-to-tab refresh
would have reloaded a working PDF and lost the reader's place. The same
review corrected three stale comments, four missing `SUPERSEDED.md`
rows and one misattributed one, and the screen and test counts above. **Safari and Firefox were not measured.**

**Smaller, on-request fixes**: the Org Units table now shows Parent
Org and Tax Identifier as real columns, both data the edit form
already had and the table simply never showed (0379); the recorded
title "VAT ID" reads "Tax Identifier" everywhere, one string read by
both the table and the form so the two can't drift apart.

**The document viewer's ultimate shape was designed, and its first
phase built** (`docs/design/document-viewer.md`, decision 0381). The
operator's own request — one viewer for images, image PDFs and
structured PDFs, a thumbnail rail, rotate and zoom, and an Expand that
pops the whole document panel (Timeline/Chat included) into its own
window for two-screen use — was parked since decision 0123 and picked
back up straight out of 0380's review. Three decisions came out of that
conversation: build a real client-side page renderer rather than lean on
the browser's own PDF viewer (phase 2, the largest single piece), keep
retaining every page of a multi-page scan rather than reconsidering
whether to, and have the pop-out carry the whole panel, not just the
image. **Phase 1, built now, is backend only**: checking decision 0068's
own claim that the multi-page flow "deletes on finalise" turned up
nothing that deletes anything, anywhere — every page has been sitting in
R2 since decision 0045, unreachable rather than gone, because finalising
never linked a multi-page invoice into `invoice_documents`. Two new
routes (`GET /invoices/:id/pages`, `POST
/invoices/:id/pages/:n/document-url`) and one unauthenticated fetch route
(`GET /document-pages/:token`) now expose what was always there, with
their own signed token shape alongside decision 0073's. Nothing in the
viewer called any of it yet — phase 2 is what calls it.

**Phase 2, the client-side page renderer, built the same day** (0382).
One thumbnail rail, one zoom, one rotate, shared by images and PDFs —
`page-renderer.js` replaces the `<img>`/`<iframe>` split the Document
tab used since decision 0123. The one open question the design
document left — reset rotate/zoom on open, or remember it — was asked
directly and decided: reset, a session convenience rather than data.
pdf.js is vendored locally (`workers/vf-ui/public/vendor/pdfjs/`), not
loaded from a CDN, the same reasoning decision 0124 gave the font.
**Nobody planned this separately, but phase 2 retires decision 0380's
whole problem**: that bug could only happen because an `<iframe>` is a
live connection that can reload with a link gone stale; a canvas is
pixels already drawn, so nothing reloads it and nothing can ask an
expired token again. A real bug was caught by the new test suite's own
completeness check before it ever shipped — `REAL_DEPS` was missing
the `resolvePages` key `pageViewer()` actually calls, watched to fail
and fixed. Phases 3 through 5 are still design only.

## Waiting on you

**Nothing blocks the next piece of work.** Six things worth settling,
none urgent.

### 1. Who creates the `org_users` row — **answered**

**Provisioning does**, for the requester, who becomes the customer's
administrator (0117). `signup_requests` already names them, so there is
no bootstrap account to invent — and approval still gates provisioning,
which the administrator is a consequence of rather than a substitute
for.

Not built, and **its place in the order moved**. Decision 0117 put it
third behind email; decision 0126 made the **Cloudflare API half of
provisioning** the blocker in front of both, because provisioning is
where the `org_users` row is written and provisioning cannot yet create
anything.

### 2. Alerting on failed sign-ins

*"A lockout policy that generates no alert is half a control."* Attempts
are recorded and shown to the person on their next sign-in (ISO 27001
A.8.5), but nobody is **told**.

Waiting on email, which decision 0117 promoted from *"would be nice"* to
the gate on onboarding itself.

### 3. Do the party panels show enough?

Decision 0115 gave the seller and buyer their own panels, and most of
their fields default to `read`. If they look thin, that is configuration
(0114) rather than code — adjustable per customer without a deployment.

### 4. Two actions that sound like the same thing

Found twice on the first day of real use (decisions 0153, 0158).
*"Hold it for review"* wants `assign_task` and the vocabulary offers
`hold_until`, which holds until a **date**. *"Assign to the AP team"*
wants `assign_task` and the model chose `assign_org`, which assigns an
**operating unit** (0111).

Both are the same question: **does the compiler's prompt teach the
difference, or does the vocabulary stop sounding ambiguous?** A prompt
is cheaper and keeps the closed set small, which 0031 argues for.

### 5. Does the sources screen read right?

**Renaming is free** — `name` is display, `id` is the key, and nothing
references the name:

```
UPDATE process_stages SET name = 'Intake' WHERE id = 'received';
UPDATE process_stages SET name = 'AP Review' WHERE id = 'review';
```

**Removing Line Review used to need decision 0150's own versioning,
which now exists** (0349). It has a completed task against it, so
deleting the row directly would still fail on a foreign key or orphan
history — but a draft of the AP process can now genuinely drop it from
a new version's own membership, with existing instances finishing on
whichever version they started, exactly the mechanism decision 0150
designed. Nobody has actually done this yet; the mechanism blocking it
is what's gone.


Decision 0134 removed every success message from it: a retired source
shows *"Retired"*, a deleted one is gone, and the list is the answer.
**If an action now feels like nothing happened**, that judgement was
wrong and the message should come back.

### 6. Should the line comparison move into the panel?

*"Lines total 150.00 · differs by 30.00"* sits under the line table and
was **read as an exception** (0119). It is not: it is live feedback as
somebody types, where the panel reflects a stored verdict.

They are genuinely different, which is why they sit apart. **The
distinction was not obvious to the person looking at it**, which is
worth more than the argument for keeping them separate.

---

### 7. Columns that are empty on every invoice

Extraction reads a description and an amount per line and nothing else,
so `Line no.`, `Unit`, `Item net price`, `Quantity` and `VAT category`
are blank on every real document (decisions 0171, 0172).

**A column that never has a value teaches somebody to ignore columns.**
Either extraction learns to read them — `BT-152` in particular, which
two derived columns depend on — or a field with nothing in it stops
being shown.

### 8. What "how much has been keyed" should count

Decision 0175 removed a status reading *"0/4 fields known"* on every
document, counting four fields chosen when the screen was written.

The idea was right and the implementation was not. **A real version
counts the fields the current stage asks for**, which is a question
about field visibility rather than about a hardcoded list.

### And two data changes, not code ones

**The live Validation rule** reads *"assign a task to the AP team
requiring **AP.Review** permission"* where it should say `AP.Validate`.
The rule engine is doing exactly what the sentence says; **the sentence
needs recompiling** and taking through the activation gate. No deploy.

**And Approval spawns two tasks per invoice** — seventeen open requiring
`AP.Approve` and seventeen requiring `AP.Review`, against the same
stage. That may be parallel approvers by design (0074 describes how
multiple approval works) or a rule firing twice. **Nobody has
established which**, and the two readings have different fixes.

---

## Suggested next pieces

**Phase 3 of the document viewer is built, pushed, and deployed**
(decision 0383 — *"Lets do the order written, so phase 3 next,"* the
operator's own answer when phase 2 closed). The embedded XML in a
structured PDF (Factur-X, ZUGFeRD) is now its own retained artifact,
so those invoices get an XML tab the way a bare-XML invoice already
does, rendered the same way. A real regression was caught before it
shipped: `invoice-facts-route.ts` computed "which document the
preview shows" with its own ad-hoc query rather than calling
`preferredDocumentType()` — the two had only ever agreed by
coincidence, and widening `document_type` to a third value broke it.
Confirmed live where this session could reach: `origin/main` fetched
directly at `4d44b59`, `vf-ui`'s deployed `viewer.js` fetched and
checked for the new logic. `vf-app`'s deploy and migration `0070`
rest on the operator's own report, per the table above.

**Phase 4, the pop-out window carrying the whole document panel, is
built, pushed, and deployed** (decision 0384 — *"Yes please - lets
look at phase 4,"* the operator's own answer when phase 3 was
confirmed live). Expand now navigates to a real page of this app,
`document-window.html`, carrying the same tabs and Timeline/Chat the
embedded card shows, in place of decision 0073's raw
`window.open(signedUrl)` on a blank tab — 0073's signed-URL mechanism
itself is untouched, only the chrome around it changed. A fixed
`window.open` name makes the browser itself refuse a second pop-out;
opening a different task while one is already up retargets that same
window, the operator's own explicit answer (*"there should not be a
situation where the user has multiple pop-out windows open"*) to the
one question the design document had deliberately left open. Required
extracting the app's entire inline CSS out of `index.html` into a new
`app.css`, since a second real page had no other way to share the
same classes. Confirmed live where this session could reach:
`origin/main` fetched directly at `abb300e`; `vf-ui`'s deployed
`document-window.js` and `viewer.js` both fetched and checked for the
new logic (the first `viewer.js` fetch came back from a stale
15-minute tool cache and had to be re-fetched cache-busted to see the
real deployed file). Migration `0121`'s application to the live
`vf-licence-poc` database rests on the operator's own report — this
session has no D1 credentials to query it directly, same as `vf-app`'s
migration `0070` at decision 0383.

**Phase 5 is built, pushed, and deployed** (decision 0385 — the
operator asked directly whether phase 5 was genuinely a no-op or had
something real left in it). Checked rather than assumed: both
behaviours phase 5 was named for really are already gone — no
surviving call site for the old raw-file Expand, no surviving
`<img>`/`<iframe>` split. One real leftover, in the CSS rather than
the JS: `app.css` still carried `.vimage`, styling an `<img>` decision
0382 had already stopped creating; removed, with a comment explaining
why the neighbouring `.vframe` rule (the XML tab's own, still-live
frame) stays. This closes `docs/design/document-viewer.md`'s
five-phase plan in full. Touched `vf-ui` only (`app.css`), no
migration, no other Worker. **Confirmed against the live origin and
the live deployment, not just reported**: `origin/main` fetched
directly and reads `9e77954`, matching this session's own `main`
exactly; `vf-ui`'s deployed `app.css`, fetched cache-busted, no longer
contains the `.vimage` selector — only the explanatory comment
mentions the name.

**Decision 0386 (the pop-out fills the window) is built, pushed, and
deployed.** Reported live from a screenshot after phase 5 shipped: the
pop-out's card sat centred with a 1100px width cap nothing else in
`app.css` has, and no rule stretched it to fill the window's height
either. Both replaced with a flex chain — `body.docwindowbody`/
`#docwindow-root`/`.panel` each `flex: 1`, `.vpreview`'s own height
reset to `auto` inside this page rather than given a second guessed
constant. Measured in a headless Chromium at two window sizes rather
than reasoned about on paper: the panel's own box tracked the viewport
exactly at both (860px and 610px tall against 900px and 650px
viewports, minus this page's own padding). Touches `vf-ui` only
(`app.css`), no migration, no other Worker.
**Confirmed against the live origin and the live deployment**:
`origin/main` fetched directly and reads `3ecfbc5`, matching this
session's own `main` exactly; `vf-ui`'s deployed `app.css`, fetched
cache-busted, no longer contains the `max-width: 1100px; margin: 0
auto` rule and does contain the new `body.docwindowbody { display:
flex; ... }`. One thing noticed and left open rather than fixed here:
the Timeline / Chat tab, once stretched the same way, leaves visible
empty space below its own feed and input box — worth a decision from
the operator, since tightening it touches CSS the embedded card also
uses.

**Decision 0387 (the Seller/Buyer cards give up a column) is built,
pushed, and deployed.** Asked directly for screen real estate:
E-address, E-mail and Phone dropped from both cards; `.sellergrid`'s
two parallel columns (Name/VAT beside Address) became one, vertical,
in the order Name → VAT no → Address. The hedge in "make the card
height smaller if possible" was checked rather than assumed away —
two parallel columns becoming one sequential stack could plausibly
have made the card *taller* once the three removed rows' own height
stopped hiding behind whichever column was already tallest. Measured
in a headless Chromium against a realistic fixture (a long supplier
name, a long country name) before and after the edit rather than
reasoned about on paper: **421px before, 263px after** — the wrapping
two half-width columns were causing cost more height than the extra
stacked rows ever gave back. A second, smaller change landed the same
arc, reported live once the wider card was in front of the operator:
the address itself moved from beneath its own label back to beside
it, superseding decision 0280 (whose reasoning was specific to a
column half the card's own width, which no longer exists once
`.sellergrid` is one full-width column). Touches `vf-ui` only
(`viewer.js`, `app.css`, `test-browser/viewer.test.ts`), no migration,
no other Worker. Three tests changed — one that asserted an email
address rendered (now asserts the opposite), two decision-0280 tests
that read a CSS rule and a DOM class that no longer exist (replaced
with their decision-0387 equivalents) — each watched fail against the
pre-edit code before being trusted. Full suites: vf-ui 74 Worker + 665
browser, both passing; `eslint` clean. **Confirmed against the live
origin and the live deployment, not just reported**: `origin/main`
fetched directly and reads `8278aeb`, matching this session's own
`main` exactly; `vf-ui`'s deployed `viewer.js` and `app.css`, both
fetched cache-busted, carry every change described above and no
`.sfield.address` rule or endpoint/email/phone `pair()` call anywhere.

**Decision 0388 (the process row and Document card join the grid) is
built, pushed, and deployed.** Two asks, each mocked up in a
headless Chromium and sent as a screenshot before being built, and
each approved before the next line of production code changed for it.
First: the process chevrons moved from a full-width panel above
`.columns` into the left column's own grid area, so their width
matches the Seller/Buyer cards by construction. Second: `#viewer
.columns` gained named `grid-template-areas` so the Document card's
own area spans exactly the process+parties+header rows — pixel-
measured, its bottom and the header card's bottom both land at
768.33px — and Lines now runs full width under both columns instead of
being confined to the left one, filled with the same flex chain
decision 0386 built for the pop-out rather than a second guessed
height. The Exceptions card is hidden, the operator's own words,
"without removing the code, just the visibility" — one CSS rule,
`.exceptions { display: none; }`, and deleting it is the entire way
back. **The shared `.columns` class was the real hazard here**:
`sources.js` uses the same class name for an unrelated two-panel
layout (decision 0177), and a bare `.columns` override would have
reached it too, pushing its real content down by four newly-implicit,
empty, gapped rows. Every new rule is scoped under `#viewer` or a
class unique to this screen — checked, not assumed, by rendering both
screens' own use of `.columns` side by side in a synthetic page and
reading `getComputedStyle` back: `#shell .columns` (Sources' own
scope) still reads `grid-template-areas: none; align-items: start`,
untouched. Decision 0281's own nav test slices this stylesheet by
counting closing braces from the first `@media (max-width: 1100px)`
occurrence; every rule this decision would have added ahead of `.nav`
in that same block pushed the test's own target text out of the
window it slices — watched fail, then fixed by giving this decision's
rules a second block of their own placed after the one that test
depends on, not before it. Touches `vf-ui` only (`viewer.js`,
`app.css`), no migration, no other Worker. No test needed changing —
none asserted on `.columns`'s previous plain-stack shape in a way this
decision's own checks (above) didn't already cover by other means.
Full suites: vf-ui 74 Worker + 665 browser, both passing; `eslint`
clean. **Confirmed against the live origin and the live deployment,
not just reported**: `origin/main` fetched directly and reads
`6de0573`, matching this session's own `main` exactly; the live
`app.css`, fetched cache-busted, carries `#viewer .columns`'s named
areas, `.exceptions { display: none; }`, and a still-untouched plain
`.columns` rule for Sources.

**Decision 0389 (the country stays a code, superseding decision 0221
in part) is built, pushed, and deployed.** Asked directly,
GB-expanding-to-"United Kingdom of Great Britain and Northern
Ireland" as the example: "I think in all cases, we can stick with the
short form country code." 0221 chose the expanded Peppol name on
purpose — "say what the image says" — and that reasoning does not
survive a long form the invoice itself never prints either.
`addressBlock()`, the one function both `sellerPanel()` and
`buyerPanel()` call, now reads `party.country` alone rather than
`party.countryName ?? party.country` — one fix reaches both cards, as
asked. Checked rather than assumed: `countryName` is derived from
`country` (`CODE_LISTS.iso3166?.[code]?.en ?? code` in
`invoice-facts-route.ts`), so there is no case where the name is
present and the code is not, and it is left computed and sent but
unread — the same call decision 0387 made for the fields it dropped
from these cards. Touches `vf-ui` only (`viewer.js`,
`test-browser/viewer.test.ts`), no migration, no other Worker. Two
existing fixtures changed from a long country name to `country: "GB"`,
and one new dedicated test stubs an invoice carrying **both**
`country` and `countryName` (the real backend's own shape) and asserts
the rendered cards show the code and not the name — watched fail
against the pre-edit code first. Full suites: vf-ui 74 Worker + 666
browser, both passing (663 unchanged, 2 changed, 1 new); `eslint`
clean. **Confirmed against the live origin and the live deployment,
not just reported**: `origin/main` fetched directly and reads
`310b5fd`, matching this session's own `main` exactly; the live
`viewer.js`, fetched cache-busted, has `addressBlock()` reading
`party.country` alone — no `party.countryName` anywhere in its `lines`
array.

**Decision 0390 (three fifths, two fifths, and a freed rail) is built,
pushed, and deployed.** Asked directly against two mocked-up,
measured options: `#viewer .columns` moved from `2fr 1fr` (Seller,
Buyer and Document each roughly a third) to `3fr 2fr` (Seller/Buyer
share three fifths, Document two fifths) — approved as "I like this
balance." Measuring the Document card *before* touching anything,
`.vpreview` sat at exactly its own `min-height: 320px` floor — a rule
written for the pre-0388 layout (decision 0271), never revisited once
0388 made the card's height a function of the grid; the reason,
checked rather than assumed, is that 0388's own `height: auto`
override sizes to content on a plain block element whose real,
flex-computed height lives one level up, and an empty preview has no
content to size to. Changed to `height: 100%`, confirmed by measuring
`.vpreview`/`.vpagesroot`/`.vmain`/`.vcanvasholder` before and after:
all four now report a real, filled height rather than a fixed 320px
regardless of what the card was actually given. The thumbnail rail is
hidden while docked regardless of page count — `#viewer .vrail {
display: none; }`, the operator's own words, "the document image
thumbnail can be hidden when the card is docked... should the user
wish to view thumbnails then they can Expand" — a second, independent
reason alongside `page-renderer.js`'s own single-page `.hidden` logic,
which is untouched and still governs the pop-out window
(`#docwindow-root`) exactly as before. `.vmain`'s existing `flex: 1`
picks up the freed 92px automatically. Touches `vf-ui` only
(`app.css`), no migration, no other Worker. No test needed changing —
nothing asserted on `.columns`'s column-width value, `.vpreview`'s
computed height, or `.vrail`'s CSS `display`, checked by rerunning the
full suite rather than assumed; decision 0281's own fragile
brace-counting nav test still passes, since these rules landed in the
viewer's own, later `@media` block rather than the shared one it
slices. Full suites: vf-ui 74 Worker + 666 browser, both passing.
**Confirmed against the live origin and the live deployment, not just
reported**: `origin/main` fetched directly and reads `a9af7bb`,
matching this session's own `main` exactly; the live `app.css`,
fetched cache-busted, has `#viewer .columns`'s `grid-template-columns:
minmax(0, 3fr) minmax(0, 2fr)`, `#viewer .vrail { display: none; }`,
and `.c-document .vpreview { height: 100%; }` all exactly as built.

**Decision 0391 (the Document card stops borrowing space, superseding
part of 0390's own reasoning) is built, pushed, and deployed.**
Zooming an invoice grew the Document card itself, pushing large blank
gaps into the process/parties/header column beside it — reproduced
first, not assumed, with a genuinely tall test image, which measured
`.c-process`, `.c-parties` and `.c-header` all inflating together,
not just the Document card. The cause is CSS Grid's own "increase
sizes to accommodate spanning items" step, which runs for `auto`,
`min-content` *and* `max-content` tracks alike — checked by trying
`min-content` explicitly on those rows and watching the exact same
inflation happen anyway. There is no track-sizing keyword that lets a
spanning item's content need more room without its spanned tracks
growing to give it that room. `position: absolute` on `.c-document` is
what actually works — it removes the item from the sizing algorithm
while its resolved `grid-area` still becomes its containing block
(`#viewer .columns` gained `position: relative` for this to anchor
to), so the card is now capped to exactly what process+parties+header
add up to, every time. That surfaced a second, real regression, found
by re-measuring rather than assumed clean: 0390's own `.vpreview {
height: 100%; }` now resolves against a genuinely shorter parent on
some invoices, and the base rule's leftover `min-height: 320px`
(decision 0271) then won, growing the preview past its own card's
bottom, into the Lines panel — fixed with `min-height: 0` for the
docked case. The scrolling this implied, asked for separately mid-
turn ("it may be necessary to add scroll bars... to allow the user to
scroll to a specific part of the zoomed image"), needed no new code:
`.vcanvasholder { overflow: auto; }` has been there since decision
0382, and once the box stopped growing to swallow the overflow, that
rule is what shows the scrollbar — measured directly (`scrollHeight`
exceeds `clientHeight`; setting `scrollTop` actually moves it). The
narrow, single-column screen broke the same way building the wide fix
did — `document` has nothing else in its own row there to size itself
by once taken out of the algorithm, measured collapsing to `0` —
reset with `.c-document { position: static; }` inside that width's
own, pre-existing media query. Touches `vf-ui` only (`app.css`), no
migration, no other Worker. No test needed changing — nothing
asserted on `.c-document`'s `position`, on `.vpreview`'s `min-height`,
or on any pixel height in this chain; the full suite and decision
0281's own fragile nav test were both rerun after every step above,
not assumed clean at the end. Full suites: vf-ui 74 Worker + 666
browser, both passing — including a pre-existing class of 152
unhandled-rejection console errors in the browser suite (none of them
test failures), reproduced identically on a fresh clone of the
pre-0391 commit to confirm this decision did not introduce them.
Touches `vf-ui` only (`app.css`), no migration, no other Worker. **This
session had no push access to `origin/main`** — delivered as bundle
0562 for the operator's own pull/push/deploy sequence, which is how it
reached the remote. **Confirmed against the live origin and the live
deployment, not just reported**: `origin/main` fetched directly and
reads `bb818bb`, matching this session's own `main` exactly; the live
`app.css`, fetched cache-busted, carries every rule described above —
`#viewer .columns`'s `position: relative`, `.c-document`'s `position:
absolute; inset: 0`, `.c-document .vpreview`'s `min-height: 0`
alongside `height: 100%`, and `.c-document { position: static; }`
inside the narrow media query.

**Decision 0392 (more room in every direction) is built, pushed, and
deployed.** Asked directly, in four parts: whether zoom can go
past its own frame; whether the Document card's now-unused row (freed
by 0391) can be reclaimed once popped out, with Seller/Buyer/Header
sharing one row; whether the Lines card can grow into the space that
frees; and whether the pop-out placeholder can shrink to help free it.
The zoom control was never actually stuck — the canvas genuinely
redraws at a higher pixel resolution on every click, measured
1000→1250→1500→2000→3000px across five clicks — only `.vcanvas {
max-width: 100%; }` clamping the *display* width regardless of that,
and most invoices are already wider than their card even unzoomed, so
further clicks bought resolution the screen never showed more of.
Fixed by lifting the clamp only once zoomed in past the default step
(`zoomIndex > DEFAULT_ZOOM_INDEX`, a `.zoomedin` class toggled in
`draw()`), with drag-to-pan added on top via `pointerdown`/
`pointermove`/`pointerup`/`pointercancel` and `setPointerCapture` —
chosen over `window`-level mouse listeners specifically because
`pageViewer()` is called fresh per opened document with no teardown
hook (decision 0382's own design), so a `window` listener pair would
leak one more copy every time a document is opened; pointer capture
self-releases and never touches `window`, guarded with `?.` for jsdom
(decision 0121), which has no such method. For the reclaimed row, two
more complex approaches were mocked up, measured, and rejected first:
an equal-thirds split with the placeholder given its own dedicated
row (saved ~62px from the merge, cost ~50px back for the new row,
netting almost nothing — Lines in one case landed *worse*, 738px vs a
718px baseline), and moving Header's own DOM node into the Parties
container via JavaScript (worked, matched the eventual numbers almost
exactly at 521px vs 520px, but was more code for the same result).
What shipped moves nothing: `.c-header` stays exactly where it has
always lived, and a `docpoppedout` class toggled on `.columns` (by
`viewer.js`, via the same `popoutStateSetter` the placeholder already
uses) changes only `grid-template-areas`, so `parties` spans two of
three column tracks and its own pre-existing internal grid splits
Seller from Buyer automatically. The width ratio — 25%/25%/50% against
30%/30%/40% — was measured both ways before asking: 30/30/40 leaves
Header too narrow for its own natural layout, so it grows *taller*
instead of using the width (350px vs 258px), landing Lines at 613px
against 25/25/50's 520px, the opposite of the point of widening it.
Presented both, and the operator chose 25/25/50 directly. **A CSS
specificity bug caught and fixed before it shipped, not after**:
`#viewer .columns.docpoppedout` (ID + 2 classes) outranks the plain
narrow-screen `#viewer .columns` rule (ID + 1 class) regardless of
which `@media` block either is declared in, so an unscoped wide-mode
`.docpoppedout` rule would have kept winning even inside the existing
narrow `@media (max-width: 1100px)` block — reproduced deliberately
(a mockup run without the reset, showing the narrow columns cramped to
424px) before writing an equally-specific reset inside that same media
query. The placeholder itself shrinks from a box that filled the whole
card to a slim, right-aligned flex row sharing the Process row's own
line, costing no additional row height — the same trick that made the
equal-thirds attempt fail is exactly what this version avoids. A
temporal-dead-zone risk in the original single-expression construction
of `.columns` (`documentPanel()` calls its own `popoutStateSetter`
synchronously, during construction, which would reference `columnsEl`
before it existed if built inside the same expression) was avoided by
building `columnsEl` empty first and `.append()`-ing its children in a
later statement. Verified against the real production code, not
mockups alone — clicking the actual `Expand` button, stubbing
`window.open` the way the real test suite's `fakeWindow()` does — at
both 1400px and 900px viewports and through a full open → reflow →
close cycle, restoring the exact pre-Expand layout on close (process
72px/679px, document 562px/453px, lines at 718px, matching precisely).
The first pass at that last check used a fake `window.open` handle
whose `close()` was a no-op, so `handle.closed` never became `true`
and the real 700ms `watchPopout()` poll never fired — a bug in the
verification script, fixed by making the fake `close()` actually set
`closed = true`, matching a real browser window. Three new tests, each
watched to fail against the pre-fix code first (`git stash` on the
three production files, test edits kept, rerun to confirm clear
assertion failures, `git stash pop`). Touches `vf-ui` only (`app.css`,
`page-renderer.js`, `viewer.js`), no migration, no other Worker. Full
suites: vf-ui 74 Worker + 669 browser (666 pre-existing + 3 new), both
passing — 153 unhandled-rejection console errors (152 pre-existing +
1 new instance of the same known, tolerated "no stub for
/api/documents/inv-1/activity" class, not a regression). **This session
had no push access to `origin/main`** — delivered as bundle 0564 for
the operator's own pull/push/deploy sequence, which is how it reached
the remote. **Confirmed against the live origin and the live
deployment, not just reported**: `origin/main` fetched directly reads
`7d9a63b`, matching this session's own `main` exactly; the live
`app.css`, fetched cache-busted, has `#viewer .columns.docpoppedout`'s
`grid-template-areas` with `"parties parties header"`, `.vcanvas.zoomedin
{ max-width: none; }`, `.vcanvasholder.pannable { cursor: grab; }`, and
the narrow-media-query reset back to a single-column stack, all exactly
as built; the live `viewer.js`, fetched cache-busted, has
`setDocPoppedOut` toggling `docpoppedout` via `classList.toggle`, and
`documentPanel`'s second `onPoppedOutChange` parameter called after
toggling `normalBody.hidden`/`placeholderBody.hidden`; the live
`page-renderer.js`, fetched cache-busted, has the `zoomedIn` toggle on
`.zoomedin`/`.pannable` and the `pointerdown`/`pointermove`/`pointerup`
drag handlers with `setPointerCapture`. The operator's own screenshot of
the deployed UI confirms it visually too: Seller, Buyer, and Invoice
header sharing one row at the built 25/25/50 widths, and the pop-out
placeholder sitting compactly in the Process row's own line rather than
filling a tall card.

**Decision 0393 (filling the row, and a number to ring) is pushed and
deployed, with one part outstanding.** Asked against a screenshot of the
deployed 0392 layout: the placeholder sat visibly shorter than Process
beside it, and Seller/Buyer ended well above Header's own bottom —
both measured real (44px vs Process's 90px; 244px vs Header's 421px),
not assumed from the screenshot alone. Both traced to the identical
shape: `align-items: stretch` (0388) was already stretching the
*outer* grid item to match its row — checked directly, and it was —
but nothing told the *visible panel inside it* to fill that box, since
0392's own override (`height: auto; display: block;` on
`.c-document > .panel:not(.exceptions)`, reasoned at the time as
needing "neither... a height matched to anything else") had turned
off the general rule that would otherwise have done exactly that.
Deleting that override — rather than adding a second, competing one —
let the *existing* `.c-document > .panel:not(.exceptions)` rule (its
own `height: 100%` plus `flex: 1` on non-`.cardhead` children, written
for the docked, three-row case) apply here too. Fixing Document's own
side surfaced a **third instance of the identical bug, found only by
re-measuring after the first fix rather than assumed clean**: with a
realistic placeholder (badge text plus two buttons), the row can now
be *taller* than Process's own natural content, which left Process's
panel short instead — the same gap, moved to the other card. Process's
own panel needed the identical `height: 100%` fix. `.c-parties >
.parties` got the same one-line fix for the Seller/Buyer side — its
own internal grid (decision 0179's own comment: "its panels stretch to
the same row height") then stretches Seller and Buyer to fill it with
no further rule needed. All three are scoped to `.docpoppedout` alone,
and asked for directly for the Seller/Buyer case: "when the document
image is expanded only." Separately, the placeholder's actions changed
from decision 0392's row-format override back to the plain,
unmodified `.actionlink` square — deleted outright, not replaced, so
"Bring to front" and "Show here instead" now look like "Header Fields"
the same way every other cardhead action already does — and its text
moved left and reads "Document open in a separate window" (`en`)
rather than "Open in a separate window", a wording change carried by
`ui_strings` (migration 0122 in `vf-licence`, wired into
`test/setup.ts`'s own migration chain the same as every migration
before it) rather than decided in `viewer.js` or `app.css`. Two more
changes, independent of the layout fix: `addressBlock()` now joins
city and country onto one line ("Felixstowe, GB") rather than each
keeping its own; and Phone — dropped by decision 0387 along with
E-address and E-mail to give the card back a column — is reintroduced
alone, beneath the address, since `s.phone`/`b.phone` never stopped
being fetched onto `stored.supplier`/`stored.buyer`, only stopped
being read. Five new tests, all watched to fail against the pre-fix
code first, plus one existing test (decision 0384's own placeholder
test) corrected for the wording change — narrowed from an exact string
to the substring both wordings share, since checking the exact new
text is the newer test's job and one test asserting both would be
asserting the same fact twice for two different reasons. Touches
`vf-ui` (`app.css`, `viewer.js`) and `vf-licence` (migration 0122 +
`test/setup.ts`) only — no change to `vf-app` or `vf-admin`. Full
suites: vf-ui 74 Worker + 674 browser (669 pre-existing + 5 new);
vf-licence 320/320, both passing. `eslint` clean. **This session had
no push access to `origin/main`** — delivered as bundle 0566 for the
operator's own pull/push/deploy sequence, which is how it reached the
remote. **Confirmed against the live origin and the live deployment,
not just reported — with one genuine gap found, not assumed clean**:
`origin/main` fetched directly reads `0125d52`, matching this
session's own `main` exactly; the live `app.css`, fetched cache-busted,
has `#viewer .columns.docpoppedout .c-process > .panel`'s `height:
100%; box-sizing: border-box;`, no `.vpoppedoutactions .actionlink {`
anywhere, `.vpreview.vpoppedout .vthumb`'s `flex-direction: row;
justify-content: space-between;`, and `.c-parties > .parties`'s
`height: 100%` — all exactly as built; the live `viewer.js`, fetched
cache-busted, has `addressBlock()`'s `cityCountry` join and both
`pair(t("viewer.supplier.phone"), …)` calls. **The wording change did
not reach production with the rest of it** — `GET
/api/ui-strings?locale=en` on the live deployment still answers
`viewer.openinwindow` with the old "Open in a separate window", not
migration 0122's "Document open in a separate window", checked
directly rather than assumed alongside everything else that did land.
The cause, once traced rather than guessed at: `ui_strings` is data in
the `vf-licence-poc` D1 database, not code `wrangler deploy` touches.

**Correction, made after the operator pointed it out directly —
recorded plainly rather than quietly fixed.** This session first ran
`migrations/apply_migrations.py --replay-only` with no further flags,
watched it replay `vf-app-poc`'s own 70-migration chain, and wrongly
concluded from that single, default-argument run that the script "is
wired to a different chain entirely" and that no process for applying
a `vf-licence` migration was documented anywhere. Both were wrong, and
both were readable in the repo the whole time: the script's own
`--migrations-dir` flag exists specifically for this (its own help
text gives `--migrations-dir workers/vf-licence/migrations --database
vf-licence-poc` as the example), and `docs/change-and-promotion-
model.md`'s own "what changed → what deploys" table already lists
`workers/vf-licence/migrations/*.sql` against exactly that same
invocation. Re-run pointed at the right chain
(`--replay-only --migrations-dir workers/vf-licence/migrations
--database vf-licence-poc`), the full 123-migration `vf-licence` chain
replays cleanly with every assertion held, migrations `0122` and
`0123` included. The command the operator needs, for the mode this
session cannot run itself (no Cloudflare credentials):

```
python3 migrations/apply_migrations.py --remote \
  --migrations-dir workers/vf-licence/migrations \
  --database vf-licence-poc
```

How migration `0121`'s own strings ("Bring to front", "Show here
instead") reached the live deployment earlier is now explained by this
same command, not a mystery — the operator most likely already runs
it, or something equivalent, and this session simply hadn't found it
yet when it first asked.

**Built this arc, closing out most of what was named here before:
teams, most of the "user variable" fields, creating and managing an
org, and the org list's own tree ordering.** Reported live in one
request — "a UI for creating Users, allocating user variables,
allocating roles to user, and assigning users to teams. creating and
maintaining teams" — deliberately scoped down to one piece at a time
rather than built all at once (0328 onward), and each piece landed in
turn: teams (0332), the Access screen's own tabs (0333), user
properties (0334), org create/edit (0335), org tree ordering (0336).

**What is still genuinely new schema, not yet built**: a picture (no
image storage exists for anything user-related — the real lift here,
deliberately not started), a forename/surname split (today one `name`
field, and splitting it touches every place a name is already
displayed), and a business title. Cost-centre allocation *for a
person* is built (0334) — the field this note used to name as
missing.

**Rules and Sources as further Access tabs** were discussed and
deliberately scoped out of 0333 — Org Units, Roles, People, and Teams
are the four tabs today; a fifth and sixth would each need their own
scoping decision, not an assumption that they belong alongside the
other four.

**Teams have no org-scoping in the task-queue sense.** `org_teams.unit_id`
(0332) scopes who may *administer* a team's own definition and
membership; task assignment still names a team by id directly, with
nothing narrowing which teams a given screen offers based on the org
a task or document belongs to.

**1. Cost object approval** (decisions 0184, 0195) — **the frame is
built; nothing calls it.**

A **ledger** exists (Oracle's word; SAP's *controlling area*), legal
entities account in one, and a cost centre hangs beneath it with a
parent, an owner and a limit. `resolveApprovalChain` walks it in
decision 0184's **Limit** mode and is called by nothing.

**The next piece** is wiring it to `assign_task`, which still names one
team or one person.

*The original design note:* Cost object approval (decision 0184) — **designed, not built.**
An invoice line finds its approvers from its cost centre, and how many
it needs depends on a hierarchy: *"1, 2 or none or 6."*

**It has a name and two established shapes**, taken from SAP Concur and
Oracle Fusion rather than invented. **Level** walks every rung to the
top; **Limit** stops at the first person whose signing authority covers
the amount; and a step is one or the other, **never both**.

**Parallel across cost centres, serial within one** — which is what
*"serial line-level approval"* meant. Decision 0183's per-line tasks are
the parallel half and already work.

**The hierarchy is one of cost objects, not org units.** Escalation
climbs to a *parent cost object manager*, so a cost object carries a
default approver, a limit, and a parent of its own — which vindicates
decision 0031's separation for a reason it did not anticipate.

`org_authority_limits` is the signing authority, **written by a route
and read by nothing**, and `BT-133` is the line's cost centre. **The
join is missing**: a cost object has no approver, nothing walks a chain,
and completing a task advances nothing.

**The first question to answer** is whether the amount tested is the
line, the cost object's portion, or the invoice total — the sources
disagree, and it decides which approvals a split invoice needs.

**And the configuration screen that goes with it** (decision 0185).
Supervisory approval and cost object approval are **the same algorithm
over different trees**: start somewhere, walk up, stop when a signing
limit covers the amount. A third strategy is then a tree and a starting
fact rather than a rewrite — decision 0031's *"the vocabulary is closed,
and that is the feature"*, applied one level up.

`org_units` is already a tree and `org_users.unit_id` points into it, so
**the people hierarchy exists indirectly**. What no node of it has is a
manager.

**2. Unit-scoped configuration** (decisions 0192, 0196) — **rule sets
are scoped; nothing else is.**

**Update, this arc (0313–0331): roles now have a real UI, not only a
scoped assignment.** The Roles screen — read (0319–0323) and write,
including assignment (0326–0328) — is what closes that gap. **Teams
are scoped too now** (0332): every team belongs to exactly one org
(`unit_id NOT NULL`), with a real UI (0333) reached through the
Access screen's own Teams tab. **Still customer-wide, unchanged**:
settings.

A unit may override a stage's rule set, resolved by one walk in
`unit-config.ts`. A process was the wrong grain: France and Germany want
the same stages and different thresholds, so scoping the process would
duplicate seven stages to change one rule.

**Field visibility too** (decision 0197), per field so that restricting
one field in France cannot silently drop what the group said about every
other — decision 0143's trap, one layer along.

**Roles are scoped too** (decision 0199) — on the *assignment*, so one
*AP Manager* definition is held per org. **But applied in one place**:
fourteen permission checks exist and one is unit-aware, so a person
restricted to France cannot see German documents in the document
manager and can reach one by other routes. **That is not a boundary
yet**, and 0199 says so. **The count is stale as of this update**:
Suppliers (0358) and Purchase Orders (0375) have each since gained
real, permission-based scoping through the same `unitsWherePermitted`/
`scopedToChosenOrg` mechanism — more of the fourteen are unit-aware
now than when this was written, though nobody has re-counted the
full set since.

**And a stage may declare its permission** (decision 0200) — the
vocabulary was already right, since 0010 named permissions after
business activities and the activities are the stages. A rule asking for
something else is refused rather than quietly corrected. **No stage
declares one yet.**

**And delegated administration** (decision 0201): a role is granted in
an org by somebody who administers it, bounded above as well as below —
granting *everywhere* is refused, because it reaches further than the
granter holds.

**A regional manager needed no new mechanism**: a role is a list of
permissions and an assignment carries a unit, so *AP Manager (France)*
is the two together.

**And the org endpoints were ungated for ever**, not only at bootstrap
— decision 0010's reason holds while there is nobody, and stopped
holding the moment one person existed. Now authenticated once anybody
exists.

**And the task list is unit-aware** (decision 0202) — a German
validator is no longer shown French work, which was 0199's largest
recorded gap. **Claiming and completing are too** (decision 0203) — the last place the
boundary was a screen rather than a route. **Twelve of fourteen
permission checks still ignore the unit**, and those two are the ones
that matter most — the same stale count noted above; Suppliers and
Purchase Orders have each since joined the unit-aware side.

**Still customer-wide**: teams, settings.

**And the screen agrees with the route** (decision 0198) — which meant
loading the invoice before the fields, because its unit now decides
which are editable.

**An invoice can place itself** (decision 0204). A source chooses a
fixed org or `<Automatic>`, and `<Automatic>` reads the buyer's
identifiers off the document — decision 0036 added those columns in
September and nothing had ever read them.

**A match names a legal entity and an invoice needs an operating unit**,
so one department beneath it is unambiguous, several means *"the entity,
and no particular one"*, and none needs a department created. All three
are recorded in `org.unplaced`, **which no screen reads.** And
it is not a boundary — everybody sees every invoice.

*The original design note:* Unit-scoped configuration (decision 0192) — **designed, not
built**, and it touches almost everything.

**Two questions, not one.** *Must these units be hosted apart?* Then
they are separate **environments** — per-customer D1 and R2 exist for
isolation and residency (decision 0001). *May they share a database?*
Then this applies.

**The second is the case you have.** Residency splits are transatlantic;
a European group shares a database because it may, not as a compromise.

**And a contradiction worth knowing about**: `environments` has `UNIQUE
(customer_id, kind)`, so one production environment per customer — while
decision 0083 reasoned about *"a customer with EU and US instances"* and
built the sign-in screen an environment picker for it. **The interface
expects a shape the database forbids.** Harmless until a customer is
transatlantic, and recorded rather than lifted.

Four things carry a unit today: a person, an invoice, a source, and
which national rules apply. **Roles, teams, processes, rule sets and
field visibility are customer-wide**, so France and Germany share every
one.

The chosen shape is a nullable `unit_id` where null means *the group's
own* — so nothing migrates — and a resolver that walks up decision
0036's tree.

**The trap is the whole risk**: forgetting the unit does not fail, it
returns the group's answer. `resolveTenant` has a lint rule that makes
the equivalent mistake uncompilable; this has no equivalent, because the
column is nullable by design.

**Permissions have an answer now** (decision 0194): Oracle Fusion scopes
the **role** to a unit and lets a person hold several, so *AP Approver
(France)* and *AP Approver (Germany)* are two rows and a group treasurer
holds both. `org_user_roles` is already `(user_id, role_id)`, so this is
a column on `org_roles` and **no change to `hasPermission`**.

**And decision 0036 landed on Oracle's own model without knowing it** —
Legal Entity and Business Unit, with Oracle's older name for the second
being literally *Operating Unit*. Decision 0194 records what Oracle has
that this does not: a **ledger**, a **division** that can span legal
entities, a **department** separate from a business unit, and a shared
service centre serving several entities, which decision 0036's
invariant forbids.

**3. Measured pagination and annotation** (decision 0206) — **one piece
of work, by the operator's own choice.**

Both need to know where things are inside a rendered document, and both
need **same-origin delivery**: the document URL is minted on `vf-app`'s
origin and the viewer runs on `app.vibefinance-ai.com`, so the iframe is
cross-origin and the parent can read nothing.

**A same-origin iframe, not a shadow root** — that correction is in 0206
and the reason matters: shadow DOM isolates CSS and **not JavaScript**,
and this document is built as a string with an `esc()` on every
supplier-controlled value.

**And annotation here beats annotation on a photograph**, because a
field can carry its Business Term — an annotation anchored to `BT-48`
survives re-rendering, zoom and translation, where a coordinate on an
image does not.

**4. Coding — where a line is charged.** **The largest gap, and the one
the operator's own correction pointed at** (decisions 0225, 0226).

An invoice bills a company; **which department bears the cost is
per-line**, and routinely split — *"a purchase for stationery is booked
across multiple departments, cost centers and GL codes."*

`invoice_lines.cost_centre` has existed since decision 0007 and
`BT-133` since decision 0031. **Nothing assigns one.** A PO would carry
it, and without a PO the Coding stage does — and that stage does not
exist.

**5. A rule that reads the supplier fields.** All of them are now facts
a rule can test — hold (decision 0230), terms, match option and
tolerances (decision 0238) — and **no rule reads any of them.**

**That is deliberate.** The sentences are a customer's: *"if the
supplier is on hold, route this for review"*, *"if the match option is
three-way, visit Matching"*. **What is missing is a customer writing
one**, and the match option in particular still decides nothing — the
stages an invoice visits come from a process definition.

**6. Process configuration, versioned — built** (0349). Real version
control landed as described: `process_stage_versions (process_id,
version, stage_id, sequence)`, leaving all six foreign keys untouched
and making removing a stage "not in this version" rather than a
deletion that orphans history. An invoice finishes on the version it
started; rules still resolve on arrival. A draft is not new schema —
it is the rows already sitting at `processes.version + 1`.

**7. Email sending**, which decision 0125 evaluates. "Email" means three
different things — supplier contacts *out to strangers*, user
notifications *out to colleagues*, and a source which is *inbound* and
not sending at all.

Its order: **the sending mechanism** with the administrator's password
link (which blocks onboarding entirely), then **users**, then
**suppliers**. Sources are as far as they can go without item 1.

Two questions answered: a source's address lives on a **VibeFinance
domain**, and a user's role is a **job title**, so the column is named
`job_title` — a column called `role` beside a roles table is an
invitation to two answers about what somebody may do.

Still open: **which provider**, **where sending lives** (0091 says the
control plane never holds customer content), **whether templates sit in
D1** like `ui_strings`, and **what happens when sending fails**.

**8. BG-4 and BG-7 in the vocabulary.** The seller and buyer field lists
live in the viewer (0115). Recording business-group membership in
`shared`, as `INVOICE_LINE_FIELDS` does for BG-25, is the consistent
thing and a known shortcut until it is done.

**9. BG-23, the VAT breakdown.** Mandatory and **repeating** — one entry
per VAT category and rate, whose tax amounts must sum to BT-110. The
flat facts model cannot hold a repeating group (0112). A design
question, not an omission, and *"one of the most common causes of
validation errors"*.

**10. Despatch Advice (T16) — the two-way matcher is now built, and
this is what's left.** `po.matched`/`po.variance_pct`, and now real
line-level matching too (`po.line_matched` and the two line variance
fields), are computed live rather than declared and left uncomputed
(0370) — the gap this item used to name as blocking the matcher
itself is closed. What remains is exactly the goods receipt, the
missing third leg of three-way matching. BT-132 now exists, which is
what lets matching compare a line to an order line.

**11. Acting on `cbc:CustomizationID` beyond rendering.** Decision 0205
reads it to decide whether a document is Peppol BIS 3.0 and refuses the
rendering otherwise — which is the first thing to use it. **Nothing
routes or validates on it**, so a document from another profile is
processed as though it were this one. **Purchase orders now have their
own, separate ingestion path** (`POST /purchase-orders`, decision 0370)
rather than being detected automatically within `/sources/:id/capture`
itself — a real Order is matched against, but the underlying gap this
item names is still there: the capture pipeline itself still cannot
tell a Peppol Order from an Invoice by its own `cbc:CustomizationID`.

*The original note:* Reading `cbc:CustomizationID`. BT-24 is now read into the facts
(0112), so the discriminator is available; detection still does not use
it, and a valid Peppol Order sent to `/sources/:id/capture` is refused.

**12. `party.first_document`**, the **all-users task view**, a **screen
for placing an invoice** by hand, and **four more languages** —
`GET /ui-strings/keys` shows the gaps.

---

### Two habits this week earned

**A failed remote apply is not a no-op** (decision 0235). `wrangler`'s
file import does not roll back across a whole migration, so a failure
halfway leaves the database part-changed — **check the schema, not the
bookkeeping table**, before retrying.

**And replay runs against empty data.** A migration that cannot survive
a database with rows in it will pass every check here. The honest fix is
a fixture and it is not built.

### The citation check runs with the tests

**Nineteen comments cited two records nobody had written** — decisions
0188 and 0224, found by comparing citations against `docs/decisions/`
and not by anyone reading the code.

`npm test` now runs `scripts/check-citations.py` first. It names the
record and where it is cited, and **it was watched to fail** by deleting
decision 0224 and seeing it report eight references.

**The convention is that a citation can be followed.** Twice it could
not, and neither was noticed while writing three of the records in
between.

## Habits worth keeping

`docs/PROGRESS.md` has the longer list.

### The shape this project keeps finding

**A real mechanism, aimed at something that used to be true.** Not a
missing check — a working one, pointed slightly wrong.

| | The mechanism | What it was aimed at |
| --- | --- | --- |
| 0084 | A migration test | Existing rows, not new ones |
| 0093 | A standing invariant | Detection, where prevention was claimed |
| 0097 | `isAdminRoute` | Routes it never reached |
| 0100 | A lint rule | Output nobody read |
| 0103 | A counts test | A page that happened to hold the task |
| 0105 | A session test | The helper, not the routes calling it |
| 0109 | A keying screen | A line's columns, not its facts |
| 0110 | A vocabulary | Two of six mandatory line terms |
| 0112 | A vocabulary, again | Two of eight mandatory header terms |
| 0119 | A validation route | A block assembled by hand, which the validator had outgrown |
| 0120 | A keying form | A summary of five fields, once the form offered more |
| 0124 | A font stack | A face nobody's machine had installed |
| 0126 | A configuration screen | Listing sources, while the create route sat unreachable |
| 0131 | A proxy allow-list | Every path beneath `/sources/:id` but not the path itself |
| 0132 | A translation system | Every label, and none of the sentences the API sent |
| 0143 | A stage restriction | Three fields somebody listed, not the ones added later |
| 0144 | Field visibility | The screen, never the route — since September |
| 0152 | A visit timeline | Stages minutes apart, never a straight-through second |
| 0157 | An authoring flow | Somebody doing it in one sitting, never leaving halfway |
| 0158 | A read-back | A combinator, never a rule that is one condition |
| 0165 | A viewer | One caller, so its requirements read as facts |
| 0167 | A viewer | A task, never a document nobody is working on |
| 0170 | Extraction | A model that reads badly, never one confident about it |
| 0174 | A line save | Every field the screen holds being a field it sends |
| 0212, 0324–0328 | A proxy allow-list | Six routes, real and tested in `vf-app`, never once added to `vf-ui`'s own list of what it will forward |
| 0337, 0338, 0339, 0346, 0347 | A test file's own strings stub | The new keys a change actually introduced, not the ones the file already had — hit five separate times across one arc, each time cascading into several unrelated-looking failures traced back to the same missing key |
| 0341 | A `flex: 1` CSS rule | The row shape it was written for (0332's team-member picker), not the different shape a later decision (0334) put in the same class |

**And this table itself.** It was removed by a rewrite of the section
above it, and three later edits claimed to add rows to a table that was
no longer there — a scripted `replace` finds nothing and changes
nothing, silently. Rebuilt here.

---

**Check one layer against another.** Fifteen divergences found this way and
none any other way: a column with no vocabulary entry; a fact never
declared; settings reaching nothing twice over; a parser populating half
its fields; a constant contradicting its own contents; a storage layer
nothing called; a content type derived from half a detection result; a
migration checksum written and never compared — under a comment
asserting it *was* verified; and three derived fields nothing computes.
**Storage proves nothing about addressability; an admin route proves
nothing about effect; a passing unit test proves nothing about wiring.**

Decision 0067 makes one of these a standing check — and decision 0079
records what it does not cover.

**Watch every new check fail.** A test nobody has seen fail is a comment
that takes time to run. One fail-watch reordered detection in a way that
broke nothing meaningful and *proved the wrong thing*; only re-doing it
correctly showed the guarantee was real. And in decision 0078 a test was
written that asserted the **wrong** behaviour — which would have
defended the mistake against anyone who later tried to fix it.

**A survival test cannot catch a broken reference.** Rebuilding a
referenced table (0084) took three attempts. The second passed a check
that existing rows survived — and would have shipped a schema where
every NEW child row failed, because SQLite rewrites foreign keys to
follow a renamed parent and the rows being checked were copied before it
moved. **Insert after a migration, not just count.**

**Tests, `tsc` and the bundler read the module graph differently.**
A dependency installed at the repository root passed both test suites
and the typechecker, and failed the deploy outright (0089). Only one of
the three is the one that matters. `wrangler deploy --dry-run` is the
check.

**A standing invariant detects; it does not prevent.** Decision 0092
claimed one meant a cross-customer access grant could not be written. A
hand-written `INSERT` then wrote one against the live control plane —
suggested as a demonstration that the guard would refuse. Where a rule
spans tables and matters, **carry the discriminator and use composite
foreign keys** (0093): prevention that is visible in the schema and
survives a rebuild.

**A fail-watch that does not fail is information.** A case-sensitivity
test in 0090 passed with the protection removed, because it recorded
with mixed case and read with lowercase while the write path lowercased
anyway. The bypass ran the other way. Twice this session a test needed
correcting rather than the code.

**Ask what a query actually answers.** Decision 0080's rule survey
filtered on `approved_by IS NOT NULL`, returned seven rules, and read
past a count in the same output saying eight. No harm that time; had the
eighth been a different rule it would have been left firing at the wrong
stage.

---

## Reading order

**For a person:** Documents 1 to 4 in `docs/documents/` and as Word
editions, then `docs/PROGRESS.md`. The decision records are reference,
not reading.

**For a new AI session:** `docs/PROGRESS.md`, this file, then name the
task and the relevant decision numbers. The records are written to be
read cold — each states what was decided, what was rejected, and why.

**One-off configuration** lives in `docs/operations/` — SQL run once
against a named database, reviewed like code but not part of the
migration chain.

**Document shapes come from Peppol BIS 3.x** (decision 0082), not from
what an ERP exports and not from a shape invented here. One caveat that
is easy to get wrong: **only the invoice has Business Terms.** BIS
Billing is a CIUS of EN 16931; the other eleven transactions use UBL
element names, so "use Peppol throughout" must not be read as "use BT
codes throughout".
