# 0355 — A Missing Filter Is Not "Show Everything"

**Status: built.** Reported live: "When I highlight the AP Line
Review Process, which has no stages - I see many rules. However, I'm
not sure how this is possible, as I thought a rule had to be
associated with a stage."

---

## What was actually happening

The operator's own instinct — a rule belongs to a stage — was
correct. The bug was one layer beneath it. `handleListRules`'s own
query read `${stageId ? "WHERE s.id = ?" : ""}`: with no `stageId`
given at all, there was no `WHERE` clause whatsoever — every rule in
the entire database, across every process and every stage, returned
as if it were the answer to "what runs here."

**A real regression this session's own earlier work exposed, not
introduced.** Before decision 0351 gave the Rules screen a process
selector, the stage list it read from was already global and
unscoped, and this system has always had at least one process with
real stages — so `chosen` (the selected stage) was always set to
something real, and the dangerous, unfiltered branch of
`handleListRules` was never actually reached in practice. Once
decision 0351 correctly scoped the stage list to one process at a
time, a genuinely stage-less process — AP Line Review — could be
selected for the first time, `chosen` stayed `null`, and the rules
screen's own request to the backend arrived with no `stage` parameter
at all, walking straight into a fallback nobody had ever been able to
reach before.

**Confirmed directly, not assumed, that no real caller depended on
this.** Every existing test passing `null` for the stage argument was
using it as a convenience — the rule under test was always seeded at
a specific, known stage (`validation`), and `null` only worked by
coincidence of the very fallback this decision removes. Updated all
ten to name that stage explicitly, which is what they were actually
testing regardless.

## The fix

`handleListRules` now returns `{ rules: [] }` immediately when no
`stageId` is given, before ever touching the rule tables — the same
"absent means nothing, never everything" discipline this codebase
already applies elsewhere. Still a real `200`, not an error: an empty
process asked about honestly has no rules, which is a valid answer,
not a failure. The Rules screen itself needed no change at all — it
already renders "No rules run here yet" correctly whenever the list
it receives is empty; the only thing wrong was what it had been
receiving.

## What has coverage

Backend: the exact fallback, both for a `null` stage and an empty
string, confirmed to return nothing — probed directly by reverting to
the old, unfiltered query shape and confirming the test fails exactly
the way the reported bug would have looked. A second test confirms
the response is still a genuine `200`, not turned into an error.
Frontend: an end-to-end test opens the screen with a process
carrying zero stages and confirms the rules table is genuinely
empty, rather than trusting the backend fix in isolation to imply the
whole path behaves.

`vf-app`: 1706 (was 1704). `vf-ui`: 69 Worker (unchanged), 535
browser (was 534).
