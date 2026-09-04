# 0091 — Where a credential lives

**Status: decided, not built.** Answers the question decision 0089 left
open, and it turned on a constraint rather than a preference.

---

## The constraint

`vf-licence` has **exactly one binding**: `CONTROL_DB`. Checked
directly, not assumed.

`org_users` lives in each customer's own D1 database. So the Worker that
performs authentication **cannot read the user table** — not "should
not", cannot reach it.

---

## Moving authentication to the instance does not work

The instance has `org_users` and could verify a password. It cannot
**mint** a session token: it holds only the public half of the signing
key, which is exactly what makes local verification with no network call
possible (decision 0086).

So `vf-licence` would have to mint on the instance's say-so, needing a
call in the direction that does not exist. `vf-app` has a service
binding **to** `vf-licence`; the reverse would need one binding per
customer, on a Worker whose whole value is being a single shared
deployment.

---

## The division

**Not a replication.** One thing split by purpose, rather than two
copies of the same thing drifting apart.

| | Where | What it knows |
| --- | --- | --- |
| `org_users` | The customer's own database | **Who somebody is, and what they may do** — roles, unit, authority limits, team membership, who confirmed a worked example, who keyed a field |
| A credential row | `vf-licence` | **How to check they are who they say** — an email, an environment, a password hash. Nothing else. |

`org_users` does not move, and could not: everything ties to it.
`org_authority_limits` binds to a user id, `assign_task` names one,
`keyed_fields.keyed_by` references one. A user table in the control
plane would break all of that.

What goes to `vf-licence` is only the secret needed to verify a
password, in the only place the verifier can reach.

---

## The property that makes this more than a workaround

**No credential means no password login**, without a flag to say so.

A customer using SSO simply has no credential rows. A customer using
local accounts has one per person. A customer using both has some of
each. The absence carries the meaning, which is a better mechanism than
a boolean somebody has to remember to set.

And decision 0088 already handles the dangerous direction: **a
credential with no `org_users` row is refused.** The control plane can
verify a password all it likes; the instance decides whether that person
exists there.

The other direction — an `org_users` row with no credential — means
somebody set up who cannot use password login. Which is correct, and is
exactly the SSO case.

---

## Still open

**Is a credential keyed by email and customer, or email and
environment?**

One password across a customer's EU and US instances is better for the
person, with access still decided per-environment by `org_users`. Two
passwords is more isolated and more to administer.

Worth noting the existing `login_attempts` table (decision 0090) is
keyed by **email and environment**, on the reasoning that failures
against one instance should not slow a sign-in to another. That
reasoning holds regardless: a shared credential can still have separate
delay counters, because the delay is about the attempt and not about the
secret.
