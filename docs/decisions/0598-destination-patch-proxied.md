# 0598: Retire, rename, pause and resume reach vf-app

**Status: built and tested locally, not yet pushed or deployed.** `vf-ui`
only. No migrations.

## What was reported

Dan, 2 October 2026, after deploying 0597: *"The Retire on Destination
routes returns 'not found'"*.

## Why

`PATCH /route-instances/:id` was never on `vf-ui`'s list of paths it
passes to `vf-app` (`PROXIED_TO_INSTANCE`), so the interface's own
Worker answered `not found` before `vf-app` saw it. The route has been
called since 0558 (pause and resume a Destination); 0597 added rename and
retire to it. All four were refused in the same way. `vf-app`'s tests
called it directly, and the browser tests stub `fetch`, so none of them
passed through the proxy's list.

## What was decided

- `/^\/route-instances\/[^/]+$/` is on the list. `vf-app` still decides
  who may do what (`Admin.Configure`).
- The Worker's own test now names `/route-instances/dest-1` and
  `/route-instances/erp-ap` among the paths it must pass on; it fails
  against the list before this change.
- Every `/api/…` path the interface's scripts call was checked against
  the list. This was the only one missing.

## Verification

- `vf-ui` worker: 111 of 111; 2 fail against the list before this change.
