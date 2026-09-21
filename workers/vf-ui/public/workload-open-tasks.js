import { t } from "/strings.js";
import { el } from "/tasks.js";
import { currentOrgId } from "/orgs.js";
import { barList } from "/charts.js";

/**
 * Open task count by user, split by ownership — decision 0428, the
 * second of Workload's own eight key metrics.
 *
 * **Per-user counts, plus one shared "available" total** — see
 * `workload-open-tasks-route.ts`'s own doc comment for why a
 * per-viewer "locked" column doesn't carry over to a manager's
 * aggregate table. The "available" total is shown as the card's own
 * note line, not a bar of its own — it belongs to nobody, so it isn't
 * a user to rank.
 */

let data = { users: [], available: 0 };

export async function load() {
  try {
    const org = currentOrgId();
    const query = org ? `?org=${encodeURIComponent(org)}` : "";
    const response = await fetch(`/api/workload/open-tasks${query}`);
    if (!response.ok) return false;
    data = await response.json();
  } catch {
    return false;
  }
  return true;
}

function availableNote() {
  return t("workload.opentasksavailable").replace("{n}", String(data.available));
}

/** The card itself, built from whatever `load()` last fetched. Callers own the topbar, frame and tab shell around it. */
export function renderCard() {
  return data.users.length === 0 && data.available === 0
    ? el("div", { class: "panel card-graphic" }, [
        el("div", { class: "cardhead" }, [el("h3", { text: t("workload.opentasks") })]),
        el("div", { class: "muted", text: t("workload.noopentasks") }),
      ])
    : el("div", { class: "panel card-graphic" }, [
        el("div", { class: "cardhead" }, [el("h3", { text: t("workload.opentasks") })]),
        el("div", { class: "sub", text: t("workload.opentaskssub") }),
        el("div", { class: "muted", text: availableNote() }),
        barList(data.users.map((u) => ({ label: u.userName, value: u.openCount }))),
      ]);
}
