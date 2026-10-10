# 0719: The supplier pop-out in two columns, the supplier portal on the right

**Status: built**, not yet deployed. vf-ui (`suppliers.js`, `app.css`); vf-licence migration
`0325_portal_invite_heading_strings.sql`.

## What was asked

Dan, 10 October 2026, after 0718: *"I like the UI you have designed - can we widen the
supplier pop-out and include this to the right of the current supplier information? can you
show that as a mock-up?"* A mock-up was made from the real screen and styles (a supplier with
12 companies; and with Change companies open). Then: *"looks good"*.

## What changed

- **Two columns.** The pop-out widens to at most 1,180px: the supplier's record (the fields,
  project-only, invoice layouts learned) on the left, the supplier portal on the right, with
  a thin divider. The heading, the ERP line and Hold, Deactivate, Save and Close are unchanged
  across the top.
- **Only when the portal has something to show.** A customer whose licence has no portal, or
  a person who may not see it, keeps the single column it had.
- **Narrow windows** (under 900px) stack the portal under the record again.
- **People as rows**: the email in bold with its companies beneath, the actions right-aligned.
- **A heading over the invitation**, *"Invite someone from Lager Nord GmbH"*, so it reads apart
  from the people already linked. Its company list scrolls rather than lengthening the pop-out.

## Tests

vf-ui `suppliers.test.ts` (2): wide with the portal in the right column, the record's
sections in the left, and the heading; one column when not licensed. Checked by screenshot
against the mock-up. vf-licence: the new string in coverage.
