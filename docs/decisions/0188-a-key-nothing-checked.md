# 0188 — A key nothing checked

**Status: fixed when found.** Recorded late — see the last section.

---

## The operator interface held the wrong credential

`vf-admin` forwards to `vf-licence`, which has checked **`ADMIN_API_KEY`**
since decision 0006.

**The Worker was written with `ADMIN_KEY`**, which no route anywhere
validates. A forwarded request would have carried a credential nothing
compared against — and been refused, correctly, for a reason nobody
would have guessed from either side.

**Two names one character apart**, and neither end could see the other's.

---

## And two things it was not allowed to become

**Not a new key.** The fleet key already existed, and **two keys for one
door is two keys to rotate** — an operator who rotates one and forgets
the other has a working credential and a broken interface, or worse.

**Not a var.** `wrangler secret put`, because decision 0009 is this
project's own incident: a private signing key sat in a committed
`wrangler.jsonc` as a plain var, and *"the var's own `key_ops` field
read `["sign"]`"* was the only tell.

---

## Recorded seven records late

**This record did not exist until decision 0224's citation check found
it.** Two comments in `vf-admin` cited a number that pointed at nothing,
and had done since the operator interface was built.

Along with decision 0224, that is **nineteen citations across nine files
pointing at two records nobody had written.**

**The convention is that a comment citing a number can be followed.**
It could not, twice, and neither was noticed while writing any of the
records in between — only by a script that compared what was cited
against what exists.

**That script is a one-liner and should run with the tests.** Not built
here, and noted in the handover.
