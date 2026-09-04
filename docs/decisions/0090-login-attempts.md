# 0090 — Recording sign-in attempts, and slowing down guessing

**Status: built** — the counting, the delay, the report and the sweep.
**Not built:** the login endpoint that calls them.

---

## Progressive delay, not lockout

SOC 2 requires brute-force protection under CC6.1, and having none at
all is an automatic finding. Industry consensus for a hard lockout is
**3–6 failures and 30–60 minutes** (NIST AC-7 says 5–10; PCI DSS caps at
6 with 30 minutes).

**Auditors accept progressive delay as an equivalent control**, and it
avoids the trade-off a lockout carries: anybody who knows a colleague's
email could otherwise lock them out by guessing wrong five times. A
denial of service wearing a security feature's clothes.

So the account is never locked. It gets slower — nothing for the first
two failures, because a mistyped password is ordinary, then climbing to
half an hour. By the eighth failure an attacker manages roughly three
attempts an hour against one account, which makes a dictionary attack
pointless while a real person who mistyped waits a few seconds.

---

## In the control plane, and why that is not a widening

Authentication happens in `vf-licence`; an instance never sees a
password. But Document 3's constraint is that `CONTROL_DB` holds
*customers, licences and aggregate usage counts — never customer
content*, and this is personal data.

**The operator's answer: a failed login attempt is not customer
content.** It is *authentication* data, belonging to the act of signing
in, which is this Worker's own job.

That draws the line in a way that generalises: `vf-licence` holds what
it needs to do its work, and never the customer's **business** data.
Invoices, rules and facts are content; the record of somebody failing
to authenticate is not. The constraint stays meaningful rather than
becoming a rule about personal data in general.

---

## The counter resets; the record does not

A success clears the count — otherwise anybody who occasionally mistypes
accumulates towards inevitable lockout.

**The rows stay.** *"Three failures on Tuesday, then a success"* is
exactly the pattern worth seeing later, and deleting on success would
erase the interesting case while keeping only the boring ones.

One table read two ways: the counter is *failures since the last
success*, and the log is everything.

---

## ISO 27001:2022 Annex A 8.5 asks for something specific

After a successful sign-in, show the person **when they last signed in**
and **every attempt since**.

That turns the count from bookkeeping into something with a purpose. A
person who sees three failed attempts from an address they do not
recognise knows something an audit log read by nobody never would.

Annex A 8.5 also requires failed attempts to be noted *"including for
criminal and/or regulatory proceedings"*, which is why the source
address is recorded and why retention is a year rather than a month.

---

## Twelve months, and this one really deletes

ISO 27001 requires logs of security events without setting a duration;
twelve months is the common recommendation and what an auditor expects.

Unlike document retention (decision 0077), which is a **benchmark that
deletes nothing**, this sweep deletes. The reasoning differs: an attempt
has no value to anybody after a year, where an invoice may have several.

---

## Two bypasses, not bugs

Both watched to fail, and one of them exposed a bad test.

**Scoped by environment.** Failures against `Acme-production-eu` must
not slow a sign-in to `Acme-production-us` — separate instances,
separate data, and decision 0086's tokens are already scoped this way.

**Case-folded emails.** `Dan@Acme.com` and `dan@acme.com` must be one
key. Otherwise an attacker retypes the address in a different case and
the delay lookup misses entirely.

> **The first version of that test proved nothing.** It recorded with
> mixed case and read with lowercase — and the write path lowercases
> anyway, so removing the read path's fold changed nothing and the test
> still passed. The bypass runs the other way: attempts accumulate
> against the stored lowercase address, and the attacker retypes hoping
> the *lookup* misses.
>
> Caught only by watching it fail and seeing it not. **A fail-watch that
> does not fail is information**, and the second time this session that
> a test needed correcting rather than the code.

---

## What is not built

- **The login endpoint** that calls any of this.
- **Alerting.** *"A lockout policy that generates no alert is half a
  control"* — and nothing in this system sends email. The attempts are
  recorded and queryable; nobody is told.
- **The sweep is not scheduled.** `vf-licence` has an hourly cron; this
  is not attached to it.
- **Nothing shows the ISO 8.5 report to anybody**, because there is no
  interface. The data is there for the screen that will.
