# 0602: Delete a retired Destination that never sent, and the review queue's error in place

**Status: built and tested locally, not yet pushed or deployed.** It
touches `vf-ui` and `vf-admin` only (and a `vf-app` test). No migrations.
Deploy vf-ui and vf-admin.

## What was asked

Two small fixes offered earlier, and asked for on 2 October: *"Can you
complete the two small fixes"*.

1. Dan had a retired Destination with no way to delete it, and was given
   wrangler commands to remove it by hand (after 0599).
2. The operator console's review queue (0600) stayed on "Loading…" when
   vf-licence had not yet been redeployed, with nothing in the panel to
   say why.

## What was decided

### Delete a retired Destination that never sent (`vf-ui`)

A retired Destination's panel (0597) offered only Close. Now, where it is
HTTPS out and has never sent (`neverSent`, 0599), it offers **Delete**
too, asked first as on any other. `vf-app` already allowed it: deleting
looks only at whether it has sent, was sent to by a rule, is sent to by a
rule in force, or is watched by an alert (0599), never at whether it is
retired. One that has sent stays retired, with what it sent kept.

### The review queue says why it could not load (`vf-admin`)

`loadReviews` runs on its own, after the partners and invitations
whatever happened to them, and catches its own failure. Instead of
"Loading…", the panel says *"The review queue could not be loaded: …"*
with the reason the control plane gave, and to check vf-licence is
deployed and its migrations applied.

## Verification

- **`vf-ui`**, `routes.test.ts`, 1 new test: a retired Destination that
  never sent offers Delete beside Close, asks first, and deletes once
  confirmed. It fails against the interface before this change. The
  retired test (Close only) now says it has sent. Browser 1451, of which
  1450 pass (the known `typography.test.ts` 10px gap).
- **`vf-app`**, `destination-rename-retire.test.ts`, 1 new test: a
  retired one that never sent is shown as such on the flow and is
  deleted. 8 of 8.
- **`vf-admin`**: in a browser, with the review routes and invitations
  failing, the panel shows the error and the partners still load. 12 of
  12.
