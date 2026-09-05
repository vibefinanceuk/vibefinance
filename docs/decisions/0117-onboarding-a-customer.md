# 0117 — Onboarding a customer, and who their first user is

**Status: designed, not built.** Corrects decision 0094, and puts an
order on four things that have been listed separately.

---

## The requester becomes the administrator

Decision 0094 concluded that a bootstrap administrator **was not
needed**, because the operator holds the admin key and could create the
first credential by hand.

**That was true and it was the wrong conclusion.** It left the customer
with no administrator of their own, which is why `HANDOVER.md` has
carried *"who creates the `org_users` row"* as an open question ever
since.

The answer the operator gave, and it is better than either position:

> The initial administrator would be the requesting user.

**There is no bootstrap account to invent.** `signup_requests` already
carries `contact_name` and `contact_email` — the person who filled in
the form. Approving their request is what makes them the administrator
of the customer it creates.

### And approval is not weakened by this

Stated explicitly, because it is the obvious misreading:

> That does not mean approval by me before provisioning is not
> required.

Decision 0038 records why the checkpoint exists — a chance to *"speak
with the customer, sell them on the technology, show them the product
documentation, guide them through onboarding"*. The requester becoming
an administrator is a **consequence of provisioning**, never a
substitute for the gate. **Nobody self-provisions by signing up.**

---

## The obstacle that turned out not to be one

`vf-licence` holds only `CONTROL_DB` and **cannot reach a customer's
`org_users` table** (decision 0091). So creating the first user looked
like it needed a cross-Worker call in the direction that does not
exist.

It does not. **Provisioning creates the D1 database and applies the
migration chain** (decision 0039) — it has the instance in its hands at
that moment. The first `org_users` row is a seed step in that same
process.

It only looks impossible today because the Cloudflare half of 0039 is
unbuilt: provisioning currently stops at control-plane rows and reports
`infrastructureProvisioned: false` rather than pretending otherwise.

---

## What provisioning must create, beyond what it does

Today: an API key, the customer, a **sandbox** environment, a trial
licence, and the link back to the request.

Adding:

- an `org_users` row for the requester, in the new instance;
- a **credential** and an **access grant** in the control plane
  (decisions 0092, 0111);
- an administrator **role**, rather than every permission implicitly.

A named role is tidier: their permissions are then visible and
adjustable like anybody else's, instead of being a special case nothing
lists.

---

## They set their own password, from a link

The operator's choice, and it makes **email load-bearing**.

Email has been listed as *"the most-referenced missing capability"* for
some time, blocking alerting on failed sign-ins, password reset and
licence expiry warnings. Those are all things that would be *nice*.

**This is different.** A password link is the first step of onboarding,
so without email **nobody can sign in at all**. It stops being a gap and
becomes the gate.

The alternative — the operator setting a password and telling them —
means a password that has travelled through a conversation, which
decision 0089's whole record argues against.

---

## Get Started, on first sign-in

Without it, an administrator arrives at an instance with no process, no
source, no rules and no colleagues: **every screen technically working
and nothing to do.** It is the first thing they see and it decides
whether they stay.

The steps the operator named, and what each stands on:

| Step | Stands on |
| --- | --- |
| Create a source for emailed documents | Built — `mechanism: 'email'`, PDF and image capture |
| Set up the initial org | Built — `POST /org/units`, and a default org on the source (0111) |
| Load a sample set of invoices | **Not built** |
| Suppliers appear automatically | **Not built** |
| Invite colleagues | Built — org users, roles, teams |

Three of five are configuration rather than code, which is the point: a
wizard that walks somebody through what already exists.

---

## Sample invoices, and a question about them

**Whose documents?** Realistic fakes shipped with the product show it
working in minutes. A customer's own first documents are real, with all
the mess that implies — and mess is what this product is for.

Not settled here. Worth noting that a sample set which never fails
teaches somebody the product always works, and the Validation queue
exists precisely because it does not.

---

## Suppliers spawn from documents

**There is no supplier master.** `/suppliers/:vatId/history` queries
invoices by the VAT identifier printed on them, so a supplier is a
string on a document rather than a record.

*"Automatically spawn supplier records"* is the best argument for
building one that has been made. The alternative is asking a customer to
type five hundred suppliers before anything works — which nobody will
do, and which is the reason to have a master in the first place.

**Letting them emerge from documents means the master is populated by
using the product.** And `BT-27`, the seller's name, only started being
read two days ago (decision 0112) — before that a spawned record would
have been a bare VAT identifier with nothing to call it.

Supplier **sites** assigned to operating units follow from there
(decision 0111), and are what *"supplier groups"* in `PROGRESS.md` has
always been waiting for.

---

## The order this implies

1. **Email.** Everything above stands on it, and three other items have
   been waiting on it independently.
2. **The supplier master**, with records spawning from captured
   documents.
3. **Provisioning creating the first administrator** — the seed step,
   the credential, the grant, the role.
4. **Get Started**, which ties them together and is worth building last
   because it is a tour of things that must exist first.

---

## Deliberately not decided here

- **What an administrator may do.** A named role, but its permission
  set is not enumerated.
- **Whether a spawned supplier is editable**, and what happens when two
  documents disagree about a name for the same VAT identifier.
- **How long a password link lives**, and what happens when it expires
  before somebody uses it.
- **Whether Get Started can be dismissed** and returned to, or is a
  one-time sequence.
