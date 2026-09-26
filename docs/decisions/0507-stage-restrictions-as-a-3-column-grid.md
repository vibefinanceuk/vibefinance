# 0507 — Stage Restrictions as a 3-column grid

**Status: built and verified locally, not yet committed/pushed at the
time of writing.**

## What was asked

Reported live, against the real AP Setup → Stage Restrictions screen:

> Can you look at the AP Setup -> Stage Restrictions screen and
> consider how we make better use of space with the configuration
> cards on display here. I think they could potentially be 1/3 screen
> width. With the Standard AP process selected, there are 7 stage
> which gets very deep in the browser page.

Taken first as a `/design` request: a mock-up (a new "Stage
Restrictions layout" canvas Artifact, three artboards — proposed,
today's layout, and a close-up of one card) built against the real
product's own colours, typography and copy, with no code touched. The
operator confirmed *"I like what you have designed - let's build"* —
this decision is that build.

## What was found

`stageRestrictionsTab()` (`ap-setup.js`) rendered one `.panel` per
stage as a flat, unstyled vertical stack — no grid, no columns, just
`el("div", {}, [intro, processPicker, ...stagePanels, problem])`. With
Standard AP's real 7 stages (decision 0080; migration 0081 —
Intake, Validation, Matching, Coding, Approval, AP Review, Payment
Eligible), every one of them got the same full-width card regardless
of how much it actually had to show:

- **Five stages offer Account Coding restrictions** (migration 0081:
  `offerFieldRestrictions !== false` — Validation, Matching, Coding,
  Approval, AP Review) and had the most content: three field
  checkboxes, three toggles, and a return-targets section with an
  inline two-select-plus-button add form, always open whether or not
  anybody was about to use it.
- **Two are transitionary** (Intake, Payment Eligible —
  `offerFieldRestrictions: false`) and had almost nothing: one muted
  sentence, the same three toggles, and the same return-targets
  section — yet got exactly the same full-width card as the five
  above.

Nothing here needed a wider card. A field checkbox is a short label; a
toggle is a short label; the add-target form is two selects and a
button. The card was full width because nothing had ever given it any
other shape, not because its content needed the room.

## What was decided

1. **A stage that offers Account Coding restrictions becomes a
   3-column grid item.** `.stagegrid` — `display: grid;
   grid-template-columns: repeat(3, minmax(0, 1fr))` — narrowing to 2
   columns under 1400px and 1 under 900px, the same responsive
   convention `.editgrid` already sets at 520px for its own layout.
2. **A transitionary stage stays full width, condensed to one row.**
   Grouping the five offered stages into three narrow columns while a
   transitionary stage sits among them would leave two of its three
   columns empty for one line of text — worse than the stack it
   replaces. Instead its explanation and its three toggles
   (`offerToggleRow`/`reverifyToggleRow`/`discardToggleRow` — decisions
   0485/0487/0502, all already independent of `offered`) share one
   flexible row (`.stageslimrow`/`.stageslimtoggles`) instead of four
   stacked lines.
3. **Grouped by scanning stage order, not split into two fixed
   lists.** `stageRestrictionsDetail.stages` is already sequence
   order; the render pass walks it once, opening a new `.stagegrid`
   the moment it meets an offered stage and closing it the moment it
   meets one that isn't. In the real process that means one grid of
   five (Validation through AP Review) bookended by Intake and Payment
   Eligible, each on its own row — but the logic itself doesn't assume
   that shape, so a transitionary stage anywhere else in a
   differently-configured process still breaks the grid in the right
   place rather than being folded into a column it doesn't fit.
4. **A stage's editable-field checkboxes wrap as chips, not one
   full-width row each.** `.stagefields` — `display: flex; flex-wrap:
   wrap` — around the same three `.assignmentrow`s decision 0483
   already built (`stagerestrict-` ids, `Project`/`Commodity
   code`/`General ledger code`), unchanged in every way except the
   container that used to stack them. The one field that can be hidden
   everywhere (`hiddeneverywhere`, its own explanatory line beneath the
   label) keeps the chip row's full width — `.fieldhidden { flex-basis:
   100% }` — since it carries a hint the others don't.
5. **Add return target (decision 0490) moves from an always-open
   inline form to a picker.** The two-select-plus-button `.editgrid`
   sat open in every card whether or not there was anything to add,
   which a 1/3-width column has much less room to spare for. Replaced
   with the same minimal `.backdrop`/`.popout` shape `viewer.js`
   already uses for Discard and Return (`openDiscardPicker`) —
   `openReturnTargetPicker(stage, otherStages, teams, problem)` — shown
   behind the same `+ Add` link this screen already had, only when
   there is something to choose (`hasAddOptions`, unchanged). Behaviour
   inside it is identical to the form it replaces: `addStageReturnTarget`,
   reload the stage list on success, a real server error shown inline
   (now in the picker) on failure, left open to retry.

No server-side change. `offerFieldRestrictions`, the field-visibility
route, and every return-target route are exactly as decisions
0483/0485/0490 left them — this is a layout and interaction pass over
data the screen already had.

## What was built

- **`workers/vf-ui/public/ap-setup.js`**:
  - New `openReturnTargetPicker(stage, otherStages, teams, problem)`,
    the `.backdrop`/`.popout` picker described above, added just
    before `stageRestrictionsTab()`.
  - `stageRestrictionsTab()`: the return-target add form is now the
    single `+ Add` link that opens the picker; a stage's field
    checkboxes render into `.stagefields` instead of `.assignmentlist`;
    a non-offered stage's body is `.stageslimrow`/`.stageslimtoggles`
    instead of four stacked elements; the stage card itself carries
    `panel stageslim` when `!offered`; and the final render groups
    `stagePanels` into `.stagegrid` sections by walking
    `stageRestrictionsDetail.stages` in order.
- **`workers/vf-ui/public/app.css`**: `.stagegrid` (+ its two
  responsive breakpoints and `.stagegrid > .panel { margin-bottom: 0
  }`, the same rule `.parties > .panel` already gives its own grid),
  `.panel.stageslim`, `.stageslimrow`, `.stageslimtoggles` (+ its own
  `.assignmentrow` override), `.stagefields` (+ its own `.assignmentrow`
  override and `.fieldhidden`).
- **`workers/vf-ui/test-browser/ap-setup.test.ts`**:
  - The three existing "Return targets" tests that drove the inline
    form directly now open the picker first (`document.querySelector
    (".popout ...")`, `.backdrop` presence/absence) — the same
    convention `viewer.test.ts`'s own Discard picker tests already use.
  - New describe, "The 3-column grid — decision 0507": a mixed-stage
    fixture (Intake, Validation, Matching, Payment Eligible) proving
    consecutive offered stages share one `.stagegrid` element and a
    transitionary stage sits outside any grid; a chip-row test; a
    slim-toggle-row test.
  - New describe, "The Stage Restrictions grid's own CSS — decision
    0507": the same stylesheet-text pattern `viewer.test.ts`'s own
    decision 0479/0504/0506 tests use (jsdom applies no real CSS),
    confirming the grid, chip and slim-toggle rules exist.

## What was not built

No change to which stages offer restrictions, what a field checkbox
does, what a toggle does, or what adding/removing a return target
sends to the server — decisions 0483/0485/0487/0490/0502 all stand
exactly as they were. No design system was available for the `/design`
mock-up this build follows; the mock-up (and this build) match the
product's own existing colours, typography and copy rather than
inventing a new look.

## Verification

- `workers/vf-ui`: `ap-setup.test.ts` (browser) — **75/75**, including
  6 new tests for this decision. Full browser suite **1191/1192** — the
  one failure is the same pre-existing, unrelated `typography.test.ts`
  hardcoded-`10px` gap, reconfirmed via `git stash` comparison to
  predate this change. Plain suite **75/75**, unchanged. `npx eslint`
  clean on `ap-setup.js` and the touched test file (one pre-existing,
  unrelated unused-var error in `ap-setup.test.ts`, also reconfirmed
  via `git stash` to predate this change).
