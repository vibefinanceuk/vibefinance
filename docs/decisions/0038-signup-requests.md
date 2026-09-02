# 0038 — Signup requests, and the human approval checkpoint

Status: settled, 2 September 2026. The first piece built on top of
decision 0036's environments foundation, and the front door of the
real signup -> trial -> sandbox -> production flow.

## The flow this actually serves

The website says: *"Request a 30-day free trial"* and *"A member of
our provisioning team will be in contact."* That second sentence is
the design. This is not an instant self-serve signup that provisions
in seconds — it is a request that lands in a queue, followed by a real
human conversation: the operator reviews it, typically emails the
requester to discuss their project, and provides enablement,
documentation and training *before* approving anything.

That conversation is deliberately not modelled here. No review notes,
no status for "currently emailing them", no CRM fields. The operator's
own framing: that belongs in email, not in the control plane. This
table records the decision and its outcome, and nothing else.

## Approval triggers provisioning; it is not provisioning

The single most important shape in this decision, and the operator's
own call: approving a request marks it approved and does nothing else.
The real provisioning — creating the Cloudflare D1 database, R2
bucket, and Worker, then the customers/environments/licences rows —
is a separate step that reads approved requests and acts on them.

The reason is decoupling: the two can fail, be retried, and evolve
independently. An approved-but-not-yet-provisioned request is a real,
legible state in the data, rather than approval being an
all-or-nothing action that either fully succeeds or leaves no trace.
`POST /signup-requests/:id/provisioned` closes the loop afterwards,
linking the request to the customer and environment it produced.

Proven directly rather than asserted: a test approves a request and
then confirms `customers` is still empty — approval genuinely creates
no infrastructure.

## Rejection is silent, and never final

A rejected request updates the row and sends the requester nothing at
all. The record exists for the operator, not as a notification
mechanism.

Critically, rejection must never block a future signup — the same
person or company can genuinely come back in six months. That means
no uniqueness constraint on `contact_email` or `company_name`, which
is a real, deliberate schema decision rather than an oversight, and is
covered by its own test: reject a request, submit another from the
same email, confirm it lands as pending.

## Status set kept deliberately small

`pending` / `approved` / `rejected`. An `in_review` status was
considered and declined — the operator's call. A request being
actively discussed is indistinguishable in the data from one that
arrived a minute ago, and that is acceptable: the operator knows which
conversations are live because they are having them.

## The one unauthenticated write endpoint on vf-licence

`POST /signup-requests` is deliberately public, and is the only write
endpoint on this Worker that is. A prospective customer filling in a
website form has no credential by definition. It is placed before the
admin gate in the router for exactly that reason.

Everything else in the flow — the review queue, approve, reject, and
recording provisioning — is admin-only. Both properties are tested
through the real router: the public route is confirmed to genuinely
return 201 without any Authorization header (not merely "not 401"),
and each admin route is confirmed to 401 without one. The admin gate
test was watched to fail: removing the approve route from the gate
makes the request reach the handler, and the test catches it.

## An honest limitation: decidedBy is supplied, not derived

`vf-app` derives "who approved this rule" from the authenticated
caller (decision 0010), and never accepts it from a request body.
This route cannot do the same, and says so plainly rather than faking
it: `ADMIN_API_KEY` is a single shared secret, so `vf-licence`
genuinely cannot tell which individual is acting. `decidedBy` is
therefore a required field on the request.

Recording an invented value would be worse than requiring the caller
to state who they are. If per-operator attribution ever matters here,
it needs real per-operator admin credentials first — a separate piece
of work, named rather than quietly worked around.

## One check the foreign keys cannot make

`handleRecordProvisioning` verifies that the supplied environment
actually belongs to the supplied customer. Both ids are real and exist
independently, so every FK constraint passes while the relationship
between them is still wrong — a genuinely silent data error, caught
here with its own test.

## What's still open

- The provisioning step itself: the real Cloudflare API calls, and
  the trial licence that a newly provisioned sandbox needs. This
  decision deliberately stops at the boundary.
- Any notification to the requester on approval — currently nothing is
  sent in either direction; the operator emails them personally.
- Per-operator admin identity, as above.
