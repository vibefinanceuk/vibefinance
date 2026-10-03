import { t, tCount } from "/strings.js";
import { el } from "/tasks.js";
import { currentOrgId } from "/orgs.js";
import { windowPicker, workloadQuery } from "/window-picker.js";
import { barList } from "/charts.js";

/**
 * Claim-to-complete cycle time — decision 0428, the fourth of
 * Workload's own eight key metrics. One ranked number per user, the
 * companion to the handling-time route's own stage-by-user matrix.
 */

let data = { users: [] };

/** The period chosen in the card's heading — decision 0617. All time until one is chosen. */
let days = null;

export async function load() {
  try {
    const response = await fetch(`/api/workload/cycle-time${workloadQuery(currentOrgId(), days)}`);
    if (!response.ok) return false;
    data = await response.json();
  } catch {
    return false;
  }
  return true;
}

function hoursNote(user) {
  return tCount("workload.taskcountnote", user.n);
}

/**
 * The heading, with the period beside it — decision 0617. Choosing one
 * fetches again and redraws this card in place.
 */
function cardHead() {
  return el("div", { class: "cardhead" }, [
    el("h3", { text: t("workload.cycletime") }),
    windowPicker(days, async (chosen, picker) => {
      days = chosen;
      const card = picker.closest(".panel");
      if (!(await load())) return;
      const next = renderCard();
      card?.replaceWith(next);
      next.querySelector(".windowpick")?.focus();
    }),
  ]);
}

/** The card itself, built from whatever `load()` last fetched. Callers own the topbar, frame and tab shell around it. */
export function renderCard() {
  return data.users.length === 0
    ? el("div", { class: "panel card-graphic" }, [
        cardHead(),
        el("div", { class: "muted", text: days ? t("workload.window.none") : t("workload.nocycletime") }),
      ])
    : el("div", { class: "panel card-graphic" }, [
        cardHead(),
        el("div", { class: "sub", text: t("workload.cycletimesub") }),
        barList(
          data.users.map((u) => ({
            label: u.userName,
            value: u.avgHours,
            display: t("workload.hourscount").replace("{n}", String(Math.round(u.avgHours * 10) / 10)),
            note: hoursNote(u),
            userId: u.userId,
            selectable: u.n > 0,
          })),
          {
            /**
             * **A person's bar opens what they claimed and completed** —
             * decision 0616: the invoices behind the tasks this average
             * is taken over.
             */
            onSelect: async (row) => {
              const { openDocumentsHandledBy } = await import("/documents.js");
              openDocumentsHandledBy(row.userId, row.label, null, days);
            },
          }
        ),
      ]);
}
