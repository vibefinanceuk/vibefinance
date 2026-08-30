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

## What's confirmed live, as of 29 August 2026

Two real requests against the deployed `vf-app`, not a test double:

- `"route anything over 5000 euros to finance"` — correctly **refused**,
  reason: the sentence doesn't specify which amount field (total,
  total with VAT, net, amount due) to compare. This is the refusal
  boundary working exactly as designed on its first real request, not
  a failure — the sentence genuinely is ambiguous, and approximating it
  by guessing a field would have been the liability the whole design
  exists to avoid.
- `"route anything where the total amount with VAT is over 5000 euros
  to finance"` — correctly **compiled** to `BT-112 greater_than 5000`
  with a `route_to` action, and persisted to `rule_versions` with
  `approved_by` correctly `null` (queried directly from D1 afterward,
  not inferred from the HTTP response).

This also confirmed, as a side effect, that `wrangler d1 execute
--json`'s response shape
(`[{"results": [...], "success": true, "meta": {...}}]`) — assumed by
`migrations/apply_migrations.py`'s `parse_wrangler_json` — is correct.

## What's still not confirmed

One successful example is evidence the wiring works, not a quality
benchmark. Still open:

- **The real `env.AI.run()` response shape** turned out to need no
  defensive fallback for this one request — the classic `{ response }`
  shape was what came back — but that's one data point, not a
  guarantee it's the only shape this model family ever returns.
- **Output quality for this specific task is still effectively
  unmeasured.** One correct compile and one correct refusal is
  promising, not a benchmark. Whether gpt-oss-120b reliably picks the
  *right* field when a sentence is under-specified in a less obvious
  way than "which amount", or reliably refuses rather than
  hallucinates on genuinely out-of-vocabulary requests, needs volume —
  real customer sentences, or at minimum a deliberate adversarial test
  set — not two hand-picked examples.

## A real reasoning-model gap, found live: `max_tokens`

`generateExamples` (docs/decisions/0007-rule-approval.md) hit a real
production failure: `finish_reason: "length"`, `content: null`. The
raw response showed the model's `reasoning`/`reasoning_content` fields
full of genuine chain-of-thought about the task — it never got past
that to actually write the JSON answer.

Confirmed against Cloudflare's own changelog, not guessed: *"We fixed
a bug where max_tokens defaults were not properly being respected —
max_tokens now correctly defaults to 256."* `gpt-oss-120b` is a
reasoning model (OpenAI's own docs describe it as such); 256 tokens is
nowhere near enough for both an internal reasoning trace and a
multi-example structured answer. `compiler-model.ts` never set
`max_tokens` at all — an oversight that happened to not matter for the
main compile call (a short answer, 3–4 fields) but broke immediately
on `examples.ts`'s longer prompt and longer expected output.

Fixed by explicitly setting `max_tokens: 4096`. Cloudflare's own blog
also documents a `reasoning: {"effort": "..."}` parameter that could
reduce reasoning-token consumption directly, but only shown against
their newer `/ai/v1/responses` endpoint, not the `env.AI.run()` +
`messages` shape this code actually uses — not confirmed compatible
with the call shape in use, so not added speculatively. `max_tokens`
alone is the fix actually shipped, because it's the one parameter with
direct, confirmed evidence behind it.

## Alternatives considered and not chosen here

| option | why not, for now |
|---|---|
| Anthropic API (Claude) via `fetch` + secret | Real API key to provision and rotate per deployment; no infrastructure blocker, genuinely worth revisiting once accuracy data exists — this is the most likely candidate if gpt-oss-120b's structured-output reliability turns out to be the weak link. |
| OpenAI API via `fetch` + secret | Same shape of trade-off as Anthropic; no particular reason to prefer one external vendor over the other without comparative data. |
| A different Workers AI model (e.g. a DeepSeek or Qwen variant) | Also viable, also unbenchmarked for this task. gpt-oss was picked mainly for explicit, current, documented Chat Completions support — the safest bet against another guess-and-verify cycle like the migration runner's, not a quality judgement. |

## Revisit when

Enough real customer sentences exist to measure refusal rate and
rule-correctness (does the compiled rule actually mean what the
sentence said, not just "does it validate") in volume, across at least
gpt-oss-120b and one external-API option, before treating this as
settled rather than provisional. Two hand-run examples confirm the
pipe works; they don't answer whether this is the right model.

