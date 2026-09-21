import { t } from "/strings.js";
import { el } from "/tasks.js";
import { barList } from "/charts.js";

/**
 * Liabilities and accruals by entity — decision 0431, the Multi-
 * Enterprise CFO View's second real card (`ap-analytics.js`), built
 * the same `load()` / `renderCard()` shape every card on this tab
 * already uses.
 *
 * **No `?org=` query, the same deliberate omission
 * `executive-consolidated-spend.js` already makes** — this card's
 * whole point is comparing every entity at once.
 *
 * **A ranked bar list per currency, the same shape
 * `executive-consolidated-spend.js` already uses** — one total per
 * entity, not a further stage breakdown (see the route's own doc
 * comment for why); each row's note names how many accruing invoices
 * make up that entity's own total, reusing `accruals.js`'s own
 * `financialperformance.invoicecount` string rather than a new,
 * identical one.
 */

let data = { currencies: [] };

export async function load() {
  try {
    const response = await fetch("/api/executive/liabilities-by-entity");
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

function currencySection(group) {
  const rows = barList(
    group.entities.map((e) => ({
      label: e.orgUnitName,
      value: e.total,
      display: money(e.total, group.currency),
      note: t("financialperformance.invoicecount").replace("{n}", String(e.count)),
    }))
  );

  return data.currencies.length > 1
    ? el("div", { class: "spendcurrency" }, [
        el("div", { class: "muted", text: `${group.currency} · ${money(group.total, group.currency)}` }),
        rows,
      ])
    : rows;
}

/** The card itself, built from whatever `load()` last fetched. Callers own the topbar, frame and tab shell around it. */
export function renderCard() {
  return data.currencies.length === 0
    ? el("div", { class: "panel card-graphic" }, [
        el("div", { class: "cardhead" }, [el("h3", { text: t("executiveiq.liabilitiesbyentity") })]),
        el("div", { class: "muted", text: t("executiveiq.noliabilitiesbyentity") }),
      ])
    : el("div", { class: "panel card-graphic" }, [
        el("div", { class: "cardhead" }, [el("h3", { text: t("executiveiq.liabilitiesbyentity") })]),
        el("div", { class: "sub", text: t("executiveiq.liabilitiesbyentitysub") }),
        ...data.currencies.map((group) => currencySection(group)),
      ]);
}
