# 0725: The supplier network in the application's own frame

**Status: live**, pushed and deployed 11 October 2026 (`b215396`). vf-portal (pages, `shell.js`,
`portal.js`, `portal.css`; `app.css`, `icons.js` and the logos copied from vf-ui), vf-licence
(strings migration 0329).

## What was asked

Dan, 11 October 2026: *"I'd like to introduce a side menu, the same as the main application,
with Documents, and Create menu items. So the UI look and feel is consistent."* Agreed against
mock-ups drawn in the app's real frame: *"looks good I like it"*.

This is step 1 of three for invoice submission through the network (docs/design/supplier-portal.md):
the frame and Documents here; the Supplier network source (0726) and the Create form in Peppol
BIS Billing 3.0 (0727) follow, and Create joins the menu then.

## What changed

- **The application's stylesheet, tokens and icons**, copied into vf-portal (a Worker serves
  only its own files), with the logos. A test fails if a copy differs from the app's, saying to
  copy it again.
- **Sign in, and accepting an invitation, use the app's sign-in page** (the brand mark, title,
  fields, the full-width button). As in the app, these pages have no top bar.
- **Signed in, the app's frame**, built as `vf-ui`'s `frame()` and `topbar()` build it:
  - the side menu with the logo, a *Supplier network* group with **Documents**, and who is signed
    in with their supplier at the foot; a click on its empty space folds it to icons, remembered
    in the browser, as in the app;
  - the top bar: the screen's title and a subtitle (the supplier and its customers), then the
    network's four controls (0723) in the app's order: Night / Day, Language, Help, Sign out.
- **Documents**, the invoice list (0717), in the app's search panel and table: search, a new
  **customer** filter, the status filter and a count. A row opens the invoice, its messages and
  lines as before, now with the app's Close and Send buttons.
- `topbar.js` (0723) is replaced by `shell.js`. Help is unchanged.

## Tests

vf-portal: every page and shared file is served; the copies of `app.css`, `tokens.css` and
`icons.js` equal the app's; both pages use the app's sign-in layout; the page fills the window
once signed in; the top bar's controls. Checked in Chromium, Day and Night, with an invoice open.

## To deploy

Migration: vf-licence `0329_network_frame_strings.sql`. Deploy vf-licence and vf-portal.
