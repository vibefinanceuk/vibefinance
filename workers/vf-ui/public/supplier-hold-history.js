import { t } from "/strings.js";
import { el } from "/tasks.js";
import { currentOrgId } from "/orgs.js";

/**
 * Hold history — decision 0427, the last of Supplier Performance's
 * eight key metrics.
 *
 * **A table, one row per hold period, not per supplier** — the design
 * gives no suggested visualization for this metric, unlike every other
 * bullet on this screen. `fraud-duplicates.js` and `supplier-payment-
 * terms.js`'s own plain-table shape fits a metric that carries more
 * than one fact per row (when, how long, why) and does not reduce
 * honestly to a single ranked number.
 */

let data = { periods: [] };

export async function load() {
  try {
    const org = currentOrgId();
    const query = org ? `?org=${encodeURIComponent(org)}` : "";
    const response = await fetch(`/api/suppliers/hold-history${query}`);
    if (!response.ok) return false;
    data = await response.json();
  } catch {
    return false;
  }
  return true;
}

function dateOnly(iso) {
  return iso ? iso.slice(0, 10) : "—";
}

function days(n) {
  const rounded = Math.round(n * 10) / 10;
  return t("supplierperformance.dayscount").replace("{n}", String(rounded));
}

function holdRow(period) {
  return el("tr", {}, [
    el("td", { text: period.supplierName }),
    el("td", { text: dateOnly(period.startedAt) }),
    el("td", { text: period.endedAt ? dateOnly(period.endedAt) : t("supplierperformance.holdongoing") }),
    el("td", { class: "num", text: days(period.days) }),
    el("td", { text: period.reason ?? "—" }),
  ]);
}

function holdTable() {
  return el("div", { class: "tablewrap" }, [
    el("table", {}, [
      el("thead", {}, [
        el("tr", {}, [
          el("th", { text: t("supplierperformance.supplier") }),
          el("th", { text: t("supplierperformance.holdstarted") }),
          el("th", { text: t("supplierperformance.holdended") }),
          el("th", { class: "num", text: t("supplierperformance.holdduration") }),
          el("th", { text: t("supplierperformance.holdreason") }),
        ]),
      ]),
      el("tbody", {}, data.periods.map(holdRow)),
    ]),
  ]);
}

/** The card itself, built from whatever `load()` last fetched. Callers own the topbar, frame and tab shell around it. */
export function renderCard() {
  return data.periods.length === 0
    ? el("div", { class: "panel card-graphic" }, [
        el("div", { class: "cardhead" }, [el("h3", { text: t("supplierperformance.holdhistory") })]),
        el("div", { class: "muted", text: t("supplierperformance.noholdhistory") }),
      ])
    : el("div", { class: "panel card-graphic" }, [
        el("div", { class: "cardhead" }, [el("h3", { text: t("supplierperformance.holdhistory") })]),
        el("div", { class: "sub", text: t("supplierperformance.holdhistorysub") }),
        holdTable(),
      ]);
}
