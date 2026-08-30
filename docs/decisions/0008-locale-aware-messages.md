# 0008 — Locale-aware messages: a small, real feature instead of a speculative one

Status: settled, 30 August 2026. Blueprint build order step 6,
"Translations & branding" — narrowed deliberately, not built at the
scope the name suggests.

## Why this is smaller than "translations & branding" sounds

Before writing any code, the actual customer-facing surface area was
inventoried directly from the codebase rather than assumed. The
finding: almost every string in `vf-app` and `vf-licence` is
operator/deployment-facing — messages like `"LICENCE_SIGNING_PUBLIC_KEY,
LICENCE_SERVICE, CUSTOMER_ID and VF_LICENCE_API_KEY must all be
configured"` reference internal env var names directly, meant for
whoever runs `wrangler deploy`, never for an end customer. Translating
those would be pointless.

There is also currently **no rendered UI anywhere in this product** —
every interaction is a raw JSON API response via `curl`. "Branding"
specifically has almost nothing to attach to: the only per-customer
field that exists is `customers.name` in `vf-licence`, and nothing
renders it back to anyone. Building a branding mechanism now, with no
consumer, would be exactly the kind of speculative infrastructure this
project has consistently avoided elsewhere.

Given that, this bundle scopes to the one piece that's genuinely real
today: **the small, fixed set of static validation and status messages
an author or integration actually reads** when compiling, confirming,
and activating rules, or when a licence blocks processing.

## What's deliberately left untranslated, and why

- **Operator/deployment config errors** (`"AI binding not configured"`,
  `"CONTROL_DB binding not configured"`, everything naming an env var)
  — these are read by whoever is deploying the Worker, not a customer.
- **The compiler's own refusal reasons** (both for a rule itself and
  for its worked examples) — these come from the model's own output,
  not a fixed string in this codebase. "Translating" them is a
  different kind of problem — prompting the model to respond in a
  different language — not a lookup-table swap, and genuinely out of
  scope for this bundle (a separate option the person considered and
  didn't choose).
- **`RuleValidationError`'s own message** (`"unknown field..."`,
  `"unknown operator..."` etc.) — this lives in
  `shared/interpreter/evaluate.ts`, genuinely shared code both Workers
  depend on, not something `handleEvaluate` or `compile-route.ts` owns.
  Only the wrapper message ("rule X rejected by the closed vocabulary")
  is translated; the `detail` field carrying the underlying error stays
  in English. Stated here rather than silently glossed over.
- **`vf-licence`'s messages entirely** — its callers are the operator
  (admin auth) or a customer's own `vf-app` instance calling machine to
  machine, never a human at a customer company reading text directly.
- **An operator-authored licence `statusReason`** (the free-text reason
  an operator sets when blocking a customer for non-payment, say) — not
  one of this file's fixed message keys, so there's no catalog entry to
  look up. Passed through as-is regardless of locale.

## Design: one deployment, one language

`LOCALE` is a `wrangler.jsonc` var, following the exact same
"one Worker per customer, configured via vars" pattern already used
for `CUSTOMER_ID` and `LICENCE_SIGNING_PUBLIC_KEY` — not a
per-request `Accept-Language` header. A customer's whole integration
operates in one language; nothing about this backend API is
browser-facing or needs per-request negotiation. `resolveLocale()`
falls back to English for anything unset or unrecognised, never an
error — a missing or misconfigured `LOCALE` degrades gracefully.

## Translations were written carefully, not machine-generated blindly

Each of the 16 message keys was translated by hand into German,
French, Spanish, Italian, and Dutch, keeping API field names
(`ruleSetId`, `facts`, `invoiceId`, `confirmedBy`, `activatedBy`)
untranslated in every language — they're literal JSON keys a client's
integration code checks against, not prose, the same convention most
localized APIs follow.

A completeness test checks every locale has a real, non-empty
translation for every key, and that it's genuinely distinct from the
English text — catching both a missing translation and an accidentally
copy-pasted English placeholder. Confirmed to actually work: a
deliberately-reintroduced English placeholder for one key/locale pair
was caught by name (`alreadyActivated/de was identical to English`),
not just a generic failure.

## Testing the routing itself, not just the catalog

`SELF.fetch` can't inject a custom `LOCALE` per request — it uses the
ambient `wrangler.test.jsonc` config, which declares none. Rather than
add `LOCALE` there (which would make every existing English-language
test assertion wrong), the same pattern already established for
`scheduled()`'s own tests was reused: call the exported Worker's
`fetch()` handler directly with a custom `env` object, spreading the
real ambient `testEnv` for D1 access. Confirmed the wiring is real, not
coincidental, by deliberately breaking the locale hand-off inside
`blockedResponse()` and watching the specific routing test fail.

## What's still open

- No branding mechanism at all — deliberately not built, per the scope
  decision above. Revisit once a real customer-facing UI exists to
  actually consume it.
- The compiler's own natural-language output (refusal reasons, worked
  examples' realism) is not locale-aware. A genuinely different
  problem — prompting the model in the customer's language — left for
  a future bundle if it turns out to matter.
- Only 5 non-English languages. A reasonable starting set for an EU
  e-invoicing product under EN 16931, not an exhaustive one; adding a
  language later means one more entry per key in `MESSAGES`, and the
  completeness test would immediately flag anything missed.
