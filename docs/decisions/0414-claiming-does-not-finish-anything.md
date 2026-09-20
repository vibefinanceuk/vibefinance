# 0414 — Claiming does not finish anything

**Status: built.**

---

## What was asked

Reported live: *"When I open a task that it not claimed, the fields
are locked. There is a claim button in the document viewer. Upon
selecting Claim, I am redirected to the task list. However it would be
preferable to open the same viewer in edit mode, now that I have
claimed the document."*

---

## What was built

**The bug, found.** `runAction(name, task, onClose)` — the function
behind every button `taskActionButtons()` puts in the viewer's own
topbar — called `onClose()` unconditionally after any action the
server accepted, on the reasoning its own comment gave: *"the task is
finished or moved, so the viewer has nothing left to show."* True for
Complete, Return, Discard and Return to supplier — each really does
finish the task or send it elsewhere. **Not true for Claim**, which
only changes who holds the lock. The document is still exactly where
it was, at the same stage, and the person who just claimed it is
looking right at it.

**Why reopening with the same `task` object would not have worked
either.** `canEditAnything` — the flag that decides whether a field
renders as a real input or as read-only text (decision 0288) — is read
from `task.ownership === "mine"` at the moment `openViewer()` is
called, from whatever object it was handed. The claim response itself
carries only `{ taskId, claimedBy, claimedAt }` (`task-route.ts`'s own
`handleClaimTask`); patching that onto the stale `task` already in
`runAction`'s closure would still leave `ownership` reading whatever
it read before the claim.

**`refreshTask(taskId)`, exported from `tasks.js`.** There is no
single-task endpoint, so this re-fetches the list — the one place
`ownership` and `actions` are assembled correctly for a task — and
looks up the one row, the same lookup `openTask()` and `act()` already
make from `lastTasks`. `viewer.js` already imports from `tasks.js`
statically (`el`, `frame`, `topbar`); this is one more name on that
same line, not a new import or a dynamic one.

**`runAction()`'s own ending, given one exception.** On a successful
claim, instead of `onClose()`, it calls `refreshTask()` and reopens the
viewer on whatever comes back:

```js
if (name === "claim") {
  const fresh = await refreshTask(task.id);
  if (fresh) {
    await openViewer(fresh, onClose);
    return;
  }
  // Claimed, but no longer in the list this screen would refresh to
  // — most likely a view filtered to unclaimed work. Nothing fresh
  // to reopen, so this falls through to the same close every other
  // action already takes below.
}
```

**`fresh` can genuinely be missing.** A view filtered to
`ownership=available` drops a task the moment it is claimed — it is no
longer available. `refreshTask()` returning nothing there is not a
bug; the honest answer is the same `onClose()` every other action
already takes, so the code falls through to it rather than adding a
second, different way to leave.

**Release, left alone.** Also lock-only, also not a finish-or-move
action by the same reasoning — but the report was specific to Claim,
its own desired outcome is not obviously Release's too (staying on a
document that just went back to read-only is a different question from
staying on one that just unlocked), and this codebase's own practice
this session has been to fix what was asked and surface the rest
rather than fold it in silently. Release keeps its existing
`onClose()`.

---

## Tests

`workers/vf-ui/test-browser/tasks.test.ts` — two new tests, under "the
claim button inside the document viewer (decision 0414)":

- **Stays open, now unlocked.** Opens an unclaimed task (one editable
  header field configured so the test can tell "unlocked" apart from
  any other reopen), confirms the field renders as read-only text,
  clicks Claim, and confirms the viewer is still open — not bounced to
  the list — with the same field now a real `<input>`. The stubbed
  `/api/tasks` response is swapped between the two fetches, the way the
  server's own answer would actually differ once the claim has taken
  effect, so `refreshTask()`'s re-fetch has something genuinely new to
  find.
- **Falls back to the list when the claim drops the task from view.**
  Same setup, but the second `/api/tasks` stub returns an empty list —
  confirms the viewer closes, the same way every other action already
  does.

Fail-first verified by stashing `tasks.js` and `viewer.js` (not the
tests): both failed, the first on the still-locked field rather than
on being reopened at all — a test bug of its own, caught along the
way, that had used `button.act` (the list's own row-level Claim/Release
button class) to find "Claim" and so had been clicking the list's
hidden row button instead of the viewer's — corrected to a selector
scoped to `#viewer`, which then failed for the right reason: the
viewer closed. Passed once restored.

Full vf-ui suite: **74/74 Worker, 732/732 browser** (730 + 2 new).
`eslint` clean on every changed file. The known, tolerated
unhandled-rejection count for the browser suite (decision 0413: 160)
is unchanged.

---

## What is not built

**No change to Release**, or to any other action's `onClose()` — see
above.

**No change to the list screen's own Claim/Release buttons**
(`tasks.js`'s `act()`). Those already refresh the row they act on by
re-fetching the whole list; the bug reported here was specific to the
viewer's own button, a different code path entirely.
