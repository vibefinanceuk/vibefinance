import { t } from "/strings.js";
import { el, frame, topbar, setCurrentScreen, hasMyPermission } from "/tasks.js";
import { actionLink } from "/viewer.js";
import { currencyPicker } from "/access.js";

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
 * **Matching and Account Coding are real placeholder tabs**, the same
 * shape `ap-analytics.js`'s own `placeholderCard()` already gives an
 * unbuilt tab — both are genuinely greenfield (decision 0439's own
 * "What is not built" section), not a screen deferred by mistake.
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
let activeTab = null;

async function load() {
  try {
    const [overviewResponse, configResponse] = await Promise.all([
      fetch("/api/org/overview"),
      fetch("/api/approval-config"),
    ]);
    if (!overviewResponse.ok || !configResponse.ok) {
      console.error(`AP Setup load failed: overview ${overviewResponse.status}, config ${configResponse.status}`);
      return false;
    }
    const overview = await overviewResponse.json();
    units = overview.units ?? [];
    users = overview.users ?? [];
    config = await configResponse.json();
    return true;
  } catch (err) {
    console.error("AP Setup load failed", err);
    return false;
  }
}

function placeholderCard(labelKey) {
  return el("div", { class: "panel" }, [
    el("div", { class: "cardhead" }, [el("h3", { text: t(labelKey) })]),
    el("p", { class: "muted", text: t("apsetup.notbuilt") }),
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
 * **One unit-scoped override at a time — decision 0440.** Same
 * "inline picker row plus its own Add button" shape `openTeamForm`'s
 * own member picker already uses, rather than a second pop-out
 * component for what is, per row, three fields.
 */
function supervisorOverridesSection(problem) {
  const rows =
    config.supervisorOverrides.length > 0
      ? config.supervisorOverrides.map((o) =>
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
        )
      : [el("p", { class: "muted", text: t("apsetup.nosupervisoroverrides") })];

  const userPicker = el("select", {}, users.map((u) => el("option", { value: u.id, text: u.name })));
  const unitPicker = el("select", {}, units.map((u) => el("option", { value: u.id, text: u.name })));
  const supervisorPicker = el("select", {}, users.map((u) => el("option", { value: u.id, text: u.name })));
  const addBtn = el("button", {
    text: t("apsetup.add"),
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
    el("div", { class: "cardhead" }, [el("h3", { text: t("apsetup.supervisoroverrides") })]),
    el("p", { class: "muted sm", text: t("apsetup.supervisoroverridessub") }),
    el("div", { class: "assignmentlist" }, rows),
    el("div", { class: "editgrid" }, [
      el("label", { text: t("apsetup.person") }),
      userPicker,
      el("label", { text: t("roles.org") }),
      unitPicker,
      el("label", { text: t("apsetup.supervisor") }),
      supervisorPicker,
    ]),
    el("div", { class: "memberpickerrow" }, [addBtn]),
  ]);
}

function limitOverridesSection(problem) {
  const rows =
    config.limitOverrides.length > 0
      ? config.limitOverrides.map((o) =>
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
        )
      : [el("p", { class: "muted", text: t("apsetup.nolimitoverrides") })];

  const userPicker = el("select", {}, users.map((u) => el("option", { value: u.id, text: u.name })));
  const unitPicker = el("select", {}, units.map((u) => el("option", { value: u.id, text: u.name })));
  const currencyInput = currencyPicker();
  const amountInput = el("input", { type: "number", min: "0" });
  const addBtn = el("button", {
    text: t("apsetup.add"),
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
    el("div", { class: "cardhead" }, [el("h3", { text: t("apsetup.limitoverrides") })]),
    el("p", { class: "muted sm", text: t("apsetup.limitoverridessub") }),
    el("div", { class: "assignmentlist" }, rows),
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
    el("div", { class: "memberpickerrow" }, [addBtn]),
  ]);
}

function approvalHierarchyTab() {
  const problem = el("div", { class: "warn" });
  return el("div", {}, [modeForm(problem), supervisorOverridesSection(problem), limitOverridesSection(problem)]);
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
    matching: () => placeholderCard("apsetup.matching"),
    coding: () => placeholderCard("apsetup.coding"),
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
