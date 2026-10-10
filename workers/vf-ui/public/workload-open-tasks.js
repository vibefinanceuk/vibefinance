import { t } from "/strings.js";
import { el } from "/tasks.js";
import { currentOrgId } from "/orgs.js";
import { donutChart } from "/charts.js";

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
 *
 * **A chosen user and a ring, not a bar per user** — decision 0612.
 * Dan: a bar per user *"could get pretty big depending on the number of
 * users"*. The card now offers a drop-down on the left of the people
 * with open tasks (nobody without, as the route only returns those, for
 * the org chosen at the top of the page), and on the right a ring of
 * where the chosen person's open tasks sit, a slice per stage. The
 * busiest person is chosen first; a choice is kept while the screen is
 * open, and falls back to the busiest when the org changes and they are
 * not in it.
 */

let data = { users: [], stages: [], available: 0 };
let chosen = null;

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

/**
 * **A stage keeps its colour whoever is chosen** — while five or fewer
 * stages hold anyone's open work, the palette's limit (decision 0242).
 * With more, the ring colours by position, as every other ring does,
 * and its legend still names each slice.
 */
function colourFor(stageId) {
  const stages = data.stages ?? [];
  if (stages.length > 5) return undefined;
  const i = stages.findIndex((s) => s.stageId === stageId);
  return i < 0 ? undefined : `var(--chart-${i + 1})`;
}

/**
 * **The ring on the right, its key under the drop-down** — decision 0613,
 * Dan's own suggestion. A card three to a row is about 290px wide: the
 * picker, a ring and a key side by side did not fit, and the key spilled
 * past the card's edge. The key is the ring's own (`donutChart` builds
 * it, colours, counts, the folded rest and all), moved into the left
 * column, so the two can never disagree.
 */
const RING_SIZE = 120;

/** More people than this, and the drop-down gets a search — decision 0617. */
const SEARCH_FROM = 8;

/**
 * **The ring opens Documents** — decision 0614. A slice, or its row in
 * the key, opens the invoices with a task open for the chosen person at
 * that stage; anywhere else on the ring, all of their open tasks. The
 * same tasks the card counts (`openFor`, `openStage`).
 */
async function openFor(user, stage = null) {
  const { openDocumentsOpenFor } = await import("/documents.js");
  openDocumentsOpenFor(user.userId, user.userName, stage);
}

function ringAndKey(user) {
  const wrap = donutChart(
    (user?.stages ?? []).map((s) => ({ label: s.stageName, value: s.n, colour: colourFor(s.stageId), stageId: s.stageId })),
    {
      size: RING_SIZE,
      arcs: true,
      onSelect: user ? (segment) => openFor(user, { id: segment.stageId, name: segment.label }) : null,
    }
  );
  const key = wrap.querySelector(".donutlegend");
  key?.remove();
  const svg = wrap.querySelector("svg");
  if (svg && user) {
    svg.classList.add("clickable");
    svg.setAttribute("role", "button");
    svg.setAttribute("tabindex", "0");
    svg.setAttribute("aria-label", t("workload.opentasksopenall").replace("{name}", user.userName));
    svg.addEventListener("click", () => openFor(user));
    svg.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openFor(user);
      }
    });
  }
  return { ring: wrap, key: key ?? document.createElement("div") };
}

/** The card itself, built from whatever `load()` last fetched. Callers own the topbar, frame and tab shell around it. */
export function renderCard() {
  if (data.users.length === 0 && data.available === 0) {
    return el("div", { class: "panel card-graphic" }, [
      el("div", { class: "cardhead" }, [el("h3", { text: t("workload.opentasks") })]),
      el("div", { class: "muted", text: t("workload.noopentasks") }),
    ]);
  }

  const sub = [el("div", { class: "sub", text: t("workload.opentaskssub") }), el("div", { class: "muted", text: availableNote() })];
  if (data.users.length === 0) {
    return el("div", { class: "panel card-graphic" }, [el("div", { class: "cardhead" }, [el("h3", { text: t("workload.opentasks") })]), ...sub]);
  }

  if (!data.users.some((u) => u.userId === chosen)) chosen = data.users[0].userId;
  const byName = [...data.users].sort((a, b) => a.userName.localeCompare(b.userName));

  const ringSlot = el("div", { class: "opentasks-ring" });
  const keySlot = el("div", { class: "opentasks-key" });
  function show(userId) {
    const { ring, key } = ringAndKey(data.users.find((u) => u.userId === userId));
    ringSlot.replaceChildren(ring);
    keySlot.replaceChildren(key);
  }
  show(chosen);

  // Top right of the card, where the other cards put their period — decision 0712.
  const picker = el("select", {
    class: "opentasks-user windowpick",
    "aria-label": t("workload.opentasksuser"),
    onchange: (e) => {
      if (!e.target.value) return;
      chosen = e.target.value;
      show(chosen);
    },
  });

  /** The people offered, narrowed to those whose name holds `find`. */
  function offer(find = "") {
    const wanted = find.trim().toLocaleLowerCase();
    const matching = byName.filter((u) => u.userName.toLocaleLowerCase().includes(wanted));
    if (matching.length === 0) {
      picker.replaceChildren(el("option", { value: "", text: t("workload.opentasksnomatch"), disabled: "" }));
      return;
    }
    if (!matching.some((u) => u.userId === chosen)) {
      chosen = matching[0].userId;
      show(chosen);
    }
    picker.replaceChildren(
      ...matching.map((u) => {
        const option = el("option", { value: u.userId, text: `${u.userName} (${u.openCount})` });
        if (u.userId === chosen) option.selected = true;
        return option;
      })
    );
  }
  offer();

  /**
   * **A search, where the list is long — decision 0617.** Past eight
   * people a drop-down is a scroll; typing part of a name narrows it, and
   * the first match is shown at once. Below that, the drop-down alone.
   */
  const find =
    byName.length > SEARCH_FROM
      ? el("input", {
          type: "search",
          class: "opentasks-find",
          placeholder: t("workload.opentasksfind"),
          "aria-label": t("workload.opentasksfind"),
          oninput: (e) => offer(e.target.value),
        })
      : null;

  return el("div", { class: "panel card-graphic" }, [
    el("div", { class: "cardhead" }, [el("h3", { text: t("workload.opentasks") }), picker]),
    ...sub,
    /**
     * **Two boxes, so the outer one can be measured** — decision 0613.
     * The layout follows the card's own width (a CSS container query on
     * `.opentasks-body`), and a container cannot restyle itself, only
     * what is inside it.
     */
    el("div", { class: "opentasks-body" }, [
      el("div", { class: "opentasks-layout" }, [
        el("div", { class: "opentasks-left" }, [find, keySlot].filter(Boolean)),
        ringSlot,
      ]),
    ]),
  ]);
}
