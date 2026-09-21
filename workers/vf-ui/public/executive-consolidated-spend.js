import { t } from "/strings.js";
import { el } from "/tasks.js";
import { barList } from "/charts.js";

/**
 * Consolidated spend across org units / legal entities — decision
 * 0425, the Multi-Enterprise CFO View's first real card
 * (`ap-analytics.js`), built the same `load()` / `renderCard()` shape
 * every card on every other tab already uses.
 *
 * **No `?org=` query at all — deliberately, unlike every other card on
 * this screen.** This is the one card whose entire point is showing
 * every entity a CFO can see at once, not narrowing to whichever one
 * the org switcher happens to be set to — see
 * `executive-consolidated-spend-route.ts`'s own doc comment for the
 * full reasoning.
 *
 * **A ranked bar list per currency, the same shape Supplier
 * Performance's own "Spend by supplier" card already uses**
 * (`supplier-performance.js`, decision 0416) — `charts.js`'s
 * `barList`, one list per currency actually present, never one
 * blended total. Each row's own note names whether that entity is a
 * legal entity or an operating unit, since the route carries both
 * kinds exactly as recorded rather than assuming one.
 */

let data = { currencies: [] };

export async function load() {
  try {
    const response = await fetch("/api/executive/consolidated-spend");
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

function kindLabel(kind) {
  return kind === "legal_entity" ? t("executiveiq.legalentity") : t("executiveiq.operatingunit");
}

function currencySection(group) {
  const rows = barList(
    group.entities.map((e) => ({
      label: e.orgUnitName,
      value: e.total,
      display: money(e.total, group.currency),
      note: kindLabel(e.orgUnitKind),
    }))
  );

  // A label above each currency's own list only when there is more
  // than one — the same "the common single-currency case stays plain"
  // treatment decision 0416's own card already gives this shape.
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
        el("div", { class: "cardhead" }, [el("h3", { text: t("executiveiq.consolidatedspend") })]),
        el("div", { class: "muted", text: t("executiveiq.noconsolidatedspend") }),
      ])
    : el("div", { class: "panel card-graphic" }, [
        el("div", { class: "cardhead" }, [el("h3", { text: t("executiveiq.consolidatedspend") })]),
        el("div", { class: "sub", text: t("executiveiq.consolidatedspendsub") }),
        ...data.currencies.map((group) => currencySection(group)),
      ]);
}
