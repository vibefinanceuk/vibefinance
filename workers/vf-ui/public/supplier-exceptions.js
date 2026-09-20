import { t } from "/strings.js";
import { el } from "/tasks.js";
import { currentOrgId } from "/orgs.js";

/**
 * Exception rate by supplier, and exception type mix — decision 0421,
 * one of the six remaining vertical slices of the Supplier Performance
 * screen (the design's own fourth bullet under "Key metrics").
 *
 * **A table, the same plain-data-table shape `fraud-duplicates.js`
 * already established** — a rate ranked per supplier is a list to
 * scan, not a proportion or a trend. Type mix is a short, secondary
 * line beneath it, read from the route's own top-6 ranking
 * (`workers/vf-app/src/supplier-exceptions-route.ts`) rather than a
 * second chart for a handful of numbers.
 */

let data = { suppliers: [], typeMix: [] };

export async function load() {
  try {
    const org = currentOrgId();
    const query = org ? `?org=${encodeURIComponent(org)}` : "";
    const response = await fetch(`/api/suppliers/exceptions${query}`);
    if (!response.ok) return false;
    data = await response.json();
  } catch {
    return false;
  }
  return true;
}

function percent(n) {
  return `${Math.round(n * 100)}%`;
}

function exceptionRow(supplier) {
  return el("tr", {}, [
    el("td", { text: supplier.supplierName }),
    el("td", { class: "num", text: String(supplier.exceptionCount) }),
    el("td", { class: "num", text: String(supplier.visitCount) }),
    el("td", { class: "num", text: percent(supplier.exceptionRate) }),
  ]);
}

function exceptionsTable() {
  return el("div", { class: "tablewrap" }, [
    el("table", {}, [
      el("thead", {}, [
        el("tr", {}, [
          el("th", { text: t("supplierperformance.supplier") }),
          el("th", { class: "num", text: t("supplierperformance.exceptioncount") }),
          el("th", { class: "num", text: t("supplierperformance.visitcount") }),
          el("th", { class: "num", text: t("supplierperformance.exceptionrate") }),
        ]),
      ]),
      el("tbody", {}, data.suppliers.map(exceptionRow)),
    ]),
  ]);
}

function typeMixLine() {
  if (data.typeMix.length === 0) return null;
  const text = data.typeMix.map((m) => `${m.type} (${m.count})`).join(", ");
  return el("div", { class: "muted" }, [el("span", { text: `${t("supplierperformance.typemix")}: ` }), el("span", { text })]);
}

export function renderCard() {
  return data.suppliers.length === 0
    ? el("div", { class: "panel card-graphic" }, [
        el("div", { class: "cardhead" }, [el("h3", { text: t("supplierperformance.exceptions") })]),
        el("div", { class: "muted", text: t("supplierperformance.noexceptions") }),
      ])
    : el(
        "div",
        { class: "panel card-graphic" },
        [
          el("div", { class: "cardhead" }, [el("h3", { text: t("supplierperformance.exceptions") })]),
          el("div", { class: "sub", text: t("supplierperformance.exceptionssub") }),
          exceptionsTable(),
          typeMixLine(),
        ].filter(Boolean)
      );
}
