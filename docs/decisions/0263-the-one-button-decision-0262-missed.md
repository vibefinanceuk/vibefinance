# 0263 — The one button decision 0262 missed

**Status: fixed.** The mover's *Close* button gets its icon.

---

## Reported live

> The close button in the Add a card pop-out has no icon.

Decision 0262 gave *Save changes* the `toolButton` treatment and left
*Close* as a plain `.secondary` button beside it — the one button in
that popout still out of step with everything else the same change was
meant to make consistent.

**Every other Close in the app already used `actionLink("close")`** —
`viewer.js`, both of `suppliers.js`'s. The mover was the only one that
had not, and the icon it needed already existed.

`toolButton("close", t("viewer.supplier.close"), { onclick: ... })` —
the same helper, the same existing string, one line.

vf-ui: 49 Worker, 286 browser.
