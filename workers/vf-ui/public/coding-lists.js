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
 *
 * **CSV Template and Load — decision 0445.** *"Similar to how we have
 * done for Loading purchase orders."* Cost Centre, Project, Commodity
 * Code, and General Ledger Code only — Company code stays read-only,
 * confirmed directly with the operator (it is `org_units`, generated
 * from the org structure). The exact same mechanism as `purchase-
 * orders.js`'s own loader: a Template button that builds a CSV purely
 * from the server's own `GET .../csv-format` (never a hand-maintained
 * second copy of what the parser accepts), a Load button that posts
 * the chosen file's raw text, and an outcome panel reporting what
 * loaded and what was refused, per row. `.csvformat`, not `.poformat`
 * — the disclosure's own CSS was renamed alongside this decision so a
 * generic style rule no longer carries one feature's own name.
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

const CSV_LIST_TYPES = ["cost_centre", "project", "commodity_code", "gl_code"];

/**
 * **Fetched once, at screen open** — the same discipline `purchase-
 * orders.js`'s own `loadFormat()` already established: by the time any
 * tab's own loader panel renders, `csvFormats[type]` is already in its
 * final state (a real format, or `null` on failure), so nothing here
 * needs to react to a later state change. Called from `ap-setup.js`'s
 * own `load()` alongside everything else that screen fetches.
 */
let csvFormats = {};

export async function loadCodingListCsvFormats() {
  const results = await Promise.all(
    CSV_LIST_TYPES.map(async (listType) => {
      try {
        const response = await fetch(`/api/coding-lists/${listType}/csv-format`);
        return [listType, response.ok ? await response.json() : null];
      } catch {
        return [listType, null];
      }
    })
  );
  csvFormats = Object.fromEntries(results);
}

/**
 * A ready-to-fill CSV, built purely from the recommended (first-listed)
 * column of every field the format describes — mirrors `purchase-
 * orders.js`'s own `downloadTemplate()` exactly.
 */
function downloadCsvTemplate(listType) {
  const format = csvFormats[listType];
  if (!format) return;
  const csv = format.fields.map((f) => f.columns[0]).join(",") + "\n";
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const anchor = el("a", { href: url, download: `${listType}-template.csv` });
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

function csvFieldRow(spec) {
  return el("tr", {}, [
    el("td", { text: spec.key }),
    el("td", { class: "muted", text: spec.columns.join(", ") }),
    el("td", { text: spec.required ? t("apsetup.csvrequired") : "—" }),
  ]);
}

/** Fetched once at screen open, so opening this disclosure costs nothing further — no per-expand fetch. */
function csvFormatReference(listType) {
  const format = csvFormats[listType];
  if (!format) return el("div", {});
  return el("details", { class: "csvformat" }, [
    el("summary", { text: t("apsetup.csvviewformat") }),
    el("div", { class: "tablewrap" }, [
      el("table", {}, [
        el("thead", {}, [
          el("tr", {}, [
            el("th", { text: t("apsetup.csvfieldname") }),
            el("th", { text: t("apsetup.csvacceptedcolumns") }),
            el("th", { text: t("apsetup.csvrequired") }),
          ]),
        ]),
        el("tbody", {}, format.fields.map(csvFieldRow)),
      ]),
    ]),
  ]);
}

/** What a load did — mirrors `purchase-orders.js`'s own `outcome()`, refused rows keyed by id rather than order number. */
function csvOutcome(result) {
  const lines = [
    el("div", { text: t("apsetup.csventriescreated").replace("{n}", String(result.entriesCreated)) }),
    el("div", { class: "muted", text: t("apsetup.csventriesupdated").replace("{n}", String(result.entriesUpdated)) }),
  ];
  if (result.refused?.length > 0) {
    lines.push(el("h3", { text: t("apsetup.csvrefusedheading") }));
    for (const row of result.refused.slice(0, 20)) {
      lines.push(
        el("div", {
          class: "warn",
          text: t("apsetup.csvrefusedentry").replace("{id}", row.id).replace("{reason}", row.reason),
        })
      );
    }
    if (result.refused.length > 20) {
      lines.push(el("div", { class: "muted", text: t("apsetup.csvrefusedmore").replace("{n}", String(result.refused.length - 20)) }));
    }
  }
  return el("div", { class: "panel" }, lines);
}

/**
 * **The loader panel itself** — one per list type, placed above that
 * list's own table. Template + Load, top-right of its own card (the
 * same title-left/action-right shape `.cardhead` already gives every
 * other card on this screen), a bare file input, and the format
 * disclosure below — mirrors `purchase-orders.js`'s own `loader()`
 * almost line for line.
 */
function csvLoaderPanel(listType, refresh) {
  // **Found by id after `refresh()`, not held as a closure reference**
  // — the same fix `purchase-orders.js`'s own `runLoad()` already
  // applies: `refresh()` calls `render()`, which replaces the whole
  // screen and detaches this panel's own DOM entirely, including
  // whatever local variable pointed at its note box. A stale reference
  // would still accept `.replaceChildren()` without error — it would
  // just never be seen, since it is no longer part of the document.
  const noteId = `codingcsvnote-${listType}`;
  const noteBox = el("div", { class: "muted sm", id: noteId });
  const picker = el("input", { type: "file", accept: ".csv,text/csv" });
  const loadButton = actionLink("load", { primary: true, onclick: () => runLoad(), label: t("apsetup.csvloadbutton") });

  function note(message) {
    const box = document.getElementById(noteId);
    if (box) box.textContent = message ?? "";
  }

  async function runLoad() {
    const file = picker.files?.[0];
    if (!file) {
      note(t("apsetup.csvnofile"));
      return;
    }
    loadButton.disabled = true;

    // One try per thing that can fail, not one around everything —
    // decision 0216, the same discipline `purchase-orders.js`'s own
    // loader already follows.
    let response;
    try {
      response = await fetch(`/api/coding-lists/${encodeURIComponent(listType)}/csv-load`, {
        method: "POST",
        headers: { "Content-Type": "text/csv" },
        body: await file.text(),
      });
    } catch {
      note(t("apsetup.csvloadfailed"));
      loadButton.disabled = false;
      return;
    }

    try {
      const body = await response.json();
      if (!response.ok) {
        note(body.error);
        return;
      }
      await refresh();
      const box = document.getElementById(noteId);
      if (box) box.replaceChildren(csvOutcome(body));
    } catch (err) {
      note(`${t("apsetup.csvloadbroke")} ${err?.message ?? ""}`);
    } finally {
      loadButton.disabled = false;
    }
  }

  const templateButton = actionLink("download", { onclick: () => downloadCsvTemplate(listType), label: t("apsetup.csvtemplatebutton") });
  // csvFormats is already in its final state by the time this panel
  // renders — ap-setup.js's own open() awaits loadCodingListCsvFormats()
  // before ever calling render().
  templateButton.disabled = !csvFormats[listType];

  return el("div", { class: "panel" }, [
    el("div", { class: "cardhead" }, [
      el("h3", { text: t("apsetup.csvloadheading") }),
      el("div", { class: "statebuttons" }, [templateButton, loadButton]),
    ]),
    el("p", { class: "muted sm", text: t("apsetup.csvloadhelp") }),
    picker,
    noteBox,
    csvFormatReference(listType),
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
    cost_centre: () => el("div", {}, [csvLoaderPanel("cost_centre", refresh), costCentreTab(costCentres, units, users, refresh)]),
    project: () =>
      el("div", {}, [
        csvLoaderPanel("project", refresh),
        codingListTab("project", "apsetup.codingtab.project", "apsetup.codingprojectsub", "apsetup.noprojects", {
          entries: codingLists.project.entries,
          declaredFilters: declaredFiltersByType.project,
          users,
          filterSources,
          refresh,
        }),
      ]),
    commodity_code: () =>
      el("div", {}, [
        csvLoaderPanel("commodity_code", refresh),
        codingListTab("commodity_code", "apsetup.codingtab.commoditycode", "apsetup.codingcommoditycodesub", "apsetup.nocommoditycodes", {
          entries: codingLists.commodity_code.entries,
          declaredFilters: declaredFiltersByType.commodity_code,
          users,
          filterSources,
          refresh,
        }),
      ]),
    gl_code: () =>
      el("div", {}, [
        csvLoaderPanel("gl_code", refresh),
        codingListTab("gl_code", "apsetup.codingtab.glcode", "apsetup.codingglcodesub", "apsetup.noglcodes", {
          entries: codingLists.gl_code.entries,
          declaredFilters: declaredFiltersByType.gl_code,
          users,
          filterSources,
          refresh,
        }),
      ]),
  }[activeCodingTab]();

  return el("div", {}, [codingSubTabBar(rerender), activeSection]);
}
