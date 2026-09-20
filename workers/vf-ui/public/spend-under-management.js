import { t } from "/strings.js";
import { el } from "/tasks.js";
import { currentOrgId } from "/orgs.js";
import { donut } from "/charts.js";

/**
 * Spend under management (with PO) vs. total spend — decision 0419,
 * Financial Performance's second real card, alongside `accruals.js`.
 * The design's own fifth bullet under Liabilities & Accruals' key
 * metrics; the consolidated catalog's own suggested visualization for
 * it is a plain **"Stat tile, % of total spend"** — a genuinely
 * different shape from Accruals' "stat tile + table broken out by
 * stage," so this card reuses `charts.js`'s own `donut()`, the
 * single-proportion ring ("one proportion, not a pie" — that
 * function's own comment), rather than `barList` or `donutChart`
 * (the multi-segment ring `dashboard.js` already uses elsewhere, a
 * different shape for a different question).
 *
 * **Never one blended figure.** The route
 * (`workers/vf-app/src/spend-under-management-route.ts`) groups by
 * currency, the same discipline every Financial Performance metric so
 * far has followed — each currency actually present gets its own
 * ring and its own detail lines, never one percentage computed across
 * currencies this system cannot convert between.
 *
 * **The ring sits beside its own detail column**, reusing
 * `.donutwrap`'s own layout (decision 0247, `dashboard.js`'s
 * `donutChart()`) — the shape (ring left, detail column right) is
 * exactly this card's own too. Unlike `donutChart()`'s own
 * `.donutkey` rows, which are per-segment legend entries, the detail
 * column here is plain `.muted` lines (total spend, spend with a PO,
 * invoice counts) — there is only one proportion, not several
 * segments to key.
 */

let data = { currencies: [] };

export async function load() {
  try {
    const org = currentOrgId();
    const query = org ? `?org=${encodeURIComponent(org)}` : "";
    const response = await fetch(`/api/spend/under-management${query}`);
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

function currencyTile(group) {
  // Wrapped in `.spendundermanagementtile`, not a bare `.donutwrap` —
  // `.dashflow > .panel > .donutwrap` (decision 0261) pins a *single*
  // chart to the bottom of its card, a rule meant for `donutChart()`'s
  // own one-ring-per-card shape. This card can show several rings, one
  // per currency, so each is nested one level deeper to opt out of
  // that pin-to-bottom rule rather than fight it per currency.
  return el("div", { class: "spendundermanagementtile" }, [
    el("div", { class: "donutwrap" }, [
      donut(group.percentWithPo, { label: group.currency }),
      el("div", { class: "donutlegend" }, [
        el("div", {
          class: "muted",
          text: t("financialperformance.totalspend").replace("{amount}", money(group.totalSpend, group.currency)),
        }),
        el("div", {
          class: "muted",
          text: t("financialperformance.withpospend").replace(
            "{amount}",
            money(group.withPoSpend, group.currency)
          ),
        }),
        el("div", {
          class: "muted",
          text: t("financialperformance.invoiceswithpo")
            .replace("{withpo}", String(group.withPoCount))
            .replace("{total}", String(group.totalCount)),
        }),
      ]),
    ]),
  ]);
}

/** The card itself, built from whatever `load()` last fetched. Callers own the topbar, frame and tab shell around it. */
export function renderCard() {
  return data.currencies.length === 0
    ? el("div", { class: "panel card-graphic" }, [
        el("div", { class: "cardhead" }, [el("h3", { text: t("financialperformance.spendundermanagement") })]),
        el("div", { class: "muted", text: t("financialperformance.nospend") }),
      ])
    : el("div", { class: "panel card-graphic" }, [
        el("div", { class: "cardhead" }, [el("h3", { text: t("financialperformance.spendundermanagement") })]),
        el("div", { class: "sub", text: t("financialperformance.spendundermanagementsub") }),
        ...data.currencies.map((group) => currencyTile(group)),
      ]);
}
