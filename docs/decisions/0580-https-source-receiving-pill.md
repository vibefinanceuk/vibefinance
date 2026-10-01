# 0580: An HTTPS source's card says whether it receives

**Status: built and tested locally, not yet pushed or deployed.** It
touches `vf-app`, `vf-ui` and `vf-licence`, and needs **`vf-licence`
migration `0228`**. There is no `vf-app` migration.

## What was asked

On 1 October, with HTTPS in (0578) and shared mappings (0579) live and
tested, Dan sent a screenshot of Process routes:

> *"Should my HTTPS source (middle card) show a Receiving pillbox, like
> the other email source (bottom card)?"*

It should. An email source's card says Receiving once its address is
routed, or No address yet before. An HTTPS source's card said nothing
about whether it could receive at all.

## What was decided

An HTTPS source receives once it has a live key, so its card follows
the same rule:

- **Receiving** (green, the email source's own `routing.active`) when it
  has at least one key that is not revoked;
- **No keys yet** (amber, `processroutes.nokeys`, new in `vf-licence`
  `0228`) when it has none: made none yet, or every key revoked.

`GET /process-routes` gives each source `liveKeys`, a count of its
unrevoked `source_keys`. The panel's Status shows the same pill. A retired
source, or one whose route is not live, says so first, as before.

AP upload (File import) is unchanged: it has nothing to set up, so it
shows no state of its own beyond failures and the week's count.

## Verification

- **`vf-app`**, `https-in.test.ts`: `liveKeys` is 0, then 2 after two
  keys, then 1 after one is revoked. With `routes.test.ts` and
  `erp-destination.test.ts`: 27 of 27.
- **`vf-ui`**, `routes.test.ts`, 1 new test with the real strings: No keys
  yet (warn) with none, Receiving (ok) with one. It fails against the
  interface before this change. 16 of 16.
- **`vf-licence`**: migrations replay 228.
- **Full runs**: `vf-app` 3358 tests, of which 3355 pass: the two known
  failures (0511), and an `index.test.ts` router test that timed out at 5
  seconds beside other suites; alone, `index.test.ts` passes 232 of 232.
  `vf-ui` browser 1399 of 1400 (the known `typography.test.ts` 10px gap).
  `vf-licence` 322 of 322.
