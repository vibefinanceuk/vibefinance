# 0666: The New supplier pop-out's actions, top right

**Status: built and tested locally, not yet pushed or deployed.** It is
`vf-ui` only, with no migration. Deploy vf-ui.

## What was asked

Dan, 7 October 2026:

> When I click the new supplier button it launches a window to create a
> new supplier manually. The Record supplier, and close buttons need to
> be updated and move to the top right of the box. Please can you make
> these icons the larger, square button display, as seen on other
> screens.

And then:

> Please can you change the text font to the softer colour, which
> highlights upon hover.

## What was built

The *Record a new supplier* pop-out (vf-ui `suppliers.js`):

- **The actions moved to the top.** **Record supplier** and **Close**
  sit in the pop-out's head, beside its title, as the receipt's and a
  purchase order's pop-outs have them. They are no longer a row of
  buttons under the form.
- **They are the large, square action links**, icon above the word:
  - Record supplier uses the `recordsupplier` icon. It is still the
    primary, told apart by its bolder icon. The plain button it
    replaces had no icon;
  - Close uses `close`.
- **They rest in the softer colour and brighten on hover**, as the
  compact actions do (0664). This rule covers this pop-out only
  (`.newsupplierpop`).
- **What Record supplier does is unchanged.** It saves through `POST
  /suppliers` and shows a refusal under the form.
- **Ids**, for the tests: `supplier-record` and `supplier-new-close`.

## Verification

- **`vf-ui`** browser `suppliers.test.ts` gains 1 test:
  - Record supplier and Close are, in that order, the only actions in
    the pop-out's head beside its title;
  - both are large (not compact), each beginning with its icon;
  - Record supplier is the primary;
  - the stylesheet rests the pop-out's primary in the softer colour and
    brightens on hover;
  - Close closes the pop-out.
- **Screenshots** of the pop-out in Day and Night.
- **Full run**: vf-ui browser 1616, of which 1615 pass (the known
  `typography.test.ts` 10px gap). The colour rule was added after it and
  `suppliers.test.ts` was run again: 38 of 38.
