# 0736: The network's Documents, as the app's: pages, columns and pills

**Status: built**, awaiting deploy. vf-portal (`portal.js`, `portal.css`, `src/network.ts`),
vf-app (`portal-route.ts`), vf-licence (strings migration 0337).

## What was asked

Dan, 12 October 2026: *"align the Documents screen in the supplier network (vf-portal), with
the document screen in (vf-app) … include pagination into the portal, align colour scheme for
pill boxes … (lighter shade of pillbox). Include an additional field selector"*. Agreed: pages
in the browser, and the status colours proposed.

## What changed

- **Pages, in the browser.** The list is still asked of each customer live and merged newest
  first; each customer now sends its newest **500** (was 200) and says when there are more,
  and the network names those customers under the list (*search or filter to find older
  ones*). Rows per page 25 / 50 (default) / 100 / 200 and « ‹ 1–50 of 312 › », as the app's;
  a search or filter goes back to page 1.
- **Columns**, the app's picker, remembered in this browser: Document No. always; Customer,
  Type, Date, Amount, PO, Company, Messages and Status as before; **Due date, Currency, Buyer
  reference, Received and Credits invoice** to add.
- **Pills as the app's** (0520): a light tint, a fine edge and coloured text, in Day and Night.
  Received and In review neutral, Query raised amber, Returned accent, Approved / Sent for
  payment / Paid green, Rejected light red, Credited an outline. The "2 new" messages pill the
  same way.

## Tests

vf-portal: the words test now also reads the columns' and pager's labels. vf-app portal tests
pass. Checked in Chromium, Day and Night, with 63 documents: 25 a page, 1–25 then 26–50, Due
date and Credits invoice added from the picker.

## To deploy

Migration: vf-licence `0337_network_documents_strings.sql`. Deploy vf-app, vf-licence and
vf-portal.
