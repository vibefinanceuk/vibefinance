# 0217 — A row already there

**Status: fixed.** A load finds a supplier by what the ERP calls it, not
by what the loader would have called it.

---

## The failure decision 0216 made visible

> The file was loaded, but this screen could not show the result:
> Unexpected token 'e', "error code: 1101 " is not valid JSON

**Cloudflare's 1101 means a Worker threw.** So `vf-app` crashed and
returned an error page, and the screen — one commit earlier — would have
called that a network failure.

**The honest message earned its keep immediately.** It named the layer
and quoted the text, and the text was enough to find this.

---

## A key the loader assumed it owned

The loader constructed an id from the ERP identifier and the site, then
used `ON CONFLICT(id) DO UPDATE`.

**Which catches a row the loader created before, and not a row already
there under a different id.**

The live database had exactly that: a supplier inserted by hand as
`northwind`, carrying ERP identifier `40118` — from a command **I** gave
to prove matching worked. The loader's own `40118` row conflicted on the
unique index rather than on the primary key, `ON CONFLICT(id)` did not
apply, and SQLite refused.

**A constraint doing its job, reaching a person as a JSON parse error.**

---

## The ERP identifier is the identity, so look it up

Decision 0209 made that the whole argument for the table. **The lookup
now uses it**, matching on site as well so one ERP number with two sites
stays two rows.

**And an existing row keeps its own id**, which matters more than it
looks: an invoice matched to `northwind` yesterday still means that
supplier, and giving the row a new id would orphan it.

---

## What this says about the tests

Thirty passed while this was broken, because **every one of them started
from an empty table.**

The loader was tested against data it had created and never against data
it had not. **A mirror's whole job is data somebody else made**, and the
one case that matters was the one no test had.

Four tests now start from a row the loader did not write.
