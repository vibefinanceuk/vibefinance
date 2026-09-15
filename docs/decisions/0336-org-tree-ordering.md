# 0336 — A Tree, Not a Flat Sort

**Status: built.** "Please can you order the list of orgs, each below
their parent in alphabetical order." Checked directly before writing
anything: `ORDER BY kind DESC, name ASC` never grouped a child beneath
its own parent at all — every operating unit sorted before every
legal entity, regardless of any real parent-child relationship, while
the screen's own indentation (`unitDepth`, in `access.js`, walking the
`parentUnitId` chain to compute how far to indent a row) had always
implied a tree the row order never actually matched. A customer with
one legal entity and several operating units beneath it would have
seen every operating unit first, then the legal entity last, each one
indented as if it were nested under something several rows away.

---

## The fix

`sortUnitsAsTree`, a new, exported, pure function in `org-route.ts`:
alphabetical among siblings at every level, each unit immediately
followed by its own children, depth-first — the exact shape
`unitDepth`'s own indentation has always assumed, finally made true
of the row order too.

A unit whose own `parentUnitId` names something that does not exist,
or that sits inside a real cycle, is appended at the end rather than
silently dropped. Cycles should never exist in practice — decision
0335's own self-parent check on both create and update already
prevents the immediate case — but a defensive sort does not get to
assume the data it is handed is always well-formed, the same
discipline this project applies everywhere else a list is built from
real, possibly-imperfect rows.

Wired into both places that return a unit list: `handleListUnits`
(used today for a document's own unit picker) and
`handleGetOrgOverview` (what the Access screen's own Org Units tab
actually renders) — the same fix in both, rather than only where it
was first noticed, since the underlying bug was identical in each.

## What has coverage

`sortUnitsAsTree` itself: alphabetical ordering with no hierarchy at
all, a child placed immediately beneath its own parent (the exact
case reported live), recursion to grandchildren depth-first, an
orphaned `parentUnitId` appended rather than dropped, and a real cycle
appended rather than dropped or looped forever. Both call sites also
get a real, integration-level test confirming the actual route returns
tree-ordered units, not only the pure function in isolation. Two of
the four claims — the depth-first ordering itself, and the orphan/
cycle safety net — were each probed directly: replacing the real logic
with a flat alphabetical sort, and removing the leftover-handling
entirely, each failed exactly the tests built to catch them.

`vf-app`: 1636 tests (was 1629). `vf-ui`: unchanged (63 Worker, 493
browser) — the frontend already rendered `units` in whatever order
the backend returned; nothing on that side needed to change for the
fix to take effect.
