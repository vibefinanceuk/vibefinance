import { t } from "/strings.js";
import { el, frame, topbar, setCurrentScreen, hasMyPermission } from "/tasks.js";
import { actionLink } from "/viewer.js";
import { currencyPicker } from "/access.js";
import { accountCodingTab, loadCodingListCsvFormats, loadAccountCodingTables } from "/coding-lists.js";

/**
 * AP Setup — decision 0440.
 *
 * *"Under a new side menu option, I would like to establish AP
 * Configuration options... Matching, Account Coding and Approval
 * Hierarchy setup screens in tabs."* The same `.tabbar`/`.tab`
 * component `ap-analytics.js` already reuses from `access.js`, and —
 * per the operator's own instruction — the Approval Hierarchy tab's
 * own forms follow `access.js`'s own conventions directly:
 * `.editgrid` layout, the shared `currencyPicker()` (now exported from
 * there), inline "Set"/"Remove" actions rather than a second pop-out
 * component, and the same `problem` div for inline errors.
 *
 * **Matching is live — decision 0472.** The org-wide default tolerance
 * and quantity-matching toggle `org_matching_config` has held since
 * migration `0078` (decisions 0465/0468/0469), reachable only by
 * direct SQL until now — this tab is `matching-config-route.ts`'s own
 * front end, one form, one Save, the same shape `modeForm` below
 * already established for Approval Hierarchy's own mode/Default
 * Approver pair. No supplier-specific override lives here; this is the
 * fallback every supplier without one of their own falls back to.
 *

 * **Approval Hierarchy is live**: the mode (Employee-Supervisor /
 * Cost-Object / Manual / API) and Default Approver decision 0439's own
 * resolver already reads, plus CRUD for the two override tables that
 * make a limit or a supervisor org-specific — `org_user_supervisor_
 * overrides` and `org_authority_limit_overrides`. Turning
 * `process_stages.uses_approval_hierarchy` on for a real stage stays
 * SQL-only here too, the same as `required_permission` (decision
 * 0439's own "What is not built") — no route exists anywhere in this
 * app to edit a stage's own properties, and inventing one for a single
 * flag was out of scope for this screen.
 *
 * **Account Coding is live too — decision 0444.** Company code, Cost
 * Centre, Project, Commodity Code, and General Ledger Code, all built
 * out in `coding-lists.js`; this file just loads what that tab needs
 * alongside everything else and hands it down.
 *
 * **Account Coding's four manageable tables own their own paginated,
 * searched state — decision 0446.** `coding-lists.js` now fetches its
 * own table data (`loadAccountCodingTables()`, a sibling call to its
 * own `loadCodingListCsvFormats()`, both awaited the same "ready by
 * the time render() runs" way) rather than this file eagerly fetching
 * `/api/org/cost-centres` and three `/api/coding-lists/:type` calls
 * and handing the full arrays down as props. This file keeps only the
 * one thing `coding-lists.js` can't get anywhere else — the lightweight
 * `{id, name}` Cost Centre list `/org/overview` already returns — and
 * passes that through as `costCentreNames`.
 */

const MODES = ["employee_supervisor", "cost_object", "manual", "api"];

const TABS = [
  { key: "matching", labelKey: "apsetup.matching" },
  { key: "coding", labelKey: "apsetup.coding" },
  { key: "approvalhierarchy", labelKey: "apsetup.approvalhierarchy" },
];

let units = [];
let users = [];
let config = null;
let matchingConfig = null;
let activeTab = null;
let costCentreNames = [];

/**
 * **Search over the two override lists, entirely client-side —
 * decision 0442.** Both lists arrive in one `load()` fetch already
 * (`/api/approval-config` returns every row, unlike Documents' own
 * server-side, `LIMIT`-capped search), so filtering and capping what's
 * *shown* happens in the browser rather than a second round trip. Kept
 * as plain module state, the same shape `activeTab` above already is
 * — reset per screen visit, not persisted.
 */
let supervisorSearchQuery = "";
let limitSearchQuery = "";

/**
 * **How many rows render before the list asks you to narrow it** — the
 * same default Documents' own `limit` query param falls back to
 * (`documents-route.ts`), reused here as a display cap rather than a
 * fetch cap since the whole list is already in memory.
 */
const OVERRIDE_DISPLAY_CAP = 50;

async function load() {
  try {
    // The CSV Template/Load help affordance (decision 0445) and the four
    // paginated Account Coding tables (decision 0446) are both fetched
    // alongside everything else, the same "in its final state by the
    // time render() runs" discipline `purchase-orders.js`'s own
    // loadFormat() already established — but kept out of the ok-check
    // just below, since neither one throws on its own failed fetch;
    // each degrades its own corner of the coding tab rather than this
    // whole screen (loadCodingListCsvFormats() leaves a null entry per
    // failed type, loadAccountCodingTables() leaves that one table's
    // `freshTableState()` defaults — empty rows, `total: 0` — in place).
    const [[overviewResponse, configResponse, matchingConfigResponse]] = await Promise.all([
      Promise.all([fetch("/api/org/overview"), fetch("/api/approval-config"), fetch("/api/matching-config")]),
      loadCodingListCsvFormats(),
      loadAccountCodingTables(),
    ]);
    if (!overviewResponse.ok || !configResponse.ok || !matchingConfigResponse.ok) {
      console.error(
        `AP Setup load failed: overview ${overviewResponse.status}, config ${configResponse.status}, matching config ${matchingConfigResponse.status}`
      );
      return false;
    }
    const overview = await overviewResponse.json();
    units = overview.units ?? [];
    users = overview.users ?? [];
    costCentreNames = overview.costCentres ?? [];
    config = await configResponse.json();
    matchingConfig = await matchingConfigResponse.json();
    return true;
  } catch (err) {
    console.error("AP Setup load failed", err);
    return false;
  }
}

/**
 * **The Matching tab — decision 0472.** One form, one Save, the exact
 * same "replace, not merge" shape `modeForm` below already uses: all
 * three fields submit together, so a save can never leave one field's
 * old value silently in place. Percentages are entered as plain
 * numbers (`5` means 5%), matching the units `org_matching_config`
 * itself is stored in and `po-matching.ts`'s own doc comments already
 * describe them by.
 *
 * **No supplier-specific override here** — `supplier.amountTolerancePct`/
 * `quantityTolerancePct` still supersede this org-wide default when a
 * supplier has its own, unchanged by this tab existing (decision 0468's
 * own scoping: this tab configures the fallback only).
 */
function matchingConfigTab(problem) {
  const amountInput = el("input", { type: "number", min: "0", step: "0.01" });
  amountInput.value = String(matchingConfig.amountTolerancePct);
  const quantityInput = el("input", { type: "number", min: "0", step: "0.01" });
  quantityInput.value = String(matchingConfig.quantityTolerancePct);
  const enabledCheckbox = el("input", {
    type: "checkbox",
    id: "quantitymatchingenabled",
    ...(matchingConfig.quantityMatchingEnabled ? { checked: "checked" } : {}),
  });

  const form = el("div", { class: "editgrid" }, [
    el("label", { text: t("apsetup.amounttolerance") }),
    amountInput,
    el("label", { text: t("apsetup.quantitytolerance") }),
    quantityInput,
    el("label", { for: "quantitymatchingenabled", text: t("apsetup.quantitymatchingenabled") }),
    enabledCheckbox,
  ]);

  const save = actionLink("save", {
    primary: true,
    onclick: async () => {
      problem.textContent = "";
      const amountTolerancePct = Number(amountInput.value);
      const quantityTolerancePct = Number(quantityInput.value);
      if (!Number.isFinite(amountTolerancePct) || amountTolerancePct < 0 || !Number.isFinite(quantityTolerancePct) || quantityTolerancePct < 0) {
        problem.textContent = t("apsetup.savematchingfailed");
        return;
      }
      try {
        const response = await fetch("/api/matching-config", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            amountTolerancePct,
            quantityTolerancePct,
            quantityMatchingEnabled: enabledCheckbox.checked,
          }),
        });
        if (!response.ok) {
          problem.textContent = (await response.json()).error ?? t("apsetup.savematchingfailed");
          return;
        }
        await load();
        render();
      } catch {
        problem.textContent = t("apsetup.savematchingfailed");
      }
    },
  });

  return el("div", { class: "panel" }, [
    el("div", { class: "cardhead" }, [el("h3", { text: t("apsetup.matching") }), el("div", { class: "statebuttons" }, [save])]),
    el("p", { class: "muted sm", text: t("apsetup.matchingsub") }),
    form,
    problem,
  ]);
}

/**
 * **Mode and Default Approver, one form, one Save — decision 0440.**
 * The same "replace, not merge" shape `openPersonPropertiesForm`'s own
 * properties form already takes: both fields submit together, since a
 * mode change with no default approver considered is exactly the
 * routing gap decision 0439's own operator conversation named.
 */
function modeForm(problem) {
  const modePicker = el(
    "select",
    {},
    MODES.map((mode) =>
      el("option", { value: mode, text: t(`apsetup.mode.${mode}`), ...(mode === config.mode ? { selected: "selected" } : {}) })
    )
  );
  const approverPicker = el("select", {}, [
    el("option", { value: "", text: t("apsetup.defaultapprovernone") }),
    ...users.map((u) =>
      el("option", { value: u.id, text: u.name, ...(u.id === config.defaultApproverUserId ? { selected: "selected" } : {}) })
    ),
  ]);

  const form = el("div", { class: "editgrid" }, [
    el("label", { text: t("apsetup.mode") }),
    modePicker,
    el("label", { text: t("apsetup.defaultapprover") }),
    approverPicker,
  ]);

  const save = actionLink("save", {
    primary: true,
    onclick: async () => {
      problem.textContent = "";
      try {
        const response = await fetch("/api/approval-config", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: modePicker.value, defaultApproverUserId: approverPicker.value || null }),
        });
        if (!response.ok) {
          problem.textContent = (await response.json()).error ?? t("apsetup.savemodefailed");
          return;
        }
        await load();
        render();
      } catch {
        problem.textContent = t("apsetup.savemodefailed");
      }
    },
  });

  return el("div", { class: "panel" }, [
    el("div", { class: "cardhead" }, [el("h3", { text: t("apsetup.approvalhierarchy") }), el("div", { class: "statebuttons" }, [save])]),
    el("p", { class: "muted sm", text: t("apsetup.modesub") }),
    form,
    problem,
  ]);
}

/**
 * **A search box plus a capped list, shared by both override
 * tables — decision 0442.** The operator's own request: the list
 * "build below the configuration boxes" (the add-row form, moved
 * above this in both sections below) and be "searchable and
 * paginated, as the Document search looks" — Documents' own search
 * turned out to mean a query box plus a capped, `LIMIT`-ed result set
 * with a "shown of total" note (`documents.js`'s own `searchedcount`),
 * not real page-number controls, which this app has nowhere at all;
 * matched here rather than inventing a first one.
 *
 * **`onchange`, not `oninput`, and a re-focus after re-rendering** —
 * the same discipline `documents.js`'s own search box already uses
 * and comments on: `render()` replaces the whole shell's children, so
 * filtering on every keystroke would rebuild the input out from under
 * itself mid-type.
 */
function searchableOverrideList({ query, onQueryChange, searchId, hint, items, matchText, rowsFor, emptyText, nomatchText }) {
  const needle = query.trim().toLowerCase();
  const matches = needle ? items.filter((item) => matchText(item).toLowerCase().includes(needle)) : items;
  const shown = matches.slice(0, OVERRIDE_DISPLAY_CAP);

  const search = el("input", { type: "search", id: searchId, placeholder: hint });
  search.value = query;
  search.onchange = () => {
    onQueryChange(search.value);
    render();
    document.getElementById(searchId)?.focus();
  };

  const rows = shown.length > 0 ? rowsFor(shown) : [el("p", { class: "muted", text: needle ? nomatchText : emptyText })];

  return [
    el("div", { class: "searchrow" }, [search]),
    el("div", { class: "assignmentlist" }, rows),
    ...(matches.length > shown.length
      ? [
          el("p", {
            class: "sm muted",
            text: t("apsetup.overridesearchedcount")
              .replace("{shown}", String(shown.length))
              .replace("{total}", String(matches.length)),
          }),
        ]
      : []),
  ];
}

/**
 * **One unit-scoped override at a time — decision 0440.** Same
 * "inline picker row plus its own Add button" shape `openTeamForm`'s
 * own member picker already uses, rather than a second pop-out
 * component for what is, per row, three fields.
 *
 * **The list moved below the add-row form, and gained search — decision
 * 0442**, at the operator's own request once these lists started to
 * grow: the add-row controls stay the first thing you see, the search
 * box and the (now potentially long) list of existing overrides follow.
 */
function supervisorOverridesSection(problem) {
  const userPicker = el("select", {}, users.map((u) => el("option", { value: u.id, text: u.name })));
  const unitPicker = el("select", {}, units.map((u) => el("option", { value: u.id, text: u.name })));
  const supervisorPicker = el("select", {}, users.map((u) => el("option", { value: u.id, text: u.name })));
  const addBtn = actionLink("create", {
    primary: true,
    label: t("apsetup.add"),
    onclick: async () => {
      problem.textContent = "";
      try {
        const response = await fetch("/api/approval-config/supervisor-overrides", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: userPicker.value, unitId: unitPicker.value, supervisorId: supervisorPicker.value }),
        });
        if (!response.ok) {
          problem.textContent = (await response.json()).error ?? t("apsetup.overridesavefailed");
          return;
        }
        await load();
        render();
      } catch {
        problem.textContent = t("apsetup.overridesavefailed");
      }
    },
  });

  return el("div", { class: "panel" }, [
    el("div", { class: "cardhead" }, [
      el("h3", { text: t("apsetup.supervisoroverrides") }),
      el("div", { class: "statebuttons" }, [addBtn]),
    ]),
    el("p", { class: "muted sm", text: t("apsetup.supervisoroverridessub") }),
    el("div", { class: "editgrid" }, [
      el("label", { text: t("apsetup.person") }),
      userPicker,
      el("label", { text: t("roles.org") }),
      unitPicker,
      el("label", { text: t("apsetup.supervisor") }),
      supervisorPicker,
    ]),
    ...searchableOverrideList({
      query: supervisorSearchQuery,
      onQueryChange: (value) => {
        supervisorSearchQuery = value;
      },
      searchId: "supervisoroverridesearch",
      hint: t("apsetup.supervisoroverridesearchhint"),
      items: config.supervisorOverrides,
      matchText: (o) => `${o.userName} ${o.unitName} ${o.supervisorName}`,
      emptyText: t("apsetup.nosupervisoroverrides"),
      nomatchText: t("apsetup.supervisoroverridenomatch"),
      rowsFor: (shown) =>
        shown.map((o) =>
          el("div", { class: "assignmentrow" }, [
            el("span", { text: `${o.userName} — ${o.unitName} — ${t("apsetup.reportsto")} ${o.supervisorName}` }),
            el("button", {
              text: t("roles.remove"),
              onclick: async () => {
                problem.textContent = "";
                try {
                  const response = await fetch(
                    `/api/approval-config/supervisor-overrides/${encodeURIComponent(o.userId)}/${encodeURIComponent(o.unitId)}`,
                    { method: "DELETE" }
                  );
                  if (!response.ok) {
                    problem.textContent = (await response.json()).error ?? t("apsetup.overridesavefailed");
                    return;
                  }
                  await load();
                  render();
                } catch {
                  problem.textContent = t("apsetup.overridesavefailed");
                }
              },
            }),
          ])
        ),
    }),
  ]);
}

/**
 * **The list moved below the add-row form, and gained search —
 * decision 0442.** Same reasoning as `supervisorOverridesSection`
 * above, and the same shared `searchableOverrideList()` helper.
 */
function limitOverridesSection(problem) {
  const userPicker = el("select", {}, users.map((u) => el("option", { value: u.id, text: u.name })));
  const unitPicker = el("select", {}, units.map((u) => el("option", { value: u.id, text: u.name })));
  const currencyInput = currencyPicker();
  const amountInput = el("input", { type: "number", min: "0" });
  const addBtn = actionLink("create", {
    primary: true,
    label: t("apsetup.add"),
    onclick: async () => {
      problem.textContent = "";
      const maxAmount = amountInput.value.trim();
      if (!maxAmount) return;
      try {
        const response = await fetch("/api/approval-config/limit-overrides", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userId: userPicker.value,
            unitId: unitPicker.value,
            currency: currencyInput.value.trim(),
            maxAmount: Number(maxAmount),
          }),
        });
        if (!response.ok) {
          problem.textContent = (await response.json()).error ?? t("apsetup.overridesavefailed");
          return;
        }
        await load();
        render();
      } catch {
        problem.textContent = t("apsetup.overridesavefailed");
      }
    },
  });

  return el("div", { class: "panel" }, [
    el("div", { class: "cardhead" }, [
      el("h3", { text: t("apsetup.limitoverrides") }),
      el("div", { class: "statebuttons" }, [addBtn]),
    ]),
    el("p", { class: "muted sm", text: t("apsetup.limitoverridessub") }),
    el("div", { class: "editgrid" }, [
      el("label", { text: t("apsetup.person") }),
      userPicker,
      el("label", { text: t("roles.org") }),
      unitPicker,
      el("label", { text: t("apsetup.limitcurrency") }),
      currencyInput,
      el("label", { text: t("apsetup.limitamount") }),
      amountInput,
    ]),
    ...searchableOverrideList({
      query: limitSearchQuery,
      onQueryChange: (value) => {
        limitSearchQuery = value;
      },
      searchId: "limitoverridesearch",
      hint: t("apsetup.limitoverridesearchhint"),
      items: config.limitOverrides,
      matchText: (o) => `${o.userName} ${o.unitName} ${o.currency} ${o.maxAmount}`,
      emptyText: t("apsetup.nolimitoverrides"),
      nomatchText: t("apsetup.limitoverridenomatch"),
      rowsFor: (shown) =>
        shown.map((o) =>
          el("div", { class: "assignmentrow" }, [
            el("span", { text: `${o.userName} — ${o.unitName} — ${o.currency} ${o.maxAmount}` }),
            el("button", {
              text: t("roles.remove"),
              onclick: async () => {
                problem.textContent = "";
                try {
                  const response = await fetch(
                    `/api/approval-config/limit-overrides/${encodeURIComponent(o.userId)}/${encodeURIComponent(o.unitId)}/${encodeURIComponent(o.currency)}`,
                    { method: "DELETE" }
                  );
                  if (!response.ok) {
                    problem.textContent = (await response.json()).error ?? t("apsetup.overridesavefailed");
                    return;
                  }
                  await load();
                  render();
                } catch {
                  problem.textContent = t("apsetup.overridesavefailed");
                }
              },
            }),
          ])
        ),
    }),
  ]);
}

// **Which dimension a drag started on — decision 0452, the same
// module-level-variable shape `processes.js`'s own `draggedStageId`
// already uses for stage reordering (decision 0352), for the same
// reason: jsdom's own DataTransfer support is incomplete, and drag
// source and drop target are always this one page.
let draggedDimensionId = null;

/**
 * **Cost-Object Priority — decision 0452.** Turns decision 0450's own
 * mock-up (`docs/design/mockups/cost-object-approval.html`) into the
 * real panel: a checkbox and drag-to-reorder per dimension, the same
 * `.assignmentrow` layout and direction-aware drop `processes.js`'s
 * own `stageChevrons()` already established for reordering process
 * stages (decision 0352) — reused rather than the mock-up's own
 * bespoke `.priorow`/`.switch` CSS, which nothing else in this app's
 * real screens has. Calls the new
 * `PUT /approval-config/cost-object-dimensions`
 * (`handleSetCostObjectDimensions`) with the full four-row array every
 * time, the same "replace, not merge" shape `modeForm`'s own doc
 * comment already establishes for this screen's other config forms.
 *
 * **Shown only when Mode is Cost-Object** — the mock-up's own
 * condition, kept: the panel is meaningless in any other mode, since
 * nothing reads `cost_object_dimensions` unless `resolveApprovalTargets`
 * is actually dispatching to `resolveCostObjects`.
 *
 * **"Priority" stays the panel's own name; the sub-copy is what
 * changed.** The mock-up's own wording ("the highest-priority
 * dimension... wins; the rest are not consulted") was written before
 * the operator settled the open question the design doc raised — the
 * real answer, confirmed directly: every enabled, coded dimension
 * raises its own task, in parallel. `sequence` is display order only,
 * exactly as migration 0077's own header comment states; there is
 * deliberately no "walk-through" example here the way the mock-up had
 * one, since a single ordered path is no longer the true story.
 *
 * **Each toggle or reorder saves immediately** — no separate Save
 * button, the same "acts the moment you click it" shape this tab's own
 * override rows already use for Add/Remove.
 */
function costObjectPriorityPanel(problem) {
  if (config.mode !== "cost_object") return null;

  const dimensions = config.costObjectDimensions ?? [];

  const save = async (next) => {
    problem.textContent = "";
    try {
      const response = await fetch("/api/approval-config/cost-object-dimensions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dimensions: next.map((d, i) => ({ listTypeId: d.listTypeId, enabled: d.enabled, sequence: i })),
        }),
      });
      if (!response.ok) {
        problem.textContent = (await response.json()).error ?? t("apsetup.costobjectsavefailed");
        return;
      }
      await load();
      render();
    } catch {
      problem.textContent = t("apsetup.costobjectsavefailed");
    }
  };

  const rows = dimensions.map((dimension, i) => {
    const enableCheckbox = el("input", {
      type: "checkbox",
      id: `costobjectenable-${dimension.listTypeId}`,
      ...(dimension.enabled ? { checked: "checked" } : {}),
    });
    enableCheckbox.onchange = () => {
      const next = dimensions.map((d) => ({ ...d }));
      next[i].enabled = enableCheckbox.checked;
      save(next);
    };

    return el(
      "div",
      {
        class: "assignmentrow",
        draggable: "true",
        ondragstart: () => {
          draggedDimensionId = dimension.listTypeId;
        },
        ondragover: (e) => e.preventDefault(),
        ondrop: (e) => {
          e.preventDefault();
          if (!draggedDimensionId || draggedDimensionId === dimension.listTypeId) return;
          // Direction-aware, the same reasoning `processes.js`'s own
          // stage-reorder drop handler already gives: dropping onto a
          // target reads as "move it to about here."
          const sourceIndex = dimensions.findIndex((d) => d.listTypeId === draggedDimensionId);
          const targetIndex = dimensions.findIndex((d) => d.listTypeId === dimension.listTypeId);
          const dragged = dimensions[sourceIndex];
          const order = dimensions.filter((d) => d.listTypeId !== draggedDimensionId);
          const filteredTargetIndex = order.findIndex((d) => d.listTypeId === dimension.listTypeId);
          const insertAt = sourceIndex < targetIndex ? filteredTargetIndex + 1 : filteredTargetIndex;
          order.splice(insertAt, 0, dragged);
          draggedDimensionId = null;
          save(order);
        },
      },
      [
        el("span", { text: `${i + 1}. ${dimension.name}` }),
        el("label", { for: `costobjectenable-${dimension.listTypeId}`, class: "sm muted", text: t("apsetup.costobjectenable") }),
        enableCheckbox,
      ]
    );
  });

  return el("div", { class: "panel" }, [
    el("div", { class: "cardhead" }, [el("h3", { text: t("apsetup.costobjectpriority") })]),
    el("p", { class: "muted sm", text: t("apsetup.costobjectprioritysub") }),
    el("div", { class: "assignmentlist" }, rows),
  ]);
}

function approvalHierarchyTab() {
  const problem = el("div", { class: "warn" });
  const priorityPanel = costObjectPriorityPanel(problem);
  return el("div", {}, [
    modeForm(problem),
    ...(priorityPanel ? [priorityPanel] : []),
    supervisorOverridesSection(problem),
    limitOverridesSection(problem),
  ]);
}

function tabBar() {
  return el(
    "div",
    { class: "tabbar" },
    TABS.map((tab) =>
      el("button", {
        class: `tab${activeTab === tab.key ? " active" : ""}`,
        text: t(tab.labelKey),
        onclick: () => {
          activeTab = tab.key;
          render();
        },
      })
    )
  );
}

function render() {
  const shell = document.getElementById("shell");
  if (!shell) return;

  if (!activeTab) activeTab = TABS[0].key;

  const activeSection = {
    matching: () => matchingConfigTab(el("div", { class: "warn" })),
    coding: () =>
      accountCodingTab({
        units,
        users,
        costCentreNames,
        rerender: render,
      }),
    approvalhierarchy: () => approvalHierarchyTab(),
  }[activeTab]();

  shell.replaceChildren(
    frame(
      el("div", {}, [
        topbar(t("nav.apsetup"), t("apsetup.subtitle")),
        tabBar(),
        activeSection,
      ])
    )
  );
}

function renderLoadFailed() {
  const shell = document.getElementById("shell");
  if (!shell) return;

  shell.replaceChildren(
    frame(
      el("div", {}, [
        topbar(t("nav.apsetup"), t("apsetup.subtitle")),
        el("p", { class: "problem", role: "status", text: t("apsetup.loadfailed") }),
      ])
    )
  );
}

export async function open() {
  setCurrentScreen("apsetup");
  if (!hasMyPermission("Admin.Configure") || !(await load())) {
    renderLoadFailed();
    return;
  }
  render();
}
