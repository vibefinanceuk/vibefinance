# 0597: Renaming and retiring a Destination

**Status: built and tested locally, not yet pushed or deployed.** `vf-app`
(with **migration `0124`**), `vf-ui`, and **`vf-licence` migration `0244`**
(strings).

## What was asked

Dan, 2 October 2026, while testing slice 4:

> *"Can you also add the ability to rename and retire a Destination
> Route, in a similar we have have that option for a Source Route. I will
> need for testing"*

## What was decided

On Process routes, a Destination's panel now has **Rename** and
**Retire** beside its other buttons, as a Source's has (0130, 0583).

### Rename

A pop-out with its name. Up to 80 characters, and not the name of another
Destination in the same process that is not retired. **Rules name a
Destination by its id** (0588), so none needs changing, and the pop-out
says so.

### Retire

A pop-out asks first, saying what happens: it **sends nothing more**,
**cannot be resumed**, what it sent stays in the Route monitor, and it
stays on Process routes as retired.

- **Refused while a rule in force sends invoices to it**
  (`send_to_destination`, 0588), naming the rules, so a rule never sends
  to nowhere. A rule whose versions have all ended does not count.
- **The ERP CSV file is not retired here**: its export screen is how its
  invoices leave. It has Rename only.
- Retired, it records when and by whom (migration `0124`:
  `route_instances.retired_at`, `retired_by`).

### Retired, it stays on the flow

Process routes now lists retired Destinations, **last and dimmed**, with a
**Retired** pill, as retired Sources already were. Its panel shows only
that it is retired, with nothing to do but Close; its settings, try and
deliveries are not shown. The delivery sweep, Send, resuming and the rule
compiler already left retired Destinations out, and still do.

### Routes

`PATCH /route-instances/:id` (`Admin.Configure`, as before) now also takes
`{ name }` to rename and `{ status: "retired" }` to retire; `{ status:
"active" | "paused" }` is unchanged.

## Verification

- **`vf-app`**, `destination-rename-retire.test.ts`, 5 tests: rename, its
  refusals (empty, taken in the process, retired), a retired one's name
  free again; retired: recorded, not again, not resumed, not swept, not
  sent, and on Process routes as retired; refused while a rule in force
  sends to it, naming it, and not for an ended rule; not the ERP CSV
  file; the router renames and retires with `PATCH`.
- **`vf-ui`**, `routes.test.ts`, 3 new tests and 3 updated (the panels'
  buttons now include Rename, and Retire for HTTPS out): rename and its
  refusal in words; retire asked first, and the rule named; a retired
  card dimmed with its pill, and its panel with nothing but Close. 6 fail
  against the interface before this change.
- **Migrations** replay: `vf-app` 124, `vf-licence` 244.
- **Full runs**: `vf-app` 3420, of which 3417 pass (the two known failures, 0511, and the known router timeout in `index.test.ts`, which passes alone); `vf-ui` browser 1446, of which 1445 pass
  (the known `typography.test.ts` 10px gap), worker 109 of 109;
  `vf-licence` 342 of 342.
