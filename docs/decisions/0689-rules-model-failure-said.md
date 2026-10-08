# 0689: A failure of the rules model is said, not left on "Working out what you mean"

**Status: live** at `2331ea6`, pushed and deployed 8 October 2026.

## What was asked

Dan, 8 October 2026, writing the Validation rule from 0687's follow-up ("If the
supplier is not known, assign a task to the AP team requiring AP.Validate"):

> When I try to create a new rule … it seems to hang just saying "Working out
> what you mean"

## Why

`POST /rules/compile` called the rules model (`@cf/openai/gpt-oss-120b`) with
nothing to catch a failure. Any Workers AI error (time-out, capacity, model
change) escaped as an uncaught exception, and the Worker answered with an error
page instead of JSON. `compose.js` ran `response.json()` on that page, which
threw, and the screen stayed on "Working out what you mean" indefinitely.

The underlying model error is not yet known: nothing recorded it.

## The fix

- `index.ts`: the compile call is wrapped. A failure answers `502` with
  `{ error }`, the new message `rulesModelFailed` in six languages, carrying the
  model's own error (up to 300 characters). Nothing is written, because rules
  are only inserted after a successful compile.
- `compose.js`: a request that fails outright, or a reply that is not JSON,
  shows "That did not work" (`compose.failed`). A JSON error shows its own text.

## Tests

`test/index.test.ts`: with a model that throws, the route answers 502 JSON
naming the error, and writes no rule. `src/i18n.test.ts` covers the new key in
every locale.

## Next

Dan retries the rule. If the model is still failing, the screen now shows why.
