# 0720: The supplier portal's actions as small icons with their word

**Status: built**, not yet deployed. vf-ui (`suppliers.js`, `app.css`). No migration.

## What was asked

Dan, 10 October 2026: *"Change the Invite to Portal icon to be small, with writing on the
right of the image. Place the button to the right of the Email address entry box. Change the
'Change companies' and 'end access' buttons to have icons. When you click Change companies,
the Save and cancel buttons should also have discrete icons, with text on the right."* A
mock-up from the real screen, then: *"looks good"*.

## What changed

Every action in the supplier pop-out's portal column is a compact action (`compactLink`, the
product's small icon with its word to the right):

| Action | Icon |
| --- | --- |
| Invite to portal | `newperson`, beside the Email address box on one row |
| Change companies | `rename` (a pencil) |
| End access | `deactivate`, as Deactivate on the supplier |
| Cancel invitation | `discard` |
| Save, when changing companies | `save` |
| Cancel, when changing companies | `close` |

## Tests

vf-ui `suppliers.test.ts`: Invite in the row with the email box; every person's action
compact, with an icon. The existing portal tests pass unchanged.
