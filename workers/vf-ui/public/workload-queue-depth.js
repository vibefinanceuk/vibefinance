import { t } from "/strings.js";
import { el } from "/tasks.js";
import { currentOrgId } from "/orgs.js";
import { stackedBarRows, chartLegend } from "/charts.js";

/**
 * Team queue depth — decision 0428, the sixth of Workload's own eight
 * key metrics. One stacked bar per team — available (unclaimed) at
 * the base, locked (claimed but not finished) above it — the same
 * `stackedBarRows` `workload.js`'s own throughput card already uses,
 * two fixed segments instead of a stage's own colour-coded buckets.
 *
 * **A team's bar opens its queue in Documents** — decision 0611: the
 * invoices with a task open in that team's queue, claimed or not.
 */

const AVAILABLE_COLOUR = "var(--chart-1)";
const LOCKED_COLOUR = "var(--chart-2)";

let data = { teams: [] };

export async function load() {
  try {
    const org = currentOrgId();
    const query = org ? `?org=${encodeURIComponent(org)}` : "";
    const response = await fetch(`/api/workload/queue-depth${query}`);
    if (!response.ok) return false;
    data = await response.json();
  } catch {
    return false;
  }
  return true;
}

/** The card itself, built from whatever `load()` last fetched. Callers own the topbar, frame and tab shell around it. */
export function renderCard() {
  if (data.teams.length === 0) {
    return el("div", { class: "panel card-graphic" }, [
      el("div", { class: "cardhead" }, [el("h3", { text: t("workload.queuedepth") })]),
      el("div", { class: "muted", text: t("workload.noqueuedepth") }),
    ]);
  }

  const totalAvailable = data.teams.reduce((sum, tm) => sum + tm.available, 0);
  const totalLocked = data.teams.reduce((sum, tm) => sum + tm.locked, 0);

  return el("div", { class: "panel card-graphic" }, [
    el("div", { class: "cardhead" }, [el("h3", { text: t("workload.queuedepth") })]),
    el("div", { class: "sub", text: t("workload.queuedepthsub") }),
    stackedBarRows(
      data.teams.map((tm) => ({
        label: tm.teamName,
        total: tm.available + tm.locked,
        teamId: tm.teamId,
        segments: [
          { value: tm.available, colour: AVAILABLE_COLOUR, label: t("workload.available") },
          { value: tm.locked, colour: LOCKED_COLOUR, label: t("workload.locked") },
        ],
      })),
      {
        onSelect: async (row) => {
          const { openDocumentsForTeam } = await import("/documents.js");
          openDocumentsForTeam(row.teamId, row.label);
        },
      }
    ),
    chartLegend([
      { label: t("workload.available"), value: totalAvailable, colour: AVAILABLE_COLOUR },
      { label: t("workload.locked"), value: totalLocked, colour: LOCKED_COLOUR },
    ]),
  ]);
}
