import { t } from "/strings.js";
import { el } from "/tasks.js";
import { sparkline } from "/charts.js";

/**
 * Cross-entity exception and fraud-signal trend — decision 0431, the
 * Multi-Enterprise CFO View's fourth real card (`ap-analytics.js`),
 * built the same `load()` / `renderCard()` shape every card on this
 * tab already uses.
 *
 * **`charts.js`'s own `sparkline()`, the same trend cell
 * `fraud-exception-trends.js` already draws** — one row per entity
 * instead of one row per supplier/user/type, uncapped rather than
 * top-N (see the route's own doc comment for why).
 *
 * **No `?org=` query**, the same deliberate omission every other card
 * on this tab already makes.
 */

let data = { weekStartDates: [], byEntity: [] };

export async function load() {
  try {
    const response = await fetch("/api/executive/exception-trends");
    if (!response.ok) return false;
    data = await response.json();
  } catch {
    return false;
  }
  return true;
}

function entityRow(entry) {
  return el("tr", {}, [
    el("td", { text: entry.orgUnitName }),
    el("td", { class: "num", text: String(entry.total) }),
    el("td", { class: "trend" }, [sparkline(entry.weeklyCounts, { height: 28 })]),
  ]);
}

/** The card itself, built from whatever `load()` last fetched. Callers own the topbar, frame and tab shell around it. */
export function renderCard() {
  return data.byEntity.length === 0
    ? el("div", { class: "panel card-graphic" }, [
        el("div", { class: "cardhead" }, [el("h3", { text: t("executiveiq.exceptiontrendsbyentity") })]),
        el("div", { class: "muted", text: t("executiveiq.noexceptiontrendsbyentity") }),
      ])
    : el("div", { class: "panel card-graphic" }, [
        el("div", { class: "cardhead" }, [el("h3", { text: t("executiveiq.exceptiontrendsbyentity") })]),
        el("div", { class: "sub", text: t("executiveiq.exceptiontrendsbyentitysub") }),
        el("div", { class: "tablewrap" }, [
          el("table", {}, [
            el("thead", {}, [
              el("tr", {}, [
                el("th", { text: t("executiveiq.entity") }),
                el("th", { class: "num", text: t("fraudprevention.exceptioncount") }),
                el("th", { text: t("fraudprevention.trend") }),
              ]),
            ]),
            el("tbody", {}, data.byEntity.map(entityRow)),
          ]),
        ]),
      ]);
}
