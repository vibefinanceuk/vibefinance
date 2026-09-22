import { t } from "/strings.js";
import { el } from "/tasks.js";
import { actionLink } from "/viewer.js";

/**
 * Account Coding — decision 0444.
 *
 * *"Cost-Center Lists should be maintained under the Account Coding
 * tab, with other valid coding lists. This would include Company code
 * (Org), Cost-Center; Project, Commodity Code, General Ledger Code for
 * example."* Five example CSV exports followed, all sharing one shape
 * (`ID, Path, Default, Approver, Parent List ID, Parent Entry ID`, plus
 * dynamic "Filter by - X" columns) — see migration 0076's own header
 * comment for the full reasoning behind the generic backend this tab
 * is built on.
 *
 * **Company code stays read-only here** — already fully managed via
 * Access → Org Units, not duplicated into a second screen. **Cost
 * Centre keeps its own existing table and routes** (decision 0031),
 * gaining only what this decision adds: a real management screen (none
 * existed before) and its own "Filter by company code" support.
 * **Project, Commodity Code, and General Ledger Code** are the three
 * genuinely greenfield lists, sharing one generic CRUD
 * (`coding-list-route.ts`).
 *
 * **Manageable lists only** — the same declined scope decisions 0023/
 * 0024/0031 already established. Nothing here is wired into rule
 * validation, invoice-line capture, or BT-code mapping, and there is
 * deliberately no delete here yet, matching Cost Centre's own existing
 * precedent of create-and-edit without a remove path.
 *
 * **"Approver," not "Owner," in this screen's own words** — the
 * operator's own example lists call every one of the five lists'
 * equivalent column "Approver," including Cost Centre's own CSV. The
 * field behind it is `cost_centres.owner_user_id` for that one list
 * and `coding_list_entries.approver_user_id` for the other three —
 * different columns, same word on screen, matching the operator's own
 * vocabulary rather than this app's internal naming.
 */

const CODING_TABS = [
  { key: "company_code", labelKey: "apsetup.codingtab.companycode" },
  { key: "cost_centre", labelKey: "apsetup.codingtab.costcentre" },
  { key: "project", labelKey: "apsetup.codingtab.project" },
  { key: "commodity_code", labelKey: "apsetup.codingtab.commoditycode" },
  { key: "gl_code", labelKey: "apsetup.codingtab.glcode" },
];

let activeCodingTab = "company_code";

/**
 * **How deep an entry sits**, walking its own parent chain within the
 * same list — the same "indented list, not an invented tree widget"
 * choice `access.js`'s own `unitDepth()` already makes for org units.
 */
function entryDepth(entries, entry, parentKey) {
  let depth = 0;
  let current = entry;
  const seen = new Set();
  while (current?.[parentKey] && !seen.has(current[parentKey])) {
    seen.add(current[parentKey]);
    current = entries.find((e) => e.id === current[parentKey]);
    depth++;
  }
  return depth;
}

function section(titleKey, subKey, emptyKey, headers, rows, headerAction) {
  return el("div", { class: "panel" }, [
    el("div", { class: "cardhead" }, [el("h3", { text: t(titleKey) }), ...(headerAction ? [el("div", { class: "statebuttons" }, [headerAction])] : [])]),
    ...(subKey ? [el("p", { class: "muted sm", text: t(subKey) })] : []),
    rows.length > 0
      ? el("div", { class: "tablewrap" }, [
          el("table", {}, [
            el("thead", {}, [el("tr", {}, headers.map((h) => el("th", { text: t(h) })))]),
            el("tbody", {}, rows),
          ]),
        ])
      : el("p", { class: "muted", text: t(emptyKey) }),
  ]);
}

function companyCodeTab(units) {
  return section(
    "apsetup.codingtab.companycode",
    "apsetup.codingcompanycodesub",
    "apsetup.nocompanycodes",
    ["apsetup.codingid", "apsetup.codingname"],
    units.map((u) => el("tr", {}, [el("td", { text: u.id }), el("td", { text: u.name })]))
  );
}

/**
 * **The Cost Centre form — decision 0444.** Create stays minimal (id +
 * name), the same shape `handleCreateCostCentre` already had before
 * this decision (decision 0031) — not widened, since that route is
 * shared with whatever else already calls it. Every other field
 * (parent, approver, approval limit, company code) is set by editing
 * the cost centre afterwards, through `handleUpdateCostCentre`.
 */
function openCostCentreForm(existing, { costCentres, units, users, onSaved }) {
  const problem = el("div", { class: "warn" });
  const idInput = existing
    ? el("input", { type: "text", value: existing.id, disabled: "disabled" })
    : el("input", { type: "text" });
  const nameInput = existing
    ? el("input", { type: "text", value: existing.name, disabled: "disabled" })
    : el("input", { type: "text" });

  const formRows = [
    el("label", { text: t("apsetup.codingid") }),
    idInput,
    el("label", { text: t("apsetup.codingname") }),
    nameInput,
  ];

  let parentPicker, approverPicker, limitInput, companyCodePicker;
  if (existing) {
    parentPicker = el("select", {}, [
      el("option", { value: "", text: t("roles.none") }),
      ...costCentres
        .filter((c) => c.id !== existing.id)
        .map((c) => el("option", { value: c.id, text: c.name, ...(c.id === existing.parentCostCentreId ? { selected: "selected" } : {}) })),
    ]);
    approverPicker = el("select", {}, [
      el("option", { value: "", text: t("roles.none") }),
      ...users.map((u) => el("option", { value: u.id, text: u.name, ...(u.id === existing.ownerUserId ? { selected: "selected" } : {}) })),
    ]);
    limitInput = el("input", { type: "number", min: "0", value: existing.approvalLimit ?? "" });
    const currentCompanyCode = existing.filters.find((f) => f.filterListTypeId === "company_code")?.filterEntryId ?? "";
    companyCodePicker = el("select", {}, [
      el("option", { value: "", text: t("roles.none") }),
      ...units.map((u) => el("option", { value: u.id, text: u.name, ...(u.id === currentCompanyCode ? { selected: "selected" } : {}) })),
    ]);
    formRows.push(
      el("label", { text: t("apsetup.codingparent") }),
      parentPicker,
      el("label", { text: t("apsetup.codingapprover") }),
      approverPicker,
      el("label", { text: t("apsetup.codingapprovallimit") }),
      limitInput,
      el("label", { text: t("apsetup.codingtab.companycode") }),
      companyCodePicker
    );
  }

  const close = () => backdrop.remove();
  const save = actionLink(existing ? "save" : "create", {
    primary: true,
    onclick: async () => {
      problem.textContent = "";
      try {
        let response;
        if (!existing) {
          const id = idInput.value.trim();
          const name = nameInput.value.trim();
          if (!id || !name) {
            problem.textContent = t("apsetup.codingentrysavefailed");
            return;
          }
          response = await fetch("/api/org/cost-centres", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, name }),
          });
        } else {
          const limit = limitInput.value.trim();
          response = await fetch(`/api/cost-centres/${encodeURIComponent(existing.id)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              parentCostCentreId: parentPicker.value || null,
              ownerUserId: approverPicker.value || null,
              approvalLimit: limit === "" ? null : Number(limit),
              filters: { company_code: companyCodePicker.value || null },
            }),
          });
        }
        if (!response.ok) {
          problem.textContent = (await response.json()).error ?? t("apsetup.codingentrysavefailed");
          return;
        }
        backdrop.remove();
        await onSaved();
      } catch {
        problem.textContent = t("apsetup.codingentrysavefailed");
      }
    },
  });

  const backdrop = el("div", { class: "backdrop" }, [
    el("div", { class: "popout" }, [
      el("div", { class: "cardhead" }, [
        el("h3", { text: existing ? existing.name : t("apsetup.codingtab.costcentre") }),
        el("div", { class: "statebuttons" }, [save, actionLink("close", { onclick: close })]),
      ]),
      el("div", { class: "editgrid" }, formRows),
      problem,
    ]),
  ]);
  backdrop.onclick = (e) => {
    if (e.target === backdrop) backdrop.remove();
  };
  document.body.append(backdrop);
  (existing ? null : idInput)?.focus();
}

function costCentreRow(costCentre, costCentres, onClick) {
  // **The server's own resolved name, not recomputed here** —
  // `handleListCostCentresDetailed` already joins to `parentName`, and
  // a parent set on this cost centre may not even be among the rows
  // this table currently holds if pagination is ever added later.
  const parentName = costCentre.parentName ?? "—";
  const companyCode = costCentre.filters.find((f) => f.filterListTypeId === "company_code")?.filterEntryName ?? "—";
  const row = el("tr", { class: "clickable" }, [
    el("td", {}, [el("span", { style: `padding-left: ${entryDepth(costCentres, costCentre, "parentCostCentreId") * 20}px`, text: costCentre.name })]),
    el("td", { class: "muted", text: parentName }),
    el("td", { class: "muted", text: costCentre.ownerName ?? "—" }),
    el("td", { class: "muted", text: costCentre.approvalLimit ?? "—" }),
    el("td", { class: "muted", text: companyCode }),
  ]);
  row.onclick = onClick;
  return row;
}

function costCentreTab(costCentres, units, users, refresh) {
  return section(
    "apsetup.codingtab.costcentre",
    "apsetup.codingcostcentresub",
    "apsetup.nocostcentres",
    ["apsetup.codingname", "apsetup.codingparent", "apsetup.codingapprover", "apsetup.codingapprovallimit", "apsetup.codingtab.companycode"],
    costCentres.map((c) =>
      costCentreRow(c, costCentres, () => openCostCentreForm(c, { costCentres, units, users, onSaved: refresh }))
    ),
    actionLink("create", {
      primary: true,
      label: t("apsetup.add"),
      onclick: () => openCostCentreForm(null, { costCentres, units, users, onSaved: refresh }),
    })
  );
}

/**
 * **The generic form — decision 0444.** Project, Commodity Code, and
 * General Ledger Code all share it, driven by `declaredFilters`
 * (`coding-list-route.ts`'s own `/coding-lists/:type` response) so a
 * GL Code entry gets a Company code AND a Commodity Code picker, a
 * Project entry gets neither, without three near-identical forms.
 */
function openCodingEntryForm(listType, listLabelKey, existing, { entries, declaredFilters, users, filterSources, onSaved }) {
  const problem = el("div", { class: "warn" });
  const idInput = existing
    ? el("input", { type: "text", value: existing.id, disabled: "disabled" })
    : el("input", { type: "text" });
  const nameInput = el("input", { type: "text", value: existing?.name ?? "" });
  const parentPicker = el("select", {}, [
    el("option", { value: "", text: t("roles.none") }),
    ...entries
      .filter((e) => e.id !== existing?.id)
      .map((e) => el("option", { value: e.id, text: e.name, ...(e.id === existing?.parentEntryId ? { selected: "selected" } : {}) })),
  ]);
  const defaultCheckbox = el("input", { type: "checkbox", ...(existing?.isDefault ? { checked: "checked" } : {}) });
  const approverPicker = el("select", {}, [
    el("option", { value: "", text: t("roles.none") }),
    ...users.map((u) => el("option", { value: u.id, text: u.name, ...(u.id === existing?.approverUserId ? { selected: "selected" } : {}) })),
  ]);

  const formRows = [
    el("label", { text: t("apsetup.codingid") }),
    idInput,
    el("label", { text: t("apsetup.codingname") }),
    nameInput,
    el("label", { text: t("apsetup.codingparent") }),
    parentPicker,
    el("label", { text: t("apsetup.codingdefault") }),
    defaultCheckbox,
    el("label", { text: t("apsetup.codingapprover") }),
    approverPicker,
  ];

  const filterPickers = {};
  for (const filterListTypeId of declaredFilters) {
    const source = filterSources[filterListTypeId] ?? [];
    const currentValue = existing?.filters.find((f) => f.filterListTypeId === filterListTypeId)?.filterEntryId ?? "";
    const picker = el("select", {}, [
      el("option", { value: "", text: t("roles.none") }),
      ...source.map((s) => el("option", { value: s.id, text: s.name, ...(s.id === currentValue ? { selected: "selected" } : {}) })),
    ]);
    filterPickers[filterListTypeId] = picker;
    formRows.push(el("label", { text: t(`apsetup.codingtab.${filterListTypeId === "company_code" ? "companycode" : "commoditycode"}`) }), picker);
  }

  const close = () => backdrop.remove();
  const save = actionLink(existing ? "save" : "create", {
    primary: true,
    onclick: async () => {
      problem.textContent = "";
      const name = nameInput.value.trim();
      const filters = {};
      for (const [filterListTypeId, picker] of Object.entries(filterPickers)) {
        filters[filterListTypeId] = picker.value || null;
      }
      try {
        const response = existing
          ? await fetch(`/api/coding-lists/${encodeURIComponent(listType)}/${encodeURIComponent(existing.id)}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                name,
                parentEntryId: parentPicker.value || null,
                isDefault: defaultCheckbox.checked,
                approverUserId: approverPicker.value || null,
                filters,
              }),
            })
          : await fetch(`/api/coding-lists/${encodeURIComponent(listType)}`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                id: idInput.value.trim(),
                name,
                parentEntryId: parentPicker.value || null,
                isDefault: defaultCheckbox.checked,
                approverUserId: approverPicker.value || null,
                filters,
              }),
            });
        if (!response.ok) {
          problem.textContent = (await response.json()).error ?? t("apsetup.codingentrysavefailed");
          return;
        }
        backdrop.remove();
        await onSaved();
      } catch {
        problem.textContent = t("apsetup.codingentrysavefailed");
      }
    },
  });

  const backdrop = el("div", { class: "backdrop" }, [
    el("div", { class: "popout" }, [
      el("div", { class: "cardhead" }, [
        el("h3", { text: existing ? existing.name : t(listLabelKey) }),
        el("div", { class: "statebuttons" }, [save, actionLink("close", { onclick: close })]),
      ]),
      el("div", { class: "editgrid" }, formRows),
      problem,
    ]),
  ]);
  backdrop.onclick = (e) => {
    if (e.target === backdrop) backdrop.remove();
  };
  document.body.append(backdrop);
  (existing ? nameInput : idInput).focus();
}

function codingEntryRow(entries, entry, declaredFilters, onClick) {
  const cells = [
    el("td", {}, [el("span", { style: `padding-left: ${entryDepth(entries, entry, "parentEntryId") * 20}px`, text: entry.name })]),
    el("td", { class: "muted", text: entry.parentName ?? "—" }),
    el("td", { class: "muted", text: entry.approverName ?? "—" }),
    el("td", { class: "muted", text: entry.isDefault ? t("roles.yes") : "—" }),
  ];
  for (const filterListTypeId of declaredFilters) {
    cells.push(el("td", { class: "muted", text: entry.filters.find((f) => f.filterListTypeId === filterListTypeId)?.filterEntryName ?? "—" }));
  }
  const row = el("tr", { class: "clickable" }, cells);
  row.onclick = onClick;
  return row;
}

function codingListTab(listType, titleKey, subKey, emptyKey, { entries, declaredFilters, users, filterSources, refresh }) {
  const headers = ["apsetup.codingname", "apsetup.codingparent", "apsetup.codingapprover", "apsetup.codingdefault"];
  for (const filterListTypeId of declaredFilters) {
    headers.push(`apsetup.codingtab.${filterListTypeId === "company_code" ? "companycode" : "commoditycode"}`);
  }
  return section(
    titleKey,
    subKey,
    emptyKey,
    headers,
    entries.map((entry) =>
      codingEntryRow(entries, entry, declaredFilters, () =>
        openCodingEntryForm(listType, titleKey, entry, { entries, declaredFilters, users, filterSources, onSaved: refresh })
      )
    ),
    actionLink("create", {
      primary: true,
      label: t("apsetup.add"),
      onclick: () => openCodingEntryForm(listType, titleKey, null, { entries, declaredFilters, users, filterSources, onSaved: refresh }),
    })
  );
}

function codingSubTabBar(rerender) {
  return el(
    "div",
    { class: "tabbar" },
    CODING_TABS.map((tab) =>
      el("button", {
        class: `tab${activeCodingTab === tab.key ? " active" : ""}`,
        text: t(tab.labelKey),
        onclick: () => {
          activeCodingTab = tab.key;
          rerender();
        },
      })
    )
  );
}

/**
 * The Account Coding tab's own content — called from `ap-setup.js`'s
 * own `render()`, with everything it needs already loaded there (one
 * fetch, one render, the same shape the rest of that screen already
 * uses).
 */
export function accountCodingTab({ units, users, costCentres, codingLists, refresh, rerender }) {
  /**
   * **Read from the server's own response, not duplicated here** —
   * `coding-list-route.ts`'s own `/coding-lists/:type` already returns
   * `declaredFilters` (`coding_list_type_filters`, migration 0076's
   * own seed data), so this tab shows exactly what the backend
   * actually declares rather than a second copy that could drift.
   */
  const declaredFiltersByType = {
    project: codingLists.project.declaredFilters ?? [],
    commodity_code: codingLists.commodity_code.declaredFilters ?? [],
    gl_code: codingLists.gl_code.declaredFilters ?? [],
  };
  const filterSources = {
    company_code: units,
    commodity_code: codingLists.commodity_code.entries,
  };

  const activeSection = {
    company_code: () => companyCodeTab(units),
    cost_centre: () => costCentreTab(costCentres, units, users, refresh),
    project: () =>
      codingListTab("project", "apsetup.codingtab.project", "apsetup.codingprojectsub", "apsetup.noprojects", {
        entries: codingLists.project.entries,
        declaredFilters: declaredFiltersByType.project,
        users,
        filterSources,
        refresh,
      }),
    commodity_code: () =>
      codingListTab("commodity_code", "apsetup.codingtab.commoditycode", "apsetup.codingcommoditycodesub", "apsetup.nocommoditycodes", {
        entries: codingLists.commodity_code.entries,
        declaredFilters: declaredFiltersByType.commodity_code,
        users,
        filterSources,
        refresh,
      }),
    gl_code: () =>
      codingListTab("gl_code", "apsetup.codingtab.glcode", "apsetup.codingglcodesub", "apsetup.noglcodes", {
        entries: codingLists.gl_code.entries,
        declaredFilters: declaredFiltersByType.gl_code,
        users,
        filterSources,
        refresh,
      }),
  }[activeCodingTab]();

  return el("div", {}, [codingSubTabBar(rerender), activeSection]);
}
