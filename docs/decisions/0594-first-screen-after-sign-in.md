# 0594: The first screen after signing in is one the person may open

**Status: built and tested locally, not yet pushed or deployed.** `vf-ui`,
and **`vf-licence` migration `0240`** (one string). No other change.

## What was reported

On 2 October Dan signed in with a new user and gave them the
Administrator (Global) role. He then removed the AP permissions from
that role, since an administrator need not see business work:

> *"now my new user just sees a blank screen upon signing in … there
> seems to be a reliance on some other permissions, beyond the
> configuration ones, in order to successfully launch the UI."*

## Why

`start()` opened the Dashboard for anyone holding `AP.Dashboard`, and
otherwise Tasks (0359). Tasks' list needs `AP.TaskView`. Refused, the
screen returned before drawing anything, menu included, so the page
stayed blank. Nothing else depended on AP permissions; the role itself
was fine.

## What was decided

The first screen is now:

1. the **Dashboard**, for `AP.Dashboard`, as before;
2. **Tasks**, only for someone who may see it (`AP.TaskView`). If its
   list cannot be loaded, the screen and menu are still drawn, and say
   so;
3. otherwise **the first screen in the menu the person may open**, in
   menu order. For a configuration-only administrator that is
   **Access**; for someone holding only `Integration.Monitor`, the Route
   monitor;
4. for someone who may open nothing, the frame with *"Nothing here is
   open to you yet. Ask an administrator to give you a role."*, in
   English and German (`0240`).

The menu's order and its permission check now live at the top of
`tasks.js` (`NAV_GROUPS`, `mayOpen`), so the menu and the first screen
read the same list. Changing to another org falls back the same way
(0362).

## Verification

- **`vf-ui`**, `landing.test.ts`, 4 tests: a configuration-only
  administrator lands on Access, and Tasks is never asked for; a
  monitor-only person on the Route monitor; someone with nothing sees the
  frame and the sentence; Tasks for `AP.TaskView`, saying when its list
  failed. All 4 fail against the interface before this change.
- `tasks.test.ts`'s menu test now reads the menu from `frame()` itself,
  since each person lands on a real screen rather than Tasks. Its 9
  unhandled errors from earlier tests' viewer requests are unchanged.
- **Full runs**: `vf-ui` browser 1438, of which 1437 pass (the known
  `typography.test.ts` 10px gap), worker 107 of 107; `vf-licence` 336 of
  336 (with `0240`).
