import { t } from "/strings.js";
import { el } from "/tasks.js";
import { barList } from "/charts.js";

/**
 * Cross-org throughput/workload comparison — decision 0431, the
 * Multi-Enterprise CFO View's fifth and last data-buildable card
 * (`ap-analytics.js`), built the same `load()` / `renderCard()` shape
 * every card on this tab already uses.
 *
 * **A single ranked bar list, not the stage-bucketed chart
 * `workload.js`'s own card draws** — one completed-count per entity;
 * see `executive-throughput-route.ts`'s own doc comment for why a
 * stage breakdown across a few dozen entities would be the wall of
 * numbers this screen exists to avoid.
 *
 * **No `?org=` query**, the same deliberate omission every other card
 * on this tab already makes.
 */

let data = { entities: [] };

export async function load() {
  try {
    const response = await fetch("/api/executive/throughput");
    if (!response.ok) return false;
    data = await response.json();
  } catch {
    return false;
  }
  return true;
}

function kindLabel(kind) {
  return kind === "legal_entity" ? t("executiveiq.legalentity") : t("executiveiq.operatingunit");
}

/** The card itself, built from whatever `load()` last fetched. Callers own the topbar, frame and tab shell around it. */
export function renderCard() {
  return data.entities.length === 0
    ? el("div", { class: "panel card-graphic" }, [
        el("div", { class: "cardhead" }, [el("h3", { text: t("executiveiq.throughputbyentity") })]),
        el("div", { class: "muted", text: t("executiveiq.nothroughputbyentity") }),
      ])
    : el("div", { class: "panel card-graphic" }, [
        el("div", { class: "cardhead" }, [el("h3", { text: t("executiveiq.throughputbyentity") })]),
        el("div", { class: "sub", text: t("executiveiq.throughputbyentitysub") }),
        barList(
          data.entities.map((e) => ({
            label: e.orgUnitName,
            value: e.completedCount,
            display: String(e.completedCount),
            note: kindLabel(e.orgUnitKind),
          }))
        ),
      ]);
}
