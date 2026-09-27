# 0525 — The folded side menu shows short group headings

**Status: pushed (`bf124e6`), deployed, and migration `0187` applied, as confirmed by the operator on 27 September.** It
changes `vf-ui` and `vf-licence`.

## What was asked

> When the side menu is expanded, we have separators, account payable,
> configuration, supplier maintenance. But when the side menu is
> retracted we have none. I wondered if you could include some
> abbreviated separators in when retracted. This would be AP, SM, CONF,
> AR and EXP.

## What was found

The group headings (0346) were hidden outright when the menu is folded
(0311): `.frame.collapsed .navgroup { display: none; }`. The folded
menu was one unbroken column of icons.

Only three groups exist today: Accounts payable, Supplier management
and Configuration. There is no Accounts receivable or Expenses group,
because neither has a screen yet.

## What was decided

- **Each heading carries both forms.** `frame()` in `tasks.js` builds
  `.navgroup` with a `.navgrouplong` span (`nav.group.<group>`, as
  before) and a `.navgroupshort` span (`nav.groupshort.<group>`).
  `app.css` shows one or the other by `.frame.collapsed`, so folding
  needs no re-render.
- **Folded, the short form is centred over the icons.** It uses the same
  size, weight and muted colour as the full heading.
- **Screen readers hear the full name.** The short form is
  `aria-hidden`. When folded, the full name is visually hidden (clipped,
  not `display: none`), so it is still announced.
- **A heading with nothing unlocked beneath it is still left out**
  (0346), and its short form goes with it.
- **`vf-licence` migration `0187`** adds all five short forms the
  operator named, in English and German:

  | Group | English | German |
  |---|---|---|
  | Accounts payable | AP | KRED |
  | Supplier management | SM | LV |
  | Configuration | CONF | KONF |
  | Accounts receivable | AR | DEB |
  | Expenses | EXP | SPES |

  AR and EXP are not shown anywhere yet. They are ready for when those
  groups get their first screen, keyed `accountsreceivable` and
  `expenses`. The German forms are proposals and can be changed with a
  one-line `UPDATE`.

## What was verified

- **`tasks.test.ts` (browser):**
  - Each heading has a short form (AP, SM, CONF), each `aria-hidden`.
  - From the real stylesheet: the short form is hidden by default and
    shown when folded; the full name is visually hidden when folded, not
    `display: none`; the old rule hiding every heading is gone.
  - Without `AP.Supplier`, neither "Supplier management" nor "SM"
    appears.
  - The two new tests and the updated 0346 test **failed** with
    `tasks.js` and `app.css` stashed.
- **A Playwright screenshot** of the real `frame()` and `app.css`, folded,
  in light and dark: AP, SM and CONF sit centred above their icons.

## Verification

- **`vf-ui`**: Worker 75/75. Browser 1212/1213. The one failure is the
  known `typography.test.ts` hardcoded-`10px` gap. `tasks.test.ts`'s 9
  unhandled "no stub for …/collaborators" rejections predate this change
  (same count with it stashed).
- **`vf-licence`**: 320/320, including `string-coverage.test.ts` with
  the three short forms the interface uses.
- **`vf-app`**: untouched.
