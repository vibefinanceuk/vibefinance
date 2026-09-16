# 0353 — A Real Entry Point Into Modifying an Existing Process

**Status: built.** Reported live: "Can you outline the process if I
want to create a v2 of an existing process. It seems that I cannot
modify an existing process?"

---

## What was actually true, and what was missing

Mechanically, a v2 was always reachable — `handleAddDraftStage` and
`handleRemoveDraftStage` both already call `ensureDraftExists`, so
adding or removing a stage on an existing, already-published process
has always started a draft, copying the live version's own membership
forward. Walked through directly: select the process, click "Add
stage," and the draft that appears already contains every stage that
was already live, ready to reorder or remove alongside the new one.

**What genuinely had no way in**: someone whose only goal was to
reorder or remove something — not add anything new at all. The live
version's own display has always been entirely read-only, with no
remove or reorder controls on it. The only door into a draft was
labelled "Add stage," which reads like it does one specific thing,
not "begin editing this process." Confirmed directly in the code
before building anything: this was a real, named gap, not user error.

## What was built

`handleStartDraft` — the same `ensureDraftExists` call the other two
routes already made, exposed on its own for the first time, with no
stage attached to it at all. Idempotent the same way: calling it on a
process that already has a draft returns that draft unchanged, never
resets it. Wired as a new `POST` on the same bare `/processes/:id/
draft` path `DELETE` already uses to discard a draft — starting one
and discarding one are the two ends of the same concept, and sharing
the path keeps that visible in the routing itself, the same choice
already made for `PUT` sharing `/draft/stages` with `POST` in decision
0352.

A new "Start draft" button sits beside "Add stage" wherever a process
has no active draft yet. Clicking it opens the Draft section with
nothing new in it — just the existing, live stages, now fully
reorderable and removable directly, the same way any stage added
afterward already is.

## What has coverage

Backend: the 404 case, the actual reported gap confirmed directly (an
existing, previously-live stage reordered through a draft that was
never entered via adding anything), and idempotence — calling it
twice, with something added to the draft in between, must not reset
that back to a fresh copy of the live version. The gutted-function
probe (stubbing the whole route to a no-op) correctly failed all four
of these tests at once, confirming they exercise real behavior rather
than passing on their own assumptions.

Frontend: the button appears only with `Admin.Configure`, is hidden
without it, and clicking it calls the real route — each probed
directly, including removing the button outright and confirming its
own test fails.

`vf-app`: 1704 (was 1697). `vf-ui`: 69 Worker (unchanged), 533
browser (was 530). `vf-licence`: 320 (unchanged in count; new
migration for the button's own string applied cleanly).

## Deliberately not decided here

Two real, related gaps this same conversation surfaced remain open,
by the operator's own choice not yet confirmed to build:

- **In-place rename** of a stage, evaluated as safe in decision 0352
  (name is display-only; nothing at runtime evaluates a stage by it).
- **A stage's own id colliding globally across processes** — the
  underlying cause of the "already exists" report that started this
  whole line of work. Auto-generating a stage's own id from its name,
  and per-process name uniqueness as a separate, additional check,
  were both proposed in decision 0352 and remain unbuilt.
