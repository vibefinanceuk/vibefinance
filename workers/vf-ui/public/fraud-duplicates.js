import { t } from "/strings.js";
import { el } from "/tasks.js";
import { currentOrgId } from "/orgs.js";
import { TOP, invoiceRow, listHead, listCard } from "/fraud-list.js";

/**
 * Potential duplicate invoices — decision 0420, the first real card in
 * the Fraud Prevention tab (`ap-analytics.js`), built the same way
 * every other Financial/Operational Performance metric has been:
 * `load()` and `renderCard()`, no `open()` of its own.
 *
 * **A table, not a chart** — the design's own suggested visualization
 * for this metric is plain "Table, sorted by confidence," and the
 * route (`workers/vf-app/src/fraud-duplicates-route.ts`) already hands
 * back rows in that order. Reuses `.tablewrap`/`table`, the same
 * plain-data-table shape `purchase-orders.js`, `documents.js`, and
 * `suppliers.js` each already build.
 *
 * **Confidence is shown as a percentage**, `duplicate_confidence`
 * being a 0–1 score (decision 0028's own weighted match on invoice
 * number, total, and issue date) — read directly, never recomputed
 * here.
 */

let data = { invoices: [] };

export async function load() {
  try {
    const org = currentOrgId();
    const query = org ? `?org=${encodeURIComponent(org)}` : "";
    const response = await fetch(`/api/fraud/duplicates${query}`);
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

function confidencePercent(confidence) {
  return `${Math.round(confidence * 100)}%`;
}

function duplicateRow(invoice) {
  return invoiceRow(invoice.id, [
    el("td", { text: invoice.invoiceNumber ?? "—" }),
    el("td", { text: invoice.supplierName ?? invoice.supplierVatId ?? "—" }),
    el("td", { class: "num", text: money(invoice.totalWithVat, invoice.currency) }),
    el("td", { text: invoice.issueDate ?? "—" }),
    el("td", { class: "num", text: confidencePercent(invoice.duplicateConfidence) }),
  ]);
}

function duplicatesTable() {
  return el("div", { class: "tablewrap" }, [
    el("table", {}, [
      el("thead", {}, [
        el("tr", {}, [
          el("th", { text: t("fraudprevention.invoicenumber") }),
          el("th", { text: t("fraudprevention.supplier") }),
          el("th", { class: "num", text: t("fraudprevention.amount") }),
          el("th", { text: t("fraudprevention.issuedate") }),
          el("th", { class: "num", text: t("fraudprevention.confidence") }),
        ]),
      ]),
      el("tbody", {}, data.invoices.slice(0, TOP).map(duplicateRow)),
    ]),
  ]);
}

/** The card itself, built from whatever `load()` last fetched. Callers own the topbar, frame and tab shell around it. */
/** The tile's count — decision 0618. */
export function summary() {
  return { key: "duplicates", label: t("fraudprevention.duplicates"), count: data.invoices.length };
}

/**
 * **Show all opens Documents' own duplicates list** — decision 0618:
 * the same `POSSIBLE_DUPLICATE_THRESHOLD` this card reads (0463), so the
 * two always agree.
 */
async function showAll() {
  const { openDocumentsFiltered } = await import("/documents.js");
  openDocumentsFiltered("duplicates");
}

export function renderCard() {
  const total = data.invoices.length;
  return listCard("duplicates", [
    listHead(t("fraudprevention.duplicates"), total, showAll),
    total === 0 ? el("div", { class: "muted", text: t("fraudprevention.noduplicates") }) : el("div", { class: "sub", text: t("fraudprevention.duplicatessub") }),
    total === 0 ? null : duplicatesTable(),
  ]);
}
