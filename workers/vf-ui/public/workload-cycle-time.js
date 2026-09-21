import { t } from "/strings.js";
import { el } from "/tasks.js";
import { currentOrgId } from "/orgs.js";
import { barList } from "/charts.js";

/**
 * Claim-to-complete cycle time — decision 0428, the fourth of
 * Workload's own eight key metrics. One ranked number per user, the
 * companion to the handling-time route's own stage-by-user matrix.
 */

let data = { users: [] };

export async function load() {
  try {
    const org = currentOrgId();
    const query = org ? `?org=${encodeURIComponent(org)}` : "";
    const response = await fetch(`/api/workload/cycle-time${query}`);
    if (!response.ok) return false;
    data = await response.json();
  } catch {
    return false;
  }
  return true;
}

function hoursNote(user) {
  return t("workload.taskcountnote").replace("{n}", String(user.n));
}

/** The card itself, built from whatever `load()` last fetched. Callers own the topbar, frame and tab shell around it. */
export function renderCard() {
  return data.users.length === 0
    ? el("div", { class: "panel card-graphic" }, [
        el("div", { class: "cardhead" }, [el("h3", { text: t("workload.cycletime") })]),
        el("div", { class: "muted", text: t("workload.nocycletime") }),
      ])
    : el("div", { class: "panel card-graphic" }, [
        el("div", { class: "cardhead" }, [el("h3", { text: t("workload.cycletime") })]),
        el("div", { class: "sub", text: t("workload.cycletimesub") }),
        barList(
          data.users.map((u) => ({
            label: u.userName,
            value: u.avgHours,
            display: t("workload.hourscount").replace("{n}", String(Math.round(u.avgHours * 10) / 10)),
            note: hoursNote(u),
          }))
        ),
      ]);
}
