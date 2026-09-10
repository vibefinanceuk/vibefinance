# 0201 — Delegated administration

**Status: built.** A role is granted in an org by somebody who
administers it, and the org endpoints are no longer ungated for ever.

---

## The model, and it needed no new mechanism

> Someone assigned AP.Validation does not get access to French
> documents when they have been given access to the German AP.Validation
> role. An AP Manager could be a regional, org-based role — it should
> give access to all stages in a process for that org.

**That is expressible today**, and this record's tests prove it rather
than asserting it:

- **A role is a list of permissions** (decision 0010). *AP Validator* is
  `["AP.Validate"]`; *AP Manager* is every stage's permission.
- **An assignment carries a unit** (decision 0199). Where somebody holds
  a role is a separate fact from what the role grants.

**A regional manager is the two together.** The bundle is wide, the
place is narrow, and one *AP Manager* definition serves every org —
which is exactly why decision 0199 put the scope on the assignment
rather than duplicating the role per country.

---

## The org endpoints were ungated, and not only at bootstrap

**This is the larger finding**, and it was not what was asked for.

Decision 0010 left `/org/users/:id/roles` open with a real reason:

> Creating the very first user in a brand-new instance would otherwise
> be structurally impossible — nobody could ever be authenticated to
> create the first account that grants authentication.

**That reason holds only while there is nobody.** Once one person
exists, the deadlock is gone — and the exception was permanent, so
**anybody who could reach the instance could grant themselves any
role.**

The exception is now conditional on the thing that justified it:
ungated while `org_users` is empty, authenticated after.

**A test that assigned a role over an unauthenticated request now
expects 401**, and asserts nothing was written.

---

## Granting is bounded above, not only below

A France administrator granting in Germany is the obvious refusal.

**The subtle one is granting *everywhere*.** A role with no unit reaches
the whole group — more than the granter holds — so it is refused with
its own reason. Both are privilege escalation by a route being helpful.

An administrator holding `Admin.UserManagement` **unscoped** may still
grant unscoped, which is every customer not using units.

---

## And a check that was right until decision 0199

*"User already has role"* asked whether somebody held it **at all**.

That was the same question until a role could be held **somewhere** —
and it then wrongly refused a person holding *AP Clerk* in France from
also holding it in Germany. It asks per place now.

**Holding a role everywhere still blocks a scoped grant**, because
everywhere already covers France and the scoped row would read as a
restriction it is not — which migration 0047 refuses as a standing
invariant.

---

## What is not built

- **The task list is still not unit-aware**, so a German validator sees
  French tasks. Decision 0199's gap, unchanged and now the largest one:
  a person is correctly denied *acting* and still shown the work.
- **`Admin.UserManagement` is the only administrative permission
  checked.** Creating users, roles and teams remain ungated after
  bootstrap.
- **No stage declares its permission** (decision 0200), so the mapping
  from *AP Validation* to `AP.Validate` is a convention rather than
  configuration.
- **No screen.** Roles are granted by `POST`, and *"AP Manager
  (France)"* is a pairing nobody can see listed.
