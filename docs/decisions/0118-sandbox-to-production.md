# 0118 — From a sandbox to production

**Status: designed, not built.** What a customer keeps when a trial
becomes real, and what they do not.

---

## The sandbox does not become production

The obvious shape — flip `kind` and delete the samples — was considered
and rejected.

It carries fabricated data forward into a real accounts payable, on the
strength of a cleanup being complete. **A second environment is
provisioned instead**, and the configuration is migrated into it.

Decision 0084 already made a customer able to hold several environments
per region, and the sign-in selector exists precisely so somebody can
move between them. This is that capability used for what it was for.

### And the sandbox stays

Not a trial that ends. It becomes **the place a rule change is tested
before it touches real invoices** — which customers ask for and which
now needs no separate feature.

---

## Configuration migrates; nothing else does

The operator's line, which is sharper than the one this record started
with:

> True configuration can be migrated. Users are not configuration.

**A user is a person, not a setting.** Somebody with access to a
sandbox has not thereby been granted access to real invoices, and
copying them across would make that decision silently. Production starts
with the administrator, who invites colleagues deliberately.

That also fits what exists: access is per environment (decision 0092),
and decision 0088 refuses anybody with no `org_users` row.

### The second half of the same line

> Roles and permissions can transfer. Assignment of them does not.

A **role** is a definition — a name and a set of permissions, authored
by the customer, and exactly the kind of thing rebuilding by hand wastes
a fortnight. An **assignment** names a person, so it is a decision about
somebody rather than a definition.

Teams divide the same way: the team exists, its membership does not.

---

## The line, table by table

| Migrates | Does not |
| --- | --- |
| `processes`, `process_stages` | `process_instances`, `stage_visits`, `stage_visit_steps` |
| `rule_sets`, `rules`, `rule_versions`, `rule_examples` | `tasks` |
| `org_units` | `org_users`, `org_user_roles` |
| `org_roles` (definitions) | `org_authority_limits` (names a user) |
| `org_teams` (definitions) | `org_team_members` (names a user) |
| `org_profiles`, `org_settings` | `invoice_headers`, `invoice_lines`, `invoice_documents` |
| `field_visibility`, `stage_field_visibility` | `keyed_fields`, `field_overrides` |
| `custom_fields`, `cost_centres` | `purchase_orders`, `purchase_order_lines` |
| `sources` | `intake_capture_events`, `pending_documents` |
| Branding (control plane) | Credentials, access grants (control plane) |

**Suppliers, once a master exists**, do not migrate. A supplier record
is something that accumulated from documents rather than something a
customer configured — and in a sandbox some of them will have spawned
from **fabricated** invoices (decision 0117). Migrating them would carry
across precisely the thing that must not cross.

They re-emerge from real documents anyway, which is the point of
spawning them.

---

## Purchase orders do not migrate either

Reference data rather than configuration: they arrive from a customer's
ERP (decision 0081) and will arrive again. A sandbox's orders are
whatever was loaded to try the feature.

---

## What this needs, and what it costs

**A source's default org** (decision 0111) points at an `org_units` row,
and org units migrate — so the reference survives, provided units keep
their ids. **Migrating by id rather than by name** is what makes every
cross-reference hold: a stage's `rule_set_id`, a rule's
`required_permission`, a source's `process_id`.

**The cost is that this list must be maintained.** A table added and not
classified is a table that silently fails to migrate, or silently does.

That is the same class of gap this project keeps finding, so the check
should be structural: **a test asserting every table in the schema
appears in exactly one column of the list above**, failing when a new
one appears in neither.

---

## Deliberately not decided here

- **Whether migration is one act or repeatable.** A customer refining
  rules in the sandbox for months would want to push changes again, and
  a second run has to reckon with what production has since diverged
  into.
- **What happens to a rule mid-approval.** A rule compiled and not yet
  activated is configuration in an unfinished state.
- **Whether the administrator is asked to confirm** each part, or the
  whole thing moves at once.
