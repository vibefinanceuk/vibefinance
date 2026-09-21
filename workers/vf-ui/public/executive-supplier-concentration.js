import { t } from "/strings.js";
import { el } from "/tasks.js";

/**
 * Cross-entity supplier concentration — decision 0431, the Multi-
 * Enterprise CFO View's third real card (`ap-analytics.js`), built
 * the same `load()` / `renderCard()` shape every card on this tab
 * already uses.
 *
 * **No `?org=` query**, the same deliberate omission every other card
 * on this tab already makes — see `executive-consolidated-spend.js`.
 *
 * **A table, not a bar list.** Unlike every other card on this screen,
 * the figure here is not one number per entity — it is *which*
 * entities a supplier appears in, and how many. `barList` has no shape
 * for that, so this card names its own columns instead, the same call
 * `fraud-exception-trends.js` already made for a similarly multi-part
 * row.
 */

let data = { suppliers: [] };

export async function load() {
  try {
    const response = await fetch("/api/executive/supplier-concentration");
    if (!response.ok) return false;
    data = await response.json();
  } catch {
    return false;
  }
  return true;
}

function money(amount, currency) {
  if (amount === null || amount === undefined) return "—";
  return `${currency ?? ""} ${Number(amount).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`.trim();
}

function appearanceList(appearances) {
  return appearances
    .map((a) => `${a.orgUnitName} (${money(a.total, a.currency)}, #${a.rank})`)
    .join(", ");
}

function supplierRow(entry) {
  return el("tr", {}, [
    el("td", { text: entry.supplierName }),
    el("td", { class: "num", text: String(entry.entityCount) }),
    el("td", { text: appearanceList(entry.appearances) }),
  ]);
}

/** The card itself, built from whatever `load()` last fetched. Callers own the topbar, frame and tab shell around it. */
export function renderCard() {
  return data.suppliers.length === 0
    ? el("div", { class: "panel card-graphic" }, [
        el("div", { class: "cardhead" }, [el("h3", { text: t("executiveiq.supplierconcentration") })]),
        el("div", { class: "muted", text: t("executiveiq.nosupplierconcentration") }),
      ])
    : el("div", { class: "panel card-graphic" }, [
        el("div", { class: "cardhead" }, [el("h3", { text: t("executiveiq.supplierconcentration") })]),
        el("div", { class: "sub", text: t("executiveiq.supplierconcentrationsub") }),
        el("div", { class: "tablewrap" }, [
          el("table", {}, [
            el("thead", {}, [
              el("tr", {}, [
                el("th", { text: t("executiveiq.supplier") }),
                el("th", { class: "num", text: t("executiveiq.entitycount") }),
                el("th", { text: t("executiveiq.entities") }),
              ]),
            ]),
            el("tbody", {}, data.suppliers.map(supplierRow)),
          ]),
        ]),
      ]);
}
