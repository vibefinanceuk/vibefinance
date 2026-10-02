# 0610: A connector's optional settings only where it uses them

**Status: built and tested locally, not yet pushed or deployed.** It
touches `shared`, `vf-app`, `vf-ui` and `vf-licence`, and needs
**`vf-licence` migration `0254`** (strings). Deploy vf-app and vf-ui.

## What was asked

Dan, 2 October 2026, on the Business Central Destination (0609): *"There
are a couple of sentences in the field I need clarity on … The Dynamics
connector should not mention other ERPs. Is this a mistake?"*, and then
*"The Sage Intacct connector also mentions 'SAP's OData services need
it…'"*.

It was: the HTTPS out settings showed every Destination the two optional
settings added for SAP (0606, *Fetch a CSRF token first*) and Sage Intacct
(0607, the OAuth *User name*), and their hints named those ERPs.

## What was decided

- **A connector names the optional settings it uses**
  (`settings.ask`): SAP S/4HANA Cloud `csrf`; Sage Intacct
  `oauthUsername`; Oracle Fusion Payables and Business Central none. The
  Destination's panel shows only those. The generic HTTPS out, a partner's
  connector, or a Destination with none, shows both; a setting already on
  stays shown, so nothing set is hidden.
- **The hints name no ERP:**
  - *"Some services refuse a change without a security token: before each
    invoice, one is fetched from the service with its session cookies, and
    sent with the invoice."*
  - *"Only where the token address asks for one, in the form it gives
    (such as user@company)."*

  And in German.

## Verification

- **`vf-ui`**, `routes.test.ts`, 1 new test: Business Central shows
  neither setting and names no other ERP; Sage Intacct the user name
  only; SAP the CSRF setting only, with the new wording. It fails against
  the interface before this change. Browser 1456, of which 1455 pass (the
  known `typography.test.ts` 10px gap).
- **`vf-app`**: the four ERP connector tests and the library, HTTPS out
  and partner library tests, 44 of 44, with each connector's `asks`. The
  change to `vf-app` is one field of the connector's view; the full run
  was not repeated (0609's: 3446, of which 3443 pass).
- **`vf-licence`** 358 of 358; **`shared`** 436, of which 432 pass and 1
  is skipped (the three known failures). **Migrations** replay:
  `vf-licence` 254, asserting neither hint names SAP or Intacct.
