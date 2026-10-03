import { t } from "/strings.js";
import { el } from "/tasks.js";
import { currentOrgId } from "/orgs.js";
import { TOP, invoiceRow, listHead, listCard, openTheseInvoices } from "/fraud-list.js";

/**
 * Segregation-of-duties flags — decision 0424, the Fraud Prevention
 * tab's fifth real card (`ap-analytics.js`), built the same `load()` /
 * `renderCard()` shape every card on this tab already uses.
 *
 * **A table, not a chart** — the route (`workers/vf-app/src/fraud-
 * segregation-of-duties-route.ts`) hands back one row per flagged
 * invoice, the same worklist shape `fraud-duplicates.js` and `fraud-
 * unapproved-suppliers.js` already use. Reuses `fraudprevention.
 * invoicenumber` and `.user`, the same column strings decisions 0420
 * and 0423 already defined.
 *
 * **The stages column is the whole point of the card** — a bare "this
 * person is flagged" tells a reviewer nothing; showing every stage
 * that person actually completed on the invoice, in the order they
 * completed them, is what lets a reviewer judge whether it's a real
 * control gap or an explainable one-off.
 */

let data = { invoices: [] };

export async function load() {
  try {
    const org = currentOrgId();
    const query = org ? `?org=${encodeURIComponent(org)}` : "";
    const response = await fetch(`/api/fraud/segregation-of-duties${query}`);
    if (!response.ok) return false;
    data = await response.json();
  } catch {
    return false;
  }
  return true;
}

function stagesLabel(stages) {
  return stages.map((s) => s.stageName ?? s.requiredPermission).join(" → ");
}

function flagRow(invoice) {
  return invoiceRow(invoice.invoiceId, [
    el("td", { text: invoice.invoiceNumber ?? "—" }),
    el("td", { text: invoice.userName ?? invoice.userId }),
    el("td", { class: "warn", text: stagesLabel(invoice.stages) }),
  ]);
}

function flagsTable() {
  return el("div", { class: "tablewrap" }, [
    el("table", {}, [
      el("thead", {}, [
        el("tr", {}, [
          el("th", { text: t("fraudprevention.invoicenumber") }),
          el("th", { text: t("fraudprevention.user") }),
          el("th", { text: t("fraudprevention.stagescompleted") }),
        ]),
      ]),
      el("tbody", {}, data.invoices.slice(0, TOP).map(flagRow)),
    ]),
  ]);
}

/** The card itself, built from whatever `load()` last fetched. Callers own the topbar, frame and tab shell around it. */
/** The tile's count — decision 0618: flags, one per invoice and person. */
export function summary() {
  return { key: "sod", label: t("fraudprevention.segregationofduties"), count: data.invoices.length };
}

export function renderCard() {
  const total = data.invoices.length;
  return listCard("sod", [
    listHead(t("fraudprevention.segregationofduties"), total, () =>
      openTheseInvoices([...new Set(data.invoices.map((i) => i.invoiceId))], t("fraudprevention.segregationofduties"))
    ),
    total === 0
      ? el("div", { class: "muted", text: t("fraudprevention.nosegregationofduties") })
      : el("div", { class: "sub", text: t("fraudprevention.segregationofdutiessub") }),
    total === 0 ? null : flagsTable(),
  ]);
}
