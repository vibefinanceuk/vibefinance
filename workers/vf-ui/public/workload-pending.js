import { t } from "/strings.js";
import { el } from "/tasks.js";
import { currentOrgId } from "/orgs.js";

/**
 * Tasks pending action over a configurable period — decision 0428,
 * the fifth of Workload's own eight key metrics. Only the "pending
 * over a period" half; see the route's own doc comment for why
 * "approaching/past due" is not built, and for why "configurable" is
 * read here as three fixed thresholds shown together rather than a
 * live client-side control.
 */

let data = { thresholdsDays: [3, 7, 14], users: [], unclaimed: [0, 0, 0] };

export async function load() {
  try {
    const org = currentOrgId();
    const query = org ? `?org=${encodeURIComponent(org)}` : "";
    const response = await fetch(`/api/workload/pending${query}`);
    if (!response.ok) return false;
    data = await response.json();
  } catch {
    return false;
  }
  return true;
}

function thresholdHeader(days) {
  return t("workload.dayplusheader").replace("{n}", String(days));
}

function pendingRow(label, counts) {
  return el("tr", {}, [
    el("td", { text: label }),
    ...counts.map((n) => el("td", { class: "num", text: String(n) })),
  ]);
}

function pendingTable() {
  const rows = data.users.map((u) => pendingRow(u.userName, u.counts));
  if (data.unclaimed.some((n) => n > 0)) {
    rows.push(pendingRow(t("workload.unclaimed"), data.unclaimed));
  }
  return el("div", { class: "tablewrap" }, [
    el("table", {}, [
      el("thead", {}, [
        el("tr", {}, [
          el("th", { text: t("workload.user") }),
          ...data.thresholdsDays.map((d) => el("th", { class: "num", text: thresholdHeader(d) })),
        ]),
      ]),
      el("tbody", {}, rows),
    ]),
  ]);
}

/** The card itself, built from whatever `load()` last fetched. Callers own the topbar, frame and tab shell around it. */
export function renderCard() {
  const hasAnyRow = data.users.length > 0 || data.unclaimed.some((n) => n > 0);
  return !hasAnyRow
    ? el("div", { class: "panel card-graphic" }, [
        el("div", { class: "cardhead" }, [el("h3", { text: t("workload.pending") })]),
        el("div", { class: "muted", text: t("workload.nopending") }),
      ])
    : el("div", { class: "panel card-graphic" }, [
        el("div", { class: "cardhead" }, [el("h3", { text: t("workload.pending") })]),
        el("div", { class: "sub", text: t("workload.pendingsub") }),
        pendingTable(),
      ]);
}
