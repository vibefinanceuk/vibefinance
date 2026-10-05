# 0639: The operator console looks and behaves as the main site

**Status: built and checked locally, not yet pushed or deployed.** It
touches `vf-admin` only (its page, fonts and images). Deploy vf-admin.

## What was asked

Dan, with screenshots of the console:

1. *"alignment of table columns, see example, where, License, are
   offset"*;
2. *"update the Prepared actions check-box which appears over sized"*;
3. *"update page fonts to align with the rest of the site. The side menu
   fonts also seem different"*;
4. *"use pill-boxes where appropriate for State, Decision fields"*;
5. *"a retractable site menu, like the main site"*;
6. *"night / day and Sign-out button at the top right"*.

## What was built (`workers/vf-admin/public`)

1. **Columns that line up across customers.**
   - Each customer's environments were their own table, sized to its own
     words, so *Where* and *Licence* moved from one customer to the next.
   - The customers' tables now share one set of columns (`fleettable`, a
     fixed layout).
   - *People* sits over its number: numeric headings are right-aligned,
     everywhere.
2. **The tick box at its own size.**
   - The field style (30px high, padded) also applied to tick boxes.
   - They are now 16px, coloured with the accent.
   - *Prepared actions* sits beside its box on the field line.
3. **The main site's typeface.**
   - The console named Calibri and Carlito but shipped neither, so a Mac
     drew the system font.
   - It now carries Carlito (vf-ui's own files, in `public/fonts`).
     Titles are bold as on the main site.
   - The side menu's rows, icons and spacing match the main site's
     (14px text, 22px icons, the same gaps).
4. **Pills for states and decisions**, filled as on the main site (`pill`
   with ok, warn, bad or quiet):
   - a licence's state;
   - *not yet deployed* and *no licence*;
   - sign-up decisions, and *approved, not provisioned yet*;
   - invitations;
   - a person's access;
   - a connector's state;
   - the admin log's outcomes.
5. **A menu that folds.**
   - *Fold the menu* at the menu's foot leaves only the icons and the
     small mark.
   - Each item's name shows as a tooltip, and the choice is kept in this
     browser (`vf-admin-mood`, `vf-admin-nav`).
   - On a narrow screen the menu is a row, as before.
6. **Night or Day, and Sign out, at the top right**, drawn as the main
   site's (an icon over a word).
   - **Day is the main site's day palette**, which the console never had.
   - Night is as before and follows the machine unless chosen.
   - The mood is set before the page draws, so it never flashes the wrong
     one.
   - The logo is the light mark at night and the dark one by day.
   - **Sign out** is Cloudflare Access's own (`/cdn-cgi/access/logout`).
     Access, not the console, holds the session.

The console keeps its own words and copied colours (0140): only the shape
and palette now match.

## Verification

- **`vf-admin`** 14 of 14.
- **Drawn in a browser**, with stub data:
  - Customers at Night with a licence open: columns aligned, the tick box
    small, pills;
  - Customers by Day with the menu folded;
  - Sign-up requests with decision pills.
