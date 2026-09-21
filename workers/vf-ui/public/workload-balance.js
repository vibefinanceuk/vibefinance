import { t } from "/strings.js";
import { el } from "/tasks.js";
import { currentOrgId } from "/orgs.js";
import { barList } from "/charts.js";

/**
 * Workload balance — decision 0428, the seventh of Workload's own
 * eight key metrics. One ranked member list per team, most imbalanced
 * team first, each labelled with its own name and standard deviation —
 * the same "one group, labelled, per top-level entity" shape decision
 * 0427's own discount-eligibility card already established for
 * currencies, applied here to teams instead (`.teamgroup`, not
 * `.spendcurrency` reused — see `app.css`'s own doc comment for why).
 */

let data = { teams: [] };

export async function load() {
  try {
    const org = currentOrgId();
    const query = org ? `?org=${encodeURIComponent(org)}` : "";
    const response = await fetch(`/api/workload/balance${query}`);
    if (!response.ok) return false;
    data = await response.json();
  } catch {
    return false;
  }
  return true;
}

function stdDevNote(team) {
  const rounded = Math.round(team.stdDev * 10) / 10;
  return t("workload.balancestddev").replace("{n}", String(rounded));
}

function teamSection(team) {
  return el("div", { class: "teamgroup" }, [
    el("div", { class: "teamgrouphead" }, [
      el("span", { class: "muted", text: team.teamName }),
      el("span", { class: "muted", text: stdDevNote(team) }),
    ]),
    barList(team.members.map((m) => ({ label: m.userName, value: m.openCount }))),
  ]);
}

/** The card itself, built from whatever `load()` last fetched. Callers own the topbar, frame and tab shell around it. */
export function renderCard() {
  return data.teams.length === 0
    ? el("div", { class: "panel card-graphic" }, [
        el("div", { class: "cardhead" }, [el("h3", { text: t("workload.balance") })]),
        el("div", { class: "muted", text: t("workload.nobalance") }),
      ])
    : el("div", { class: "panel card-graphic" }, [
        el("div", { class: "cardhead" }, [el("h3", { text: t("workload.balance") })]),
        el("div", { class: "sub", text: t("workload.balancesub") }),
        ...data.teams.map((tm) => teamSection(tm)),
      ]);
}
