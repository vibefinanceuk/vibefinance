# 0447 — Template/Load Button Strings, and Org / Company Code Naming Alignment

**Status: built, tested, confirmed pushed and deployed** — `origin/main`
fetched directly reads `78357d6`, matching this session's own commit
exactly, and the operator confirmed with *"deployed and pushed."*
Delivered as a git bundle for the operator's own pull/push/deploy
sequence, the same path decisions 0391, 0415–0446 already used.
**Migration `0150` (and the still-outstanding `0149` from decision
0446) both still need their own separate `apply_migrations.py
--remote` run — see "Still to do, operator side" below.**

---

## What was asked

Two small cosmetic changes, reported together:

1. *"Please can you update the icons in the AP Setup for Template, and
   Load, to be the same as the purchase order screen icons that read
   'CSV Template' and 'Load CSV'. This occurs in the Cost Center,
   Project, Commodity Code and General Ledger Tabs."*
2. *"Please can the Access and AP Setup screens to align on the naming
   of Org Units and Company Code. Perhaps Org / Company Code is a good
   compromise?"*

## What was found, not assumed

**Part 1 — the icon graphics already matched.** `coding-lists.js`'s own
`csvLoaderPanel()` and `purchase-orders.js`'s own loader both call
`actionLink("load", ...)` / `actionLink("download", ...)` — same icon
names, same shared `icon()` lookup, same `.actionlink`/`.actionlink
primary` CSS. There was no icon to change. What actually differs is the
**label text**: AP Setup shows generic "Load"/"Template"
(`apsetup.csvloadbutton`/`apsetup.csvtemplatebutton`, migration 0148,
decision 0445); Purchase Orders shows "Load CSV"/"CSV Template"
(`purchaseorders.loadbutton`/`purchaseorders.templatebutton`, migration
0113, decision 0374). Confirmed both keys were already in
`string-coverage.test.ts`'s own `KEYS_THE_INTERFACE_USES` before
touching anything.

**Part 2 — Org units and Company code are the same underlying data,
just named differently on the two screens.** `apsetup.
codingcompanycodesub` already says as much: *"Managed under Access →
Org Units. Shown here for reference only."* Access's own "Org units"
tab (`roles.units`, migration 0093) and AP Setup's own read-only
"Company code" sub-tab (`apsetup.codingtab.companycode`, migration
0147) are each single-point-of-truth string keys — every place either
one is displayed (tab label, section heading, form label, table/column
header) reads it by key, so the two screens showing two different
labels for the same list was the actual bug being reported, not a
cosmetic mismatch to paper over independently on each screen.

## The fix

**Part 1 — reuse, not reword.** `coding-lists.js`'s `csvLoaderPanel()`
now calls `label: t("purchaseorders.loadbutton")` and `label:
t("purchaseorders.templatebutton")` directly, rather than keeping a
second, apsetup-specific pair of keys with the same or near-same
wording — the same string-reuse discipline decision 0446 already
applied to the pagination row (`purchaseorders.rows`/`.firstpage`/
etc.) and decision 0445 applied to `.poformat` → `.csvformat`. The
`apsetup.csvloadbutton`/`apsetup.csvtemplatebutton` rows in migration
`0148` are now orphaned — left as-is, migrations are append-only and
never edited — and removed from `string-coverage.test.ts`'s own
`KEYS_THE_INTERFACE_USES`, since the interface no longer reads them.

**Part 2 — a value-only rename, no code change.** Because both keys are
already referenced everywhere by key, aligning the two screens needed
no production-code change at all — only a new migration, `0150`,
UPDATE-ing both keys' `en`/`de` values to the operator's own suggested
compromise, "Org / Company Code" (German: "Org / Buchungskreis",
keeping the existing, correct German business term for company code
and abbreviating "Organisationseinheit" to "Org" the same way the
English does), following the exact precedent migration `0084`
established for a pure wording change (`UPDATE ui_strings SET value =
... WHERE key = ... AND locale = ...`, never touching the original
migration that first created the row). AP Setup's own
`apsetup.codingcompanycodesub` cross-reference text — *"Managed under
Access → Org Units..."* — is updated in the same migration to point at
the renamed Access tab by its new name, so it doesn't go stale the
moment the rename ships.

## Tests

`workers/vf-ui/test-browser/coding-lists.test.ts` — STRINGS fixture's
`apsetup.csvloadbutton`/`apsetup.csvtemplatebutton` rows replaced with
`purchaseorders.loadbutton: "Load CSV"`/`purchaseorders.templatebutton:
"CSV Template"` (added beside that file's own pre-existing
`purchaseorders.*` pagination-string block, decision 0446); every
assertion checking the button's own literal text (`toContain`,
`.textContent ===`) updated from `"Load"`/`"Template"` to `"Load
CSV"`/`"CSV Template"`. Separately, `apsetup.codingtab.companycode`'s
STRINGS value and every literal `"Company code"` assertion (the
describe title, `switchCodingSubTab()` calls, table-header checks)
updated to `"Org / Company Code"` — outside this file's own header
docblock, whose quoted original decision-0444 request text
(*"...This would include Company code (Org), Cost-Center..."*) is left
exactly as reported, not rewritten to agree with the rename.

`workers/vf-ui/test-browser/ap-setup.test.ts` — the same
`apsetup.codingtab.companycode` STRINGS value and its own two literal
"Company code" references (test title, `toContain`) updated.

`workers/vf-ui/test-browser/access.test.ts` — `roles.units`'s STRINGS
value and every literal `"Org units"` reference (STRINGS, all
`switchTab()` calls, two test titles, two `toContain`/
`not.toContain()` assertions, one descriptive comment) updated to `"Org
/ Company Code"`.

`workers/vf-licence/test/string-coverage.test.ts` —
`apsetup.csvloadbutton`/`apsetup.csvtemplatebutton` removed from
`KEYS_THE_INTERFACE_USES` with a comment explaining why (reused,
not renamed); `purchaseorders.loadbutton`/`.templatebutton` were
already listed (decision 0374/0113), needing no addition.

`workers/vf-licence/migrations/0150_org_company_code_naming_alignment.sql`
(new) — three UPDATE pairs (`roles.units`, `apsetup.
codingtab.companycode`, `apsetup.codingcompanycodesub`) × 2 locales (6
rows touched). Wired into `test/setup.ts`, following the same
import-and-exec pattern as every prior migration there. No new keys, so
no `string-coverage.test.ts` addition needed for this migration itself.

`eslint .` clean across every file this decision touched.

`npx tsc --noEmit` in `vf-app`/`vf-licence`/`vf-ui` — no new errors from
any file this decision touched. The `cloudflare:test` module-resolution
errors and the unrelated `vf-app/test/workload.test.ts` narrowing
errors a standalone `tsc --noEmit` surfaces are pre-existing across the
whole repo (every test file in every workspace shows the former), not
introduced here.

Full, unfiltered suites: `vf-app` **2618/2618** (113 files, unchanged —
no `vf-app` file touched this decision, confirmed as a clean baseline
run). `vf-licence` **320/320** (21 files, unchanged in count — this
decision's own migration adds rows, not new tests). `vf-ui`: **74/74**
Worker (2 files, unchanged); browser **1011/1011** (48 files,
unchanged in count — this decision reworded existing assertions rather
than adding new ones), all green — the previously-documented
`document-window.test.ts`/`documents.test.ts` unhandled-rejection flake
(160 non-fatal logged errors) is still present and still confirmed, via
`git stash` against the unmodified baseline, to be identical there —
untouched by this decision.

## What was not built

- **No new string keys anywhere.** Both parts of this decision are pure
  reuse (part 1) or pure re-wording of already-shipped keys (part 2) —
  matching this project's own established discipline against
  duplicating a generic or already-correct string under a new name.
- **`roles.nounits`** ("No org units configured yet.") was deliberately
  left as-is — an empty-state sentence using "org units" as an ordinary
  noun, not the tab's own proper name, so it wasn't part of what the
  operator asked to align.

## Still to do, operator side

Confirmed pushed and deployed. Migration `0150` needs its own separate
apply — and so, still, does migration `0149` from decision 0446, which
per `docs/HANDOVER.md` has not yet been applied live:

```
apply_migrations.py --remote --database vf-licence-poc --migrations-dir workers/vf-licence/migrations
```

Until both are applied, expect: the AP Setup Template/Load buttons to
keep reading "Template"/"Load" rather than "CSV Template"/"Load CSV"
(migration `0150`); the Account Coding search box's placeholder/
no-matches text to keep showing as raw string keys (migration `0149`,
still outstanding from decision 0446); and the Access "Org units" tab
and AP Setup "Company code" sub-tab to keep their old, misaligned names
(migration `0150`) — code deploy and migration apply remain two
separate steps in this project, and skipping the second produces
stale or raw-key text, not an error.
