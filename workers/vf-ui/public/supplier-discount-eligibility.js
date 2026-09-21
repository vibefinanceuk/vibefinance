import { t } from "/strings.js";
import { el } from "/tasks.js";
import { currentOrgId } from "/orgs.js";
import { barList } from "/charts.js";

/**
 * Early-payment / discount eligibility by supplier — decision 0427,
 * the seventh of Supplier Performance's own eight key metrics.
 *
 * **Eligibility, not the design's own literal "capture rate"** — see
 * `supplier-discount-eligibility-route.ts`'s own doc comment for why:
 * this system has no payment-execution data, so it cannot honestly say
 * a discount was *taken*, only that an invoice is still inside its
 * supplier's own window right now.
 *
 * **A ranked bar list per currency**, the same shape `supplier-
 * performance.js`'s own "Spend by supplier" card already uses — ranked
 * by potential discount, the design's own end-user framing for this
 * metric: "money left on the table until someone notices it."
 */

let data = { currencies: [] };

export async function load() {
  try {
    const org = currentOrgId();
    const query = org ? `?org=${encodeURIComponent(org)}` : "";
    const response = await fetch(`/api/suppliers/discount-eligibility${query}`);
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

function eligibleNote(entity) {
  return t("supplierperformance.discounteligiblenote")
    .replace("{n}", String(entity.invoiceCount))
    .replace("{pct}", String(entity.discountPct))
    .replace("{days}", String(entity.discountDays));
}

function currencySection(group) {
  const rows = barList(
    group.entities.map((e) => ({
      label: e.supplierName,
      value: e.potentialDiscount,
      display: money(e.potentialDiscount, group.currency),
      note: eligibleNote(e),
    }))
  );

  return data.currencies.length > 1
    ? el("div", { class: "spendcurrency" }, [el("div", { class: "muted", text: group.currency }), rows])
    : rows;
}

/** The card itself, built from whatever `load()` last fetched. Callers own the topbar, frame and tab shell around it. */
export function renderCard() {
  return data.currencies.length === 0
    ? el("div", { class: "panel card-graphic" }, [
        el("div", { class: "cardhead" }, [el("h3", { text: t("supplierperformance.discounteligibility") })]),
        el("div", { class: "muted", text: t("supplierperformance.nodiscounteligibility") }),
      ])
    : el("div", { class: "panel card-graphic" }, [
        el("div", { class: "cardhead" }, [el("h3", { text: t("supplierperformance.discounteligibility") })]),
        el("div", { class: "sub", text: t("supplierperformance.discounteligibilitysub") }),
        ...data.currencies.map((group) => currencySection(group)),
      ]);
}
