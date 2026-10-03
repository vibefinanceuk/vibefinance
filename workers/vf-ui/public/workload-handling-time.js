import { t } from "/strings.js";
import { el } from "/tasks.js";
import { currentOrgId } from "/orgs.js";
import { barList } from "/charts.js";

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

/**
 * **A group per person, a bar per stage** — decision 0616. The first
 * version was a four-column table (stage, user, hours, tasks), and in a
 * card three to a row, about 290px, the names wrapped and the task count
 * fell off the card's edge. The question it answers is *"which stage is
 * slow for this person"* (0428), so each person is a group, slowest
 * first as the route ranks them, with a bar per stage sized by its
 * average and its hours and task count beside it, as the cycle time card
 * already shows a person.
 *
 * A stage's bar opens Documents at the invoices where the person
 * claimed and completed a task at that stage; the person's name, all of
 * them.
 */
function byPerson() {
  const people = new Map();
  for (const row of data.rows) {
    if (!people.has(row.userId)) people.set(row.userId, { userId: row.userId, userName: row.userName, rows: [] });
    people.get(row.userId).rows.push(row);
  }
  return [...people.values()];
}

async function openHandled(person, stage = null) {
  const { openDocumentsHandledBy } = await import("/documents.js");
  openDocumentsHandledBy(person.userId, person.userName, stage);
}

function personGroup(person, max) {
  const name = el("span", { class: "muted", text: person.userName });
  const head = el(
    "div",
    {
      class: "teamgrouphead clickable",
      role: "button",
      tabindex: "0",
      onclick: () => openHandled(person),
      onkeydown: (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openHandled(person);
        }
      },
    },
    [name]
  );
  const bars = barList(
    person.rows.map((r) => ({
      label: r.stageName,
      value: r.avgHours,
      display: hours(r.avgHours),
      note: t("workload.taskcountnote").replace("{n}", String(r.n)),
      selectable: r.n > 0,
      stage: { id: r.stageId, name: r.stageName },
    })),
    // One scale across people, so 2 hours is the same length in every group.
    { max, onSelect: (row) => openHandled(person, row.stage) }
  );
  return el("div", { class: "teamgroup handlinggroup" }, [head, bars]);
}

/** The card itself, built from whatever `load()` last fetched. Callers own the topbar, frame and tab shell around it. */
export function renderCard() {
  if (data.rows.length === 0) {
    return el("div", { class: "panel card-graphic" }, [
      el("div", { class: "cardhead" }, [el("h3", { text: t("workload.handlingtime") })]),
      el("div", { class: "muted", text: t("workload.nohandlingtime") }),
    ]);
  }
  const max = Math.max(...data.rows.map((r) => r.avgHours), 0);
  return el("div", { class: "panel card-graphic" }, [
    el("div", { class: "cardhead" }, [el("h3", { text: t("workload.handlingtime") })]),
    el("div", { class: "sub", text: t("workload.handlingtimesub") }),
    ...byPerson().map((p) => personGroup(p, max)),
  ]);
}
