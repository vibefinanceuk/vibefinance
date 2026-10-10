# 0716: The operator console turns the supplier portal on for a customer

**Status: live** at `9bd3bc4`, pushed and deployed 10 October 2026. vf-admin (`public/index.html`).

## What was asked

Dan, 10 October 2026: *"where do I see the option to turn on the supplier_portal for a
customer?"*

Nowhere: the console's Licence editor kept a licence's features but offered no way to change
them, so `supplier_portal` (0714, design §7.6) could only be set by calling `POST /licences`.

## What changed

The Licence editor (Customers, an environment's *Licence*) has a **Supplier portal** tick,
shown ticked when the licence already has the feature. Saving adds or removes
`supplier_portal` and keeps every other feature as it was. As every licence save does (0640),
a deployed environment is asked to read its licence at once, so the portal routes (0714) and
the supplier page's section (0715) work straight away.

## Tests

vf-admin's suite passes unchanged; the console page itself has no browser tests.
