import { t } from "/strings.js";
import { el } from "/tasks.js";
import { currentOrgId } from "/orgs.js";

/**
 * Payment terms held vs. negotiated, and on-time-payment rate by
 * supplier — decision 0421, one of the six remaining vertical slices
 * of the Supplier Performance screen (the design's own sixth bullet
 * under "Key metrics").
 *
 * **A table**, the same shape `fraud-duplicates.js` and
 * `supplier-exceptions.js` already use — four comparable numbers per
 * supplier (negotiated days, held days, on-time rate, invoice count),
 * not a proportion or a single trend.
 *
 * **On-time rate reads "—" when it is `null`**, not "0%" — the route
 * (`workers/vf-app/src/supplier-payment-terms-route.ts`) returns
 * `null` specifically for a supplier whose invoices have not yet
 * reached payment-eligible at all, and that is a different fact from
 * "always late."
 */

let data = { suppliers: [] };

export async function load() {
  try {
    const org = currentOrgId();
    const query = org ? `?org=${encodeURIComponent(org)}` : "";
    const response = await fetch(`/api/suppliers/payment-terms${query}`);
    if (!response.ok) return false;
    data = await response.json();
  } catch {
    return false;
  }
  return true;
}

function days(n) {
  const rounded = Math.round(n * 10) / 10;
  return t("supplierperformance.dayscount").replace("{n}", String(rounded));
}

function rate(n) {
  return n === null ? "—" : `${Math.round(n * 100)}%`;
}

function termsRow(supplier) {
  return el("tr", {}, [
    el("td", { text: supplier.supplierName }),
    el("td", { class: "num", text: days(supplier.negotiatedDays) }),
    el("td", { class: "num", text: days(supplier.averageHeldDays) }),
    el("td", { class: "num", text: rate(supplier.onTimeRate) }),
  ]);
}

function termsTable() {
  return el("div", { class: "tablewrap" }, [
    el("table", {}, [
      el("thead", {}, [
        el("tr", {}, [
          el("th", { text: t("supplierperformance.supplier") }),
          el("th", { class: "num", text: t("supplierperformance.negotiatedterms") }),
          el("th", { class: "num", text: t("supplierperformance.heldterms") }),
          el("th", { class: "num", text: t("supplierperformance.ontimerate") }),
        ]),
      ]),
      el("tbody", {}, data.suppliers.map(termsRow)),
    ]),
  ]);
}

export function renderCard() {
  return data.suppliers.length === 0
    ? el("div", { class: "panel card-graphic" }, [
        el("div", { class: "cardhead" }, [el("h3", { text: t("supplierperformance.paymentterms") })]),
        el("div", { class: "muted", text: t("supplierperformance.nopaymentterms") }),
      ])
    : el("div", { class: "panel card-graphic" }, [
        el("div", { class: "cardhead" }, [el("h3", { text: t("supplierperformance.paymentterms") })]),
        el("div", { class: "sub", text: t("supplierperformance.paymenttermssub") }),
        termsTable(),
      ]);
}
