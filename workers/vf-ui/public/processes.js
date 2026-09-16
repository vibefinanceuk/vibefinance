import { t } from "/strings.js";
import { el, frame, topbar, setCurrentScreen, hasMyPermission } from "/tasks.js";
import { actionLink } from "/viewer.js";
import { icon } from "/icons.js";

/**
 * Process management — decision 0349. Reported live: "adding stages
 * to a process, and version control." Reviewed against decisions
 * 0150 and 0160 before building: the versioning foundation
 * (`process_stage_versions`, a `version` on `processes` and on
 * `process_instances`) already existed and already ran correctly at
 * runtime; nothing had ever created a second version. This screen,
 * and the draft/publish routes behind it, are what finishes that.
 *
 * **A draft is not a new concept the schema needed.** It is simply
 * the rows already sitting at `processes.version + 1` — real from
 * the first edit, gone entirely if discarded, and turned into the
 * live version by nothing more than a number moving to point at
 * rows already there.
 */

let processes = [];
let selectedId = null;
let detail = null;

async function load() {
  const listResponse = await fetch("/api/processes");
  const listBody = await listResponse.json();
  processes = listBody.processes ?? [];

  if (selectedId) {
    const detailResponse = await fetch(`/api/processes/${encodeURIComponent(selectedId)}`);
    detail = detailResponse.ok ? await detailResponse.json() : null;
  } else {
    detail = null;
  }
}

function stageLabel(stage) {
  return stage.ruleSetName ?? t("processes.automatic");
}

/**
 * **A sequence of chevrons, the same shape `process-row.js` already
 * draws for the rules screen and the viewer** — not reused directly,
 * since neither of those needs a per-stage remove affordance and
 * this screen's own draft view does. `onRemove` is only ever passed
 * for a draft's own stages: a live version is never edited directly,
 * only ever reached by publishing a draft that changed it.
 */
// **Which stage a drag started on — decision 0352.** A module-level
// variable, not `event.dataTransfer`: jsdom's own DataTransfer support
// is incomplete, and there is no cross-window or cross-origin need
// here — drag source and drop target are always the same page.
let draggedStageId = null;

function stageChevrons(stages, onRemove, onReorder) {
  return el(
    "div",
    { class: "process" },
    stages.map((stage) =>
      el(
        "div",
        {
          class: "stage",
          ...(onReorder
            ? {
                draggable: "true",
                ondragstart: () => {
                  draggedStageId = stage.id;
                },
                // Required for a drop to ever fire at all — a plain
                // dragover is refused by the browser by default.
                ondragover: (e) => e.preventDefault(),
                ondrop: (e) => {
                  e.preventDefault();
                  if (!draggedStageId || draggedStageId === stage.id) return;
                  /**
                   * **Direction-aware, not always "insert before" —
                   * decision 0352.** Dropping onto a target should
                   * read as "move it to about here," which means
                   * landing just after the target when dragging
                   * forward (onto the last stage moves it to the
                   * very end) and just before it when dragging
                   * backward (onto the first stage moves it to the
                   * very start). A single fixed rule gets one of
                   * those two directions wrong.
                   */
                  const sourceIndex = stages.findIndex((s) => s.id === draggedStageId);
                  const targetIndex = stages.findIndex((s) => s.id === stage.id);
                  const order = stages.map((s) => s.id).filter((id) => id !== draggedStageId);
                  const filteredTargetIndex = order.indexOf(stage.id);
                  const insertAt = sourceIndex < targetIndex ? filteredTargetIndex + 1 : filteredTargetIndex;
                  order.splice(insertAt, 0, draggedStageId);
                  draggedStageId = null;
                  onReorder(order);
                },
              }
            : {}),
        },
        [
          el("span", { text: stage.name }),
          el("span", { class: "count", text: stageLabel(stage) }),
          ...(onRemove
            ? [
                el("button", {
                  class: "actionlink",
                  title: t("processes.removestage"),
                  onclick: () => onRemove(stage),
                }, [icon("close")]),
              ]
            : []),
        ]
      )
    )
  );
}

function openNewProcessForm() {
  const problem = el("div", { class: "warn" });
  const idInput = el("input", { type: "text" });
  const nameInput = el("input", { type: "text" });

  const close = () => backdrop.remove();
  const create = actionLink("create", {
    primary: true,
    onclick: async () => {
      problem.textContent = "";
      const id = idInput.value.trim();
      const name = nameInput.value.trim();
      if (!id || !name) {
        problem.textContent = t("processes.needidandname");
        return;
      }
      try {
        const response = await fetch("/api/processes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, name }),
        });
        if (!response.ok) {
          problem.textContent = (await response.json()).error ?? t("processes.savefailed");
          return;
        }
        backdrop.remove();
        selectedId = id;
        await load();
        render();
      } catch {
        problem.textContent = t("processes.savefailed");
      }
    },
  });
  const stateButtons = el("div", { class: "statebuttons" }, [create, actionLink("close", { onclick: close })]);

  const backdrop = el("div", { class: "backdrop" }, [
    el("div", { class: "popout" }, [
      el("div", { class: "cardhead" }, [el("h3", { text: t("processes.new") }), stateButtons]),
      el("div", { class: "editgrid" }, [
        el("label", { text: t("processes.id") }),
        idInput,
        el("label", { text: t("processes.name") }),
        nameInput,
      ]),
      problem,
    ]),
  ]);

  backdrop.onclick = (e) => {
    if (e.target === backdrop) backdrop.remove();
  };
  document.body.append(backdrop);
  idInput.focus();
}

function openAddStageForm(processId) {
  const problem = el("div", { class: "warn" });
  const idInput = el("input", { type: "text" });
  const nameInput = el("input", { type: "text" });
  const scopePicker = el("select", {}, [
    el("option", { value: "header", text: t("processes.scopeheader") }),
    el("option", { value: "line", text: t("processes.scopeline") }),
  ]);

  const close = () => backdrop.remove();
  const add = actionLink("create", {
    primary: true,
    onclick: async () => {
      problem.textContent = "";
      const id = idInput.value.trim();
      const name = nameInput.value.trim();
      if (!id || !name) {
        problem.textContent = t("processes.needidandname");
        return;
      }
      try {
        const response = await fetch(`/api/processes/${encodeURIComponent(processId)}/draft/stages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, name, evaluationScope: scopePicker.value }),
        });
        if (!response.ok) {
          problem.textContent = (await response.json()).error ?? t("processes.savefailed");
          return;
        }
        backdrop.remove();
        await load();
        render();
      } catch {
        problem.textContent = t("processes.savefailed");
      }
    },
  });
  const stateButtons = el("div", { class: "statebuttons" }, [add, actionLink("close", { onclick: close })]);

  const backdrop = el("div", { class: "backdrop" }, [
    el("div", { class: "popout" }, [
      el("div", { class: "cardhead" }, [el("h3", { text: t("processes.addstage") }), stateButtons]),
      el("div", { class: "editgrid" }, [
        el("label", { text: t("processes.id") }),
        idInput,
        el("label", { text: t("processes.name") }),
        nameInput,
        el("label", { text: t("processes.scope") }),
        scopePicker,
      ]),
      problem,
    ]),
  ]);

  backdrop.onclick = (e) => {
    if (e.target === backdrop) backdrop.remove();
  };
  document.body.append(backdrop);
  idInput.focus();
}

async function removeDraftStage(processId, stage) {
  const response = await fetch(
    `/api/processes/${encodeURIComponent(processId)}/draft/stages/${encodeURIComponent(stage.id)}`,
    { method: "DELETE" }
  );
  if (!response.ok) {
    const body = await response.json();
    window.alert(body.error ?? t("processes.savefailed"));
    return;
  }
  await load();
  render();
}

/**
 * **Drag-to-reorder, reported live — decision 0352.** `PUT`, same
 * path as adding a stage: the whole draft's own order, named once
 * each, never a partial move — the exact shape `handleReorderDraft
 * Stages` itself requires.
 */
async function reorderDraftStages(processId, orderedStageIds) {
  const response = await fetch(`/api/processes/${encodeURIComponent(processId)}/draft/stages`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderedStageIds }),
  });
  if (!response.ok) {
    const body = await response.json();
    window.alert(body.error ?? t("processes.savefailed"));
    return;
  }
  await load();
  render();
}

async function publishDraft(processId) {
  const response = await fetch(`/api/processes/${encodeURIComponent(processId)}/publish`, { method: "POST" });
  if (!response.ok) {
    const body = await response.json();
    window.alert(body.error ?? t("processes.savefailed"));
    return;
  }
  await load();
  render();
}

async function discardDraft(processId) {
  await fetch(`/api/processes/${encodeURIComponent(processId)}/draft`, { method: "DELETE" });
  await load();
  render();
}

function processListPanel(canManage) {
  const rows = processes.map((p) =>
    el(
      "tr",
      { class: p.id === selectedId ? "clickable on" : "clickable", onclick: () => { selectedId = p.id; load().then(render); } },
      [
        el("td", { text: p.name }),
        el("td", { class: "sm muted", text: `v${p.version}` }),
        el("td", { class: "sm muted", text: `${p.stageCount} ${t("processes.stages")}` }),
      ]
    )
  );

  return el("div", { class: "panel" }, [
    el(
      "div",
      { class: "cardhead" },
      [el("h3", { text: t("processes.title") }), canManage ? actionLink("newprocess", { onclick: () => openNewProcessForm() }) : null].filter(
        Boolean
      )
    ),
    rows.length > 0
      ? el("div", { class: "tablewrap" }, [
          el("table", {}, [
            el("thead", {}, [
              el("tr", {}, [
                el("th", { text: t("processes.name") }),
                el("th", { text: t("processes.version") }),
                el("th", { text: t("processes.stages") }),
              ]),
            ]),
            el("tbody", {}, rows),
          ]),
        ])
      : el("p", { class: "muted", text: t("processes.empty") }),
  ]);
}

function processDetailPanel(canManage) {
  if (!detail) return null;

  const liveRow = el("div", { class: "panel" }, [
    el("h3", { text: `${detail.name} — ${t("processes.v")}${detail.version} ${t("processes.live")}` }),
    stageChevrons(detail.stages),
  ]);

  if (!detail.draft) {
    return el(
      "div",
      {},
      [
        liveRow,
        canManage
          ? el("div", { style: "margin-top: 10px;" }, [actionLink("addstage", { onclick: () => openAddStageForm(detail.id) })])
          : null,
      ].filter(Boolean)
    );
  }

  const draftPanel = el("div", { class: "panel" }, [
    el("div", { class: "cardhead" }, [
      el("h3", { text: `${t("processes.draft")} — ${t("processes.v")}${detail.draft.version}` }),
      el(
        "div",
        { class: "statebuttons" },
        [
          canManage ? actionLink("addstage", { onclick: () => openAddStageForm(detail.id) }) : null,
          canManage ? actionLink("publish", { primary: true, onclick: () => publishDraft(detail.id) }) : null,
          canManage ? actionLink("discard", { onclick: () => discardDraft(detail.id) }) : null,
        ].filter(Boolean)
      ),
    ]),
    stageChevrons(
      detail.draft.stages,
      canManage ? (stage) => removeDraftStage(detail.id, stage) : null,
      canManage ? (order) => reorderDraftStages(detail.id, order) : null
    ),
    el("p", { class: "muted sm", text: t("processes.draftnote") }),
  ]);

  return el("div", {}, [liveRow, draftPanel]);
}

function render() {
  const shell = document.getElementById("shell");
  if (!shell) return;
  const canManage = hasMyPermission("Admin.Configure");

  shell.replaceChildren(
    frame(
      el("div", {}, [
        topbar(t("nav.processes"), t("processes.subtitle")),
        processListPanel(canManage),
        processDetailPanel(canManage),
      ].filter(Boolean))
    )
  );
}

export async function open() {
  setCurrentScreen("processes");
  await load();
  render();
}
