# 0072 — What happens after keying

**Status: built.** A guard against a real hazard, and a report answering
the question keying leaves open.

---

## The question

Decision 0071 closed by noting that nothing re-evaluates after keying:
the facts change, and no rule runs until something calls
`visitCurrentStage`.

The obvious fix — have keying re-evaluate — turned out to be a **hazard
rather than a missing feature**.

---

## Re-visiting a blocked stage duplicated its tasks

Blocking on tasks is the engine's own stated intent, in its own comment:

> the instance stays here until they're all completed, never advances on
> its own

But the only guard was on instance **status**, and a blocked instance is
still `in_progress`. So a second visit re-evaluated the same rules
against the same stage and spawned a second set of tasks identical to
the ones already waiting.

Nobody had hit it because nothing called `visitCurrentStage` twice on the
same stage. Keying would have been the first thing to.

`visitCurrentStage` now returns 409 when the current stage has open
tasks, naming the count and saying what to do instead. Watched to fail:
disabling the condition breaks the guard test *and* the one asserting
one task exists rather than two — the consequence, not just the refusal.

A third test confirms the guard does not strand anything: completing the
task allows a visit again, exactly as before.

---

## Keying reports validation, and does not store it

The operator's actual question is *"is it valid now"*, and after keying
nothing else answers it.

Validation is safe to run here precisely because it is a **pure
function** (decision 0044): arithmetic and presence over the facts in
hand, no writes and no side effects. Rule evaluation is neither, which is
the whole distinction this decision rests on.

```json
"validation": { "passed": true, "checked": [...], "failures": [], "advisory": true }
```

**`advisory: true` is not decoration.** The verdict is not recorded
against the process instance, and it uses the platform tolerance rather
than the channel's — keying knows the invoice, not the channel it
arrived through. The authoritative verdict is still written at the next
stage visit, under that channel's own settings (decision 0057). Saying so
in the payload is cheaper than letting somebody assume otherwise.

---

## What this leaves

**Keying still does not advance anything.** An operator keys, sees the
document would now validate, and the instance sits where it was until
its task is completed. That is correct — the task is the thing waiting on
them — but it means "key" and "finish the task" are two actions where a
person might expect one.

Whether completing a task should carry the keyed facts into a
re-evaluation is decision 0064's territory: `onTaskCompleted` advances by
sequence without evaluating rules, so it has nowhere to put them. The
two findings meet here.

---

## The pattern, again

The guard was found by asking whether a new feature could reuse an
existing path, and discovering the existing path had an assumption
nobody had tested — that it would only ever be called once per stage.

Same shape as the settings that reached nothing and the parser that
mapped half the vocabulary: **the code was correct for the caller it
had, and wrong for the caller it was about to get.**
