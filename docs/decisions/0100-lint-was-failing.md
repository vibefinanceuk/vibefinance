# 0100 — The lint check nobody was reading

**Status: fixed.** Three real violations, hidden by how the check was
run.

---

## What happened

Every verification in this project ran:

```
npm run lint 2>&1 | tail -1
```

**A failing ESLint run ends with a blank line.** So did a passing one.
`tail -1` showed nothing either way, and nothing was reported as clean
that was not.

The exit code was 1. Nobody looked at it.

---

## What it was hiding

Three `no-restricted-properties` violations in `workers/vf-app/src/index.ts`
— all `env.DOCUMENTS` read directly, when decision 0001's rule requires
going through `resolveTenant()`.

Introduced by decision 0073 (signed document URLs) and present through
every commit since, each one reported as passing lint.

**The rule was right and there was nothing to argue about.**
`resolveTenant()` already returns `documents`; the code reached past it
for no reason at all. The fix was three lines.

That is what makes this worth a record. The check worked, the rule was
correct, the alternative already existed — and the failure was invisible
because of how the output was read.

---

## The pattern, for the fourth time today

Decision 0097 recorded it as *a guard is only a guard where it runs*.
This is the same shape once more:

| | The mechanism | Where it pointed |
| --- | --- | --- |
| 0084 | A migration test | Existing rows, not new ones |
| 0093 | A standing invariant | Detection, not prevention |
| 0097 | `isAdminRoute` | Routes it never reached |
| **0100** | **A lint rule** | **Output nobody read** |

Four real mechanisms, four times pointed somewhere that did not answer
the question being asked of them.

**The generalisation is about verification rather than code:** a check
reports something, and reading that report is a separate act from
running it. `| tail -1` is a way of running a check while declining to
read it.

---

## The fix

Three sites now use `resolveTenant()`'s `documents`, as they should
always have.

And **lint is checked by exit code**, not by its last line —
`npm run lint; echo $?`. Obvious in retrospect and it was wrong for
several decisions.

---

## Also here

`workers/vf-ui/public/**` is browser code, so `window`, `document` and
`fetch` are real globals. Given its own ESLint block rather than
widening the Worker configuration, **so a Worker file cannot quietly
start using a browser global and pass.**
