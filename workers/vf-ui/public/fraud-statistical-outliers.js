import { t } from "/strings.js";
import { el } from "/tasks.js";
import { currentOrgId } from "/orgs.js";

/**
 * Statistical outliers — decision 0424, the Fraud Prevention tab's
 * fourth real card (`ap-analytics.js`), built the same `load()` /
 * `renderCard()` shape every card on this tab already uses.
 *
 * **A table, not a chart** — the route (`workers/vf-app/src/fraud-
 * statistical-outliers-route.ts`) hands back a worklist, not a series,
 * the same shape `fraud-duplicates.js` and `fraud-unapproved-
 * suppliers.js` already use. Reuses `fraudprevention.invoicenumber` /
 * `.supplier` / `.amount` / `.issuedate`, the same column strings
 * every other Fraud Prevention table already defines.
 *
 * **The deviation column is why this card exists** — a bare amount
 * means nothing without the supplier's own historical range beside it,
 * so each row shows that supplier's historical mean and how many
 * standard deviations the candidate sits from it. The route's own
 * honest `zScore: null` (an "undefined magnitude" — every historical
 * invoice for that supplier carried the identical amount) is shown as
 * a dedicated word, never a fabricated number.
 */

let data = { invoices: [] };

export async function load() {
  try {
    const org = currentOrgId();
    const query = org ? `?org=${encodeURIComponent(org)}` : "";
    const response = await fetch(`/api/fraud/statistical-outliers${query}`);
    if (!response.ok) return false;
    data = await response.json();
  } catch {
    return false;
  }
  return true;
}

/** The same shape every other screen's own `money()` already renders — one currency, two decimal places, never blended with another. */
function money(amount, currency) {
  if (amount === null || amount === undefined) return "—";
  return `${currency ?? ""} ${Number(amount).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`.trim();
}

function deviationLabel(invoice) {
  if (invoice.zScore === null) return t("fraudprevention.undefinedmagnitude");
  return `${invoice.zScore >= 0 ? "+" : ""}${invoice.zScore.toFixed(1)}σ`;
}

function outlierRow(invoice) {
  return el("tr", {}, [
    el("td", { text: invoice.invoiceNumber ?? "—" }),
    el("td", { text: invoice.supplierName ?? "—" }),
    el("td", { class: "num", text: money(invoice.totalWithVat, invoice.currency) }),
    el("td", { text: invoice.issueDate ?? "—" }),
    el("td", { class: "num", text: money(invoice.historicalMean, invoice.currency) }),
    el("td", { class: "num warn", text: deviationLabel(invoice) }),
  ]);
}

function outlierTable() {
  return el("div", { class: "tablewrap" }, [
    el("table", {}, [
      el("thead", {}, [
        el("tr", {}, [
          el("th", { text: t("fraudprevention.invoicenumber") }),
          el("th", { text: t("fraudprevention.supplier") }),
          el("th", { class: "num", text: t("fraudprevention.amount") }),
          el("th", { text: t("fraudprevention.issuedate") }),
          el("th", { class: "num", text: t("fraudprevention.historicalmean") }),
          el("th", { class: "num", text: t("fraudprevention.deviation") }),
        ]),
      ]),
      el("tbody", {}, data.invoices.map(outlierRow)),
    ]),
  ]);
}

/** The card itself, built from whatever `load()` last fetched. Callers own the topbar, frame and tab shell around it. */
export function renderCard() {
  return data.invoices.length === 0
    ? el("div", { class: "panel card-graphic" }, [
        el("div", { class: "cardhead" }, [el("h3", { text: t("fraudprevention.statisticaloutliers") })]),
        el("div", { class: "muted", text: t("fraudprevention.nostatisticaloutliers") }),
      ])
    : el("div", { class: "panel card-graphic" }, [
        el("div", { class: "cardhead" }, [el("h3", { text: t("fraudprevention.statisticaloutliers") })]),
        el("div", { class: "sub", text: t("fraudprevention.statisticaloutlierssub") }),
        outlierTable(),
      ]);
}
