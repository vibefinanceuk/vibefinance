# 0440 — AP Setup: the screen, and the Approval Hierarchy write API

**Status: built, tested. Not yet pushed or deployed** — this session
still has no push access to `vibefinanceuk/vibefinance`; delivered as a
git bundle for the operator's own pull/push/deploy sequence, the same
path decisions 0391, 0415–0439 already used.

---

## What this is

Decision 0439 shipped the Approval Hierarchy migration and resolver,
deliberately deferred at the operator's own instruction: *"Yes, start
with the migration and resolver, mock-up not necessary at this point.
The configuration screen should follow UI principles adopted by the
Access screen, which is very similar."* This is that screen, and the
write API it needs — both pieces decision 0439's own "What is not
built" named directly.

## What was built

**"AP Setup," a new nav entry** — the operator's own name and shape:
*"Under a new side menu option, I would like to establish AP
Configuration options... Matching, Account Coding and Approval
Hierarchy setup screens in tabs."* `ap-setup.js`, gated on
`Admin.Configure` — the same instance-wide permission Sources,
Purchase Orders and Processes already gate in the same "configuration"
nav group, since AP Setup configures how invoices are matched, coded
and approved for everyone, not a delegable per-org concern. Reuses
`access.js`'s own `.tabbar`/`.tab` component (already shared by
`ap-analytics.js`), per the operator's own instruction that this screen
follow the Access screen's own conventions.

**Matching and Account Coding are real placeholder tabs** — the same
shape `ap-analytics.js`'s own `placeholderCard()` already gives an
unbuilt tab. Both are genuinely greenfield, confirmed during decision
0439's own investigation: no existing screen or backend for either, and
no Coding stage exists in any real process yet. Named here rather than
silently left off the nav, since the operator asked for all three tabs
by name.

**Approval Hierarchy is live.** Its form follows `access.js`'s own
conventions directly, per the operator's instruction:

- **Mode and Default Approver**, one `.editgrid` form, one Save —
  the same "replace, not merge" shape `openPersonPropertiesForm`'s own
  properties form already takes.
- **The two override lists** — `org_user_supervisor_overrides` and
  `org_authority_limit_overrides`, decision 0439's own tables — each
  with an inline picker row and its own Add button, the same shape
  `openTeamForm`'s own member picker already uses, and each row
  removable, the same "Remove" pattern `access.js` already has for
  team members and role assignments.
- **The shared currency picker, exported and reused, not
  duplicated** — `access.js`'s own `currencyPicker()` (the 156-currency,
  ISO-4217-filtered list decision 0342 built) is now exported and
  imported here for the limit-override form, rather than a second copy
  of the same list.

**The write API**, `approval-config-route.ts` — six handlers, matching
the "closed vocabulary, upsert on a composite key" shape `org-route.ts`
and `field-visibility-route.ts` already established:

- `GET /approval-config` — the config plus both override lists,
  joined to real user and unit names, never bare ids.
- `PUT /approval-config` — mode and Default Approver together.
- `POST`/`DELETE /approval-config/supervisor-overrides` — upsert on
  `(user_id, unit_id)`, self-supervision refused before the database's
  own CHECK constraint has to, a delete that matches nothing 404s
  rather than silently no-opping (the same discipline
  `handleRevokeRole` already follows).
- `POST`/`DELETE /approval-config/limit-overrides` — upsert on
  `(user_id, unit_id, currency)`, same discipline.

**Currency stays free text, not a closed vocabulary** — checked
directly before building: `shared/interpreter/closed-values.ts` has no
ISO-4217-style list, and `handleSetAuthorityLimit` (decision 0009)
already accepts free-text currency for the exact same kind of limit.
This route matches that existing precedent rather than inventing
validation nothing else in the system has; the UI still constrains
input to the same closed 156-currency list `access.js` already offers,
so a real gap here would need a person typing outside the picker.

**Turning `process_stages.uses_approval_hierarchy` on for a real
stage stays SQL-only** — the same place decision 0439 left it, and the
same place `required_permission` (decision 0200) already sits. No
route anywhere in this app edits a stage's own properties post-publish
(`process-route.ts` has no `handleUpdateStage`); inventing one for a
single flag was out of scope for this screen and follows nothing this
codebase already does.

## Tests

`workers/vf-app/test/approval-config-route.test.ts` (new, 21 tests):
every handler's own validation (missing fields, self-supervision,
negative amounts, a mode outside the vocabulary), 404s for a
nonexistent user/unit/supervisor and for a delete matching nothing,
the upsert-not-duplicate behaviour on both override tables' own
composite keys, and the operator's own example — EUR at Acme France
and GBP at a different org, both real, independent rows.

`workers/vf-ui/test-browser/ap-setup.test.ts` (new, 13 tests): the
screen opens and is refused without `Admin.Configure`; a failed load
shows a real error and keeps the nav reachable (the same decision 0322
discipline `access.js` already has); Matching and Account Coding show
their own placeholder; the mode picker offers exactly the four
vocabulary values and shows the configured one selected; both override
lists show their own empty state, list a real row by name, and a
Remove click calls the matching delete route.

**Suite state**: vf-app and vf-licence test suites, `vf-ui`'s own
browser suite, and `eslint`, all run clean against this change — see
`docs/HANDOVER.md` for the exact counts recorded at delivery.
