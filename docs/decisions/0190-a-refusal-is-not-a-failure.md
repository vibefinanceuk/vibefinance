# 0190 — A refusal is not a failure

**Status: built.** The sign-in screen distinguishes *we would not* from
*we could not*.

---

## A correct password, retyped carefully, twice

`vf-licence` was deployed with an `ALLOWED_ORIGINS` that no longer
existed. `my-environments` returned **500**. The screen said:

> Sign-in failed

So a correct password was retyped, carefully, and the fault was nowhere
near it.

### Decision 0094's rule still stands

Every **authentication** failure gives the same message — no account,
wrong password and nothing to reach must be indistinguishable, or the
screen becomes a way to discover which accounts exist.

**A 500 is not an authentication failure.** It says our service could
not answer, and reporting it as a sign-in failure blames a person for
our outage.

**And it discloses nothing.** A 500 is the same whoever asked, so it
cannot separate a real account from an invented one. The rule is
untouched; what changed is that a failure of ours stopped wearing its
costume.

---

## And "Signed in" above a form that would not move

The other half of the same hour. `start()` returns false when the first
call into the instance fails, and the screen simply **stayed put** —
*"Signed in. You last signed in at …"* above a sign-in form.

A person cannot act on that. It reads as the page being broken rather
than as something being wrong behind it.

It now says so. Which matters because the cause was a `Secure` cookie
**doing exactly its job**: the page had been reached over plain `http`,
so the browser stored the cookie and correctly refused to send it.
Nothing was broken, and nothing said anything.

---

## The words come from D1, as everywhere else

`signin.js` was written with literal strings, and it looks as though it
must be — it runs before anybody is signed in.

**It does not.** `boot.js` loads the strings at line 23 and imports this
module at line 41, so `t()` has always been available here.

The new messages use it. **The older literals do not, and are recorded
here rather than quietly fixed**: *"Sign-in failed"*, *"Could not reach
the sign-in service."* and *"Choose an environment."* are still English
in code, on a screen a German customer sees before anything else.

---

## What is not built

- **Those three literals.** Moving them is a migration and a pass
  through one file, and it belongs to whoever next touches this screen.
- **Nothing tells the operator.** A 500 from `vf-licence` is invisible
  until somebody tries to sign in and says so — decision 0125's
  alerting gap, with a third example.
- **`Always Use HTTPS` is a zone setting, not code.** The cookie was
  right and the deployment let a person reach the page over `http`.
