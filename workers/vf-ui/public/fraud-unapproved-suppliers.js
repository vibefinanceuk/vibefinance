import { t } from "/strings.js";
import { el } from "/tasks.js";
import { currentOrgId } from "/orgs.js";
import { TOP, invoiceRow, listHead, listCard, openTheseInvoices, supplierCell } from "/fraud-list.js";

/**
 * Unapproved-supplier invoices — decision 0422, the Fraud Prevention
 * tab's second real card (`ap-analytics.js`), built the same way
 * decision 0420's duplicates card already was: `load()` and
 * `renderCard()`, no `open()` of its own.
 *
 * **A table, not a chart** — the same shape `fraud-duplicates.js`
 * already uses, since the route (`workers/vf-app/src/fraud-
 * unapproved-suppliers-route.ts`) hands back rows, not a series.
 * Reuses `fraudprevention.invoicenumber` / `.supplier` / `.amount` /
 * `.issuedate`, the exact same column strings the duplicates card
 * already defines — same tab, same table shape, no reason to name the
 * same column twice.
 *
 * **The reason column is why this card exists** — "not on file" and
 * "on hold" are two different risks, and the route already tells them
 * apart (`reason`); this card shows that word plainly rather than
 * making a reviewer infer it from which columns are filled in. A held
 * row additionally shows its own `holdReason` beneath the badge, when
 * the supplier record has one — the same "state has a reason" pattern
 * `suppliers.js` already surfaces for `on_hold`/`hold_reason`.
 */

let data = { invoices: [] };

export async function load() {
  try {
    const org = currentOrgId();
    const query = org ? `?org=${encodeURIComponent(org)}` : "";
    const response = await fetch(`/api/fraud/unapproved-suppliers${query}`);
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

function reasonLabel(reason) {
  return reason === "onhold" ? t("fraudprevention.reasononhold") : t("fraudprevention.reasonnotonfile");
}

function unapprovedRow(invoice) {
  return invoiceRow(invoice.id, [
    el("td", { text: invoice.invoiceNumber ?? "—" }),
    supplierCell(invoice.supplierName ?? invoice.supplierVatId, invoice.supplierId),
    el("td", { class: "num", text: money(invoice.totalWithVat, invoice.currency) }),
    el("td", { text: invoice.issueDate ?? "—" }),
    el(
      "td",
      { class: invoice.reason === "onhold" ? "warn" : "muted" },
      [
        el("div", { text: reasonLabel(invoice.reason) }),
        invoice.holdReason ? el("div", { class: "sub", text: invoice.holdReason }) : null,
      ].filter(Boolean)
    ),
  ]);
}

function unapprovedTable() {
  return el("div", { class: "tablewrap" }, [
    el("table", {}, [
      el("thead", {}, [
        el("tr", {}, [
          el("th", { text: t("fraudprevention.invoicenumber") }),
          el("th", { text: t("fraudprevention.supplier") }),
          el("th", { class: "num", text: t("fraudprevention.amount") }),
          el("th", { text: t("fraudprevention.issuedate") }),
          el("th", { text: t("fraudprevention.reason") }),
        ]),
      ]),
      el("tbody", {}, data.invoices.slice(0, TOP).map(unapprovedRow)),
    ]),
  ]);
}

/** The card itself, built from whatever `load()` last fetched. Callers own the topbar, frame and tab shell around it. */
/** The tile's count — decision 0618. */
export function summary() {
  return { key: "unapproved", label: t("fraudprevention.unapprovedsuppliers"), count: data.invoices.length };
}

export function renderCard() {
  const total = data.invoices.length;
  return listCard("unapproved", [
    listHead(t("fraudprevention.unapprovedsuppliers"), total, () =>
      openTheseInvoices(data.invoices.map((i) => i.id), t("fraudprevention.unapprovedsuppliers"))
    ),
    total === 0
      ? el("div", { class: "muted", text: t("fraudprevention.nounapprovedsuppliers") })
      : el("div", { class: "sub", text: t("fraudprevention.unapprovedsupplierssub") }),
    total === 0 ? null : unapprovedTable(),
  ]);
}
