# 0199 — A role is held somewhere

**Status: built, and applied in one place.** Read the last section
before relying on it.

---

## The requirement

> I think roles should be defined first, because the role should be by
> org / operating unit. For example assigning AP Manager role for one
> org will not give a user visibility outside of that org.

**Decision 0192's third step**, and the one it called irreversible: the
point where a unit stops being a filing label and becomes a boundary.

---

## On the assignment, not on the role

Decision 0194 found Oracle scopes the **role** — a data role belongs to
a business unit, and a person holds several. That works and it
duplicates: adding a country means recreating every role in it.

**The operator's phrasing settles it.** *"Assigning AP Manager role for
one org"* — one definition, assigned per org. *AP Manager* is a bundle
of permissions; **where somebody holds it** is a separate fact, and
Alice may hold it in France and Germany without there being two of it.

**Null means everywhere**, which is what every assignment predating this
is — made explicit by the migration rather than left implied. **Nothing
changed on the day it landed.**

---

## Two questions, and they need opposite walks

**"May this person act here?"** walks **up** from the document: a role
held at Acme France covers AP France beneath it.

**"What may this person see?"** walks **down** from what they hold:
everything beneath Acme France, or the list is empty of the very
invoices they are meant to work on.

Both are in `enforce.ts`, and the second is the operator's actual
requirement — permission answers *may I*, visibility answers *what is
there*.

### Null and empty are different answers

`null` means **everywhere** — a role held unscoped, and every customer
who has never scoped anything. A caller treats it as *no filter*.

`[]` means **nowhere**, which is a real answer: the person holds the
permission in no unit at all.

**Conflating them would either hide everything from every existing
customer or show everything to a restricted one**, and which failure you
get depends on which way the mistake goes.

---

## A document with no unit is nobody's

It is hidden from anybody restricted, and shown to anybody unrestricted.

**It might be Germany's and not yet assigned**, and showing it to France
would be guessing. A customer not using units is unaffected, because
their people hold roles everywhere.

---

## The dangerous default, stated openly

`hasPermission(db, user, permission)` with **no unit** asks *"could this
person do this at all"* and returns true if they hold it anywhere.

That is right for a route which is not about one document, and **wrong
for one that is**. It is decision 0192's risk in its sharpest form:
forgetting the unit does not fail — **it grants.**

`resolveTenant`'s lint rule makes the equivalent mistake uncompilable.
This cannot, because the parameter is optional by design and every
existing caller relies on that.

---

## What is not built, and this matters

**Fourteen permission checks exist and one is unit-aware.** The document
list filters; **the task list does not**, nor does keying, approving,
returning, or anything else.

**So this is a boundary in one place.** A person restricted to France
cannot *see* German documents in the document manager and can still
reach one by other routes.

**That is not a boundary**, and calling it one would be the mistake
decision 0144 recorded — a screen that guards where a route does not.

The migration is backward compatible and nothing is scoped in any real
customer, so nothing is currently wrong. **It becomes wrong the moment
somebody scopes an assignment and believes it.**

The remaining thirteen call sites, and the task list, are the next
piece — and until they are done, scoping an assignment is a test rather
than a control.
