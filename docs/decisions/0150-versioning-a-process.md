# 0150 — Versioning a process

**Status: designed, not built.** How a process changes shape without
changing what has already happened to an invoice.

---

## What is being asked for

> I would like to be able to add and remove stages to and from a process
> via a configuration UI... when a process is changed, it could assert a
> new version number. The version number would then align to an item in
> the process, so it is always apparent what version of the process an
> item pertains to.

**Yes**, and one detail decides whether the version number means
anything.

---

## Version the membership, not the stages

A version on `processes` alone would be **a label with nothing behind
it.** If `process_stages` rows are edited in place, an instance recorded
as running under v1 looks them up and gets v2's — the number says
*"this invoice ran under v1"* while the system shows it something else.

So what is versioned is **which stages are in a process, in what
order**:

```
process_stage_versions (process_id, version, stage_id, sequence)
```

A stage exists once, with its own id and its own properties. Its
**membership** of a process at a given version is the versioned thing.

### Three things that come free

**Every existing foreign key keeps working.** Six tables reference
`process_stages(id)` — `tasks`, `stage_visits`, `process_instances`,
`field_visibility` and two more — and none of them changes.

**Removing a stage is not deleting one.** A stage simply is not in v2's
membership. Its history still resolves, its completed tasks still cite
something that exists, and v1 instances still visit it.

That answers a real question asked the same day: **Line Review** should
go, and it has a completed task against it. Deleting the row would
either fail on a foreign key or orphan real history — the same shape
decision 0130 found with sources, where a source that documents arrived
through is retired rather than deleted. **Versioning the membership
removes it without a `retired` flag**, because "not in this version" is
already the honest statement.

**And resequencing is a different `sequence` in v2**, rather than a
mutation somebody has to reason about after the fact.

---

## An invoice finishes on the version it started

The operator's answer, and the right one:

> In-process invoices should definitely finish on their current process.
> The invoice finished on v1, and the item has no knowledge of v2. Only
> new items on the process are established on the new version.

`process_instances` carries the version it was created under, and every
stage lookup for that instance reads that version's membership.

**Moving an in-flight invoice to a new version is incoherent**: it could
skip a stage it should have visited, or be sent back to one it already
passed. Neither has an honest answer, so neither is offered.

---

## Rules are not versioned with the process

**A rule change does not reissue the process.** Rules version themselves
(decision 0014), and conflating the two means every rule edit produces a
new process version that no invoice's path actually differs under.

### And rules resolve on arrival, not on entry

> New rule versions execute on new items entering the process stage
> only.

**This is already what happens**, and worth recording rather than
building: `rule-set-loader.ts` selects the highest approved version
whose effective window covers **now**. An invoice that entered last week
and reaches Approval tomorrow is evaluated against tomorrow's rules.

### The asymmetry is deliberate

It looks inconsistent — the path is frozen and the rules are not — and
it is the correct way round.

**The process version decides the path**: which stages an invoice
visits, in what order. Changing that mid-flight breaks the record of
where a document has been.

**The rules decide what happens when it arrives.** There the current
answer is the one anybody wants: a threshold tightened this morning
because somebody found something should apply to invoices reaching
Approval this afternoon — **including the ones already in flight, which
are precisely the ones to worry about.** Freezing rules at entry would
exempt them.

---

## What this makes visible, and nobody records

An invoice's history can show it passed Validation under one rule
version and Approval under another. **That is correct, and it will look
odd to the first person who traces one.**

`stage_visits` records which stage and when. It does not record **which
rule versions fired**, so *"why was this held"* is answerable only from
what the rules say today rather than what they said then.

That is not a reason to freeze rules. It is an argument for recording
what fired, and nothing does.

---

## What needs building

- **`process_stage_versions`**, and a `version` on `processes` and on
  `process_instances`.
- **Thirteen reads to route through it.** `FROM process_stages` appears
  thirteen times across five files — the workflow engine, task listing,
  field visibility, the rules screen and process configuration — and
  every one currently asks *"what are this process's stages"* where the
  honest question is *"what are this process's stages at this
  instance's version"*.
- **The configuration screen** the operator asked for: list a process,
  add and remove stages, set their order. Publishing produces a version.
- **Renaming a stage is not a version.** `name` is display and `id` is
  the key; changing *Received* to *Intake* alters no path and should
  reissue nothing.

---

## Deliberately not decided here

- **Whether a version can be edited before it is published.** A draft
  version somebody is assembling is a different thing from v2 being
  live, and the screen implies one.
- **What happens to a stage in no version at all.** Removed from v2 and
  never in v3, it exists for history and appears in no process — a state
  nothing describes today.
- **Whether two processes can share a stage.** Nothing prevents it now,
  and membership versioning makes it more plausible rather than less.
