import { t } from "/strings.js";
import { el } from "/tasks.js";
import { currentOrgId } from "/orgs.js";
import { barList } from "/charts.js";

/**
 * Exceptions by user — decision 0428, the eighth and last of
 * Workload's own eight key metrics. See `workload-exceptions-route.ts`'s
 * own doc comment for why this reuses decision 0423's own definition
 * of an exception under a different gate and a coaching framing, not
 * a fraud-review one.
 */

let data = { users: [] };

export async function load() {
  try {
    const org = currentOrgId();
    const query = org ? `?org=${encodeURIComponent(org)}` : "";
    const response = await fetch(`/api/workload/exceptions${query}`);
    if (!response.ok) return false;
    data = await response.json();
  } catch {
    return false;
  }
  return true;
}

function exceptionNote(user) {
  return t("workload.exceptioncount").replace("{n}", String(user.n));
}

/** The card itself, built from whatever `load()` last fetched. Callers own the topbar, frame and tab shell around it. */
export function renderCard() {
  return data.users.length === 0
    ? el("div", { class: "panel card-graphic" }, [
        el("div", { class: "cardhead" }, [el("h3", { text: t("workload.exceptions") })]),
        el("div", { class: "muted", text: t("workload.noexceptions") }),
      ])
    : el("div", { class: "panel card-graphic" }, [
        el("div", { class: "cardhead" }, [el("h3", { text: t("workload.exceptions") })]),
        el("div", { class: "sub", text: t("workload.exceptionssub") }),
        barList(data.users.map((u) => ({ label: u.userName, value: u.n, display: exceptionNote(u) }))),
      ]);
}
