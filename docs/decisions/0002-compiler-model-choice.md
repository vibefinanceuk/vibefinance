# 0002 — Compiler model: Workers AI, behind a vendor-agnostic interface

Status: settled, 29 August 2026. Implements Blueprint build order step 2
("The compiler: Natural language to compiled_json, validated against
the vocabulary schema, with refusal as a first-class output").

## The interface, not the vendor, is what's load-bearing

`shared/compiler/types.ts` defines `CompilerModel` as one method:
`compile(prompt: string): Promise<string>`. Everything that matters for
correctness — the closed-vocabulary prompt, the refusal boundary, the
defensive JSON extraction, the fact that a rule failing
`validateRule()` becomes a refusal rather than a silent store — lives
in `shared/compiler/` and is provider-independent. Swapping the model
is a one-line change to which `CompilerModel` implementation a Worker
constructs; nothing in `shared/` needs to know.

This matters more than usual here because model quality for this task
(reliable structured output, honest refusal rather than confident
hallucination) is genuinely unknown before real customer sentences are
thrown at it, and the right choice may change once that data exists.

## What's wired up today

`workers/vf-app/src/compiler-model.ts` implements `CompilerModel`
against Cloudflare Workers AI (`env.AI.run()`), using
`@cf/openai/gpt-oss-120b` — confirmed current and confirmed to support
the Chat Completions message format this calls with, against
Cloudflare's own Workers AI changelog (checked 29 August 2026, not
assumed from training data given the training cutoff is January 2026
and the model catalog visibly changes fast).

Reasons for Workers AI specifically, over the alternatives:

- **No new billing relationship.** Already inside the Cloudflare
  account every other piece of this stack lives in — consistent with
  the Blueprint's whole one-person-company argument for staying on one
  platform where possible.
- **No API key to manage as a secret.** `env.AI` is a binding, not a
  credential; one less thing to rotate, leak, or forget to set on a new
  customer's instance.
- **Runs at the edge**, same latency profile as everything else in the
  request path.

## What's not confirmed, and why

This session has no Cloudflare credentials, and Workers AI has no free
local-simulation path the way D1 does — using it, even in local dev,
touches the real account and incurs real usage charges (Cloudflare's
own docs say so explicitly). So:

- The actual response shape from `env.AI.run()` for this model is
  **not confirmed**. `compiler-model.ts`'s `extractResponseText()`
  defensively handles three plausible shapes (the classic Workers AI
  `{ response }`, the OpenAI-style `{ choices: [{ message: { content
  } }] }`, and a nested `{ result: { response } }`) plus a
  stringify-and-continue fallback, specifically so an unanticipated
  shape produces something `parseModelOutput()` can at least attempt
  to parse — which itself treats unparseable input as a refusal, never
  a crash — rather than throwing.
- **Output quality for this specific task is entirely unmeasured.**
  gpt-oss-120b was chosen for infrastructure fit (binding, no new
  billing, edge latency), not because its structured-output reliability
  for a closed-vocabulary compilation task has been benchmarked against
  alternatives. The refusal boundary in `shared/compiler/parse.ts`
  exists precisely so a model that hallucinates plausible-looking but
  invalid vocabulary fails safely rather than fails silently — but a
  model that refuses *too often*, or produces a technically-valid rule
  that doesn't actually mean what the customer said, would only show up
  against real sentences.

## Alternatives considered and not chosen here

| option | why not, for now |
|---|---|
| Anthropic API (Claude) via `fetch` + secret | Real API key to provision and rotate per deployment; no infrastructure blocker, genuinely worth revisiting once accuracy data exists — this is the most likely candidate if gpt-oss-120b's structured-output reliability turns out to be the weak link. |
| OpenAI API via `fetch` + secret | Same shape of trade-off as Anthropic; no particular reason to prefer one external vendor over the other without comparative data. |
| A different Workers AI model (e.g. a DeepSeek or Qwen variant) | Also viable, also unbenchmarked for this task. gpt-oss was picked mainly for explicit, current, documented Chat Completions support — the safest bet against another guess-and-verify cycle like the migration runner's, not a quality judgement. |

## Revisit when

Real customer sentences exist to compile against. At that point,
compare refusal rate and rule-correctness (does the compiled rule
actually mean what the sentence said, not just "does it validate")
across at least gpt-oss-120b and one external-API option before
treating this as settled rather than provisional.
