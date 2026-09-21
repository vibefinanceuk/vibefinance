import { t } from "/strings.js";
import { el } from "/tasks.js";
import { currentOrgId } from "/orgs.js";

/**
 * Average handling time by stage and by user — decision 0428, the
 * third of Workload's own eight key metrics.
 *
 * **A plain table, one row per (stage, user)** — see the route's own
 * doc comment: this is a matrix, not a single ranked dimension, the
 * same reasoning that put decision 0427's own hold history in a
 * table rather than a chart.
 */

let data = { rows: [] };

export async function load() {
  try {
    const org = currentOrgId();
    const query = org ? `?org=${encodeURIComponent(org)}` : "";
    const response = await fetch(`/api/workload/handling-time${query}`);
    if (!response.ok) return false;
    data = await response.json();
  } catch {
    return false;
  }
  return true;
}

function hours(n) {
  const rounded = Math.round(n * 10) / 10;
  return t("workload.hourscount").replace("{n}", String(rounded));
}

function handlingRow(row) {
  return el("tr", {}, [
    el("td", { text: row.stageName }),
    el("td", { text: row.userName }),
    el("td", { class: "num", text: hours(row.avgHours) }),
    el("td", { class: "num", text: String(row.n) }),
  ]);
}

function handlingTable() {
  return el("div", { class: "tablewrap" }, [
    el("table", {}, [
      el("thead", {}, [
        el("tr", {}, [
          el("th", { text: t("workload.stage") }),
          el("th", { text: t("workload.user") }),
          el("th", { class: "num", text: t("workload.avghandlingtime") }),
          el("th", { class: "num", text: t("workload.taskcount") }),
        ]),
      ]),
      el("tbody", {}, data.rows.map(handlingRow)),
    ]),
  ]);
}

/** The card itself, built from whatever `load()` last fetched. Callers own the topbar, frame and tab shell around it. */
export function renderCard() {
  return data.rows.length === 0
    ? el("div", { class: "panel card-graphic" }, [
        el("div", { class: "cardhead" }, [el("h3", { text: t("workload.handlingtime") })]),
        el("div", { class: "muted", text: t("workload.nohandlingtime") }),
      ])
    : el("div", { class: "panel card-graphic" }, [
        el("div", { class: "cardhead" }, [el("h3", { text: t("workload.handlingtime") })]),
        el("div", { class: "sub", text: t("workload.handlingtimesub") }),
        handlingTable(),
      ]);
}
