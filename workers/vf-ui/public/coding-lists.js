import { t } from "/strings.js";
import { el } from "/tasks.js";
import { actionLink } from "/viewer.js";
import { icon } from "/icons.js";

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
 *
 * **Search and real pagination — decision 0446.** *"I would like to
 * see the table for... the new tables in the AP Setup, Account Coding
 * tab to support pagination, and search in a similar way that the
 * purchase orders and supplier pages do."* Cost Centre, Project,
 * Commodity Code, and General Ledger Code again — Company code stays
 * the same short, read-only reference list it always was, with
 * nothing to page through. Each of the four tables now owns its own
 * search term, page, and page size, pushed to the database exactly
 * the way `purchase-orders.js`'s own `searchAndPaginationRow` already
 * does (decision 0376) — reusing that same row's own generic strings
 * (`purchaseorders.rows`, `.firstpage`, `.previouspage`, `.nextpage`,
 * `.lastpage`, `.rangeof`) rather than four new, identically-worded
 * copies.
 *
 * **This module now owns that state itself**, rather than `ap-setup.js`
 * loading everything up front and handing it down as props — the same
 * shift `purchase-orders.js` and `suppliers.js` made when their own
 * pagination arrived, since paging or searching one table must no
 * longer mean re-fetching (or re-rendering) the whole screen.
 * `loadAccountCodingTables()` seeds page one of all four on screen
 * open, called from `ap-setup.js`'s own `load()` alongside
 * `loadCodingListCsvFormats()`; every later page, search, or page-size
 * change re-fetches and redraws only that one table, in place, via a
 * stable container id (`accountCodingRoot()`'s own `#codingactivetab`)
 * — the same "found by id, not held as a stale reference" discipline
 * `csvLoaderPanel`'s own note box already established, applied here to
 * a whole section rather than one element.
 *
 * **The indent-by-depth on Project's own hierarchy is gone.** A flat,
 * paged table can split a parent from its child across two different
 * pages, and `entryDepth()`'s own walk — confined to whatever page
 * happened to load — would then report a wrong depth rather than the
 * true one: better no indent than a confidently wrong one. The
 * existing "Parent" column, already sourced from the server's own
 * resolved name rather than a client-side lookup, is unaffected either
 * way and stays the accurate answer to "whose child is this."
 *
 * **A create or edit form's own pickers (parent; General Ledger
 * Code's Commodity Code filter) still need every entry, not a page of
 * them** — fetched lazily, fresh, right before that form opens
 * (`?all=1`, `handleListCodingListEntries`'s own bypass), rather than
 * kept fully loaded for the whole screen visit the way the table used
 * to be. Cost Centre's own parent picker instead reads `/org/overview`'s
 * pre-existing lightweight `costCentres` list (`{id, name}`, already
 * fetched for other pickers across the app) — nothing new to fetch
 * there at all, now that the table itself no longer needs to double as
 * that picker's own data source.
 *
 * **Approval Limit — decision 0452, the mock-up's own proposed column,
 * now real.** Project, Commodity Code, and General Ledger Code gain
 * the same field Cost Centre's own table and form have carried since
 * 0444 — `coding-list-route.ts`'s own `EntryBody.approvalLimit`, always
 * sent alongside the approver in the same request (this form, unlike
 * Cost Centre's, already shows every field in both create and edit),
 * so the route's own "a limit needs an owner in the same call" rule
 * never surprises this screen. Reuses `apsetup.codingapprovallimit` —
 * Cost Centre's own existing string — rather than a second copy of the
 * same word.
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
 * Per-list-type table state — decision 0446. `PAGINATED_LIST_TYPES` is
 * Cost Centre plus the three generic lists; Company code has neither
 * an entry here nor a table endpoint to page through.
 */
const PAGINATED_LIST_TYPES = ["cost_centre", "project", "commodity_code", "gl_code"];
const PAGE_SIZES = [25, 50, 100, 200];

function freshTableState() {
  return { search: "", page: 1, pageSize: 50, total: 0, rows: [], declaredFilters: [] };
}

let tableState = Object.fromEntries(PAGINATED_LIST_TYPES.map((listType) => [listType, freshTableState()]));

/**
 * `units`/`users` (from `/org/overview`), stashed here the first time
 * `accountCodingTab()` runs — needed by `reloadTable()`'s own targeted
 * redraw of one tab, which happens without `ap-setup.js` ever calling
 * back into this module with fresh props.
 */
let cachedUnits = [];
let cachedUsers = [];
let cachedCostCentreNames = [];

function endpointFor(listType) {
  return listType === "cost_centre" ? "/api/org/cost-centres" : `/api/coding-lists/${listType}`;
}

/**
 * One table's own page, from the database — decision 0446, the same
 * `search`/`page`/`pageSize` request shape `purchase-orders.js`'s own
 * `load()` already sends (decision 0376).
 */
async function loadTable(listType) {
  const state = tableState[listType];
  try {
    const params = new URLSearchParams();
    if (state.search) params.set("search", state.search);
    params.set("page", String(state.page));
    params.set("pageSize", String(state.pageSize));
    const response = await fetch(`${endpointFor(listType)}?${params}`);
    if (!response.ok) return false;
    const body = await response.json();
    state.rows = listType === "cost_centre" ? body.costCentres ?? [] : body.entries ?? [];
    state.declaredFilters = body.declaredFilters ?? [];
    // Read back from the response, not assumed from what was sent —
    // the route itself clamps an out-of-range page or an unlisted
    // page size to a real default (`purchase-orders.js`'s own
    // load() makes the identical point).
    state.total = body.total ?? 0;
    state.page = body.page ?? state.page;
    state.pageSize = body.pageSize ?? state.pageSize;
    return true;
  } catch {
    return false;
  }
}

/**
 * Every entry of one list, unpaginated — decision 0446, fetched fresh
 * right before a create/edit form opens, never cached across the
 * screen visit. `?all=1` is `handleListCodingListEntries`'s own
 * pagination bypass; Cost Centre has no equivalent call at all, since
 * its own parent picker reads `/org/overview`'s lightweight list
 * instead (see this file's own header comment).
 */
async function loadFullEntries(listType) {
  const response = await fetch(`/api/coding-lists/${listType}?all=1`);
  if (!response.ok) return null;
  const body = await response.json();
  return { entries: body.entries ?? [], declaredFilters: body.declaredFilters ?? [] };
}

/**
 * Redraw one tab in place, after its own data changed — a create, an
 * edit, or a CSV load. Finds `accountCodingRoot()`'s own stable
 * container by id rather than holding a reference to it, the same fix
 * `csvLoaderPanel`'s own note box already needed (`purchase-
 * orders.js`'s `runLoad()` first, decision 0373): whatever called this
 * may itself already be inside DOM about to be replaced.
 */
async function reloadTable(listType) {
  await loadTable(listType);
  const container = document.getElementById("codingactivetab");
  if (container) container.replaceChildren(buildActiveSection());
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

/**
 * The search box and pagination controls, in one row above the table —
 * decision 0446, reusing `purchase-orders.js`'s own `searchAndPagination
 * Row()` shape and generic strings (`purchaseorders.rows` and the four
 * page-nav labels) almost line for line, parameterised by list type
 * since all four tables share one component here rather than one each.
 */
function searchAndPaginationRow(listType) {
  const state = tableState[listType];
  const searchId = `codingsearch-${listType}`;
  const sizeId = `codingrowsize-${listType}`;

  const search = el("input", { type: "search", id: searchId, placeholder: t("apsetup.codingsearchplaceholder") });
  search.value = state.search;
  search.onchange = async () => {
    state.search = search.value;
    state.page = 1;
    await reloadTable(listType);
    document.getElementById(searchId)?.focus();
  };

  const sizePicker = el(
    "select",
    { id: sizeId },
    PAGE_SIZES.map((size) => el("option", { value: String(size), text: String(size) }))
  );
  sizePicker.value = String(state.pageSize);
  sizePicker.onchange = async () => {
    state.pageSize = Number(sizePicker.value);
    state.page = 1;
    await reloadTable(listType);
    document.getElementById(sizeId)?.focus();
  };

  const totalPages = state.total === 0 ? 0 : Math.ceil(state.total / state.pageSize);
  const atFirst = state.page <= 1;
  const atLast = state.total === 0 || state.page >= totalPages;

  function navButton(name, label, disabled, onclick) {
    const button = el("button", { class: "iconbutton", "aria-label": label, title: label });
    button.append(icon(name));
    button.disabled = disabled;
    button.onclick = onclick;
    return button;
  }

  const rangeStart = state.total === 0 ? 0 : (state.page - 1) * state.pageSize + 1;
  const rangeEnd = Math.min(state.page * state.pageSize, state.total);

  return el("div", { class: "searchrow" }, [
    search,
    el("label", { class: "sm muted", text: t("purchaseorders.rows") }),
    sizePicker,
    navButton("chevronsleft", t("purchaseorders.firstpage"), atFirst, async () => {
      state.page = 1;
      await reloadTable(listType);
    }),
    navButton("chevronleft", t("purchaseorders.previouspage"), atFirst, async () => {
      state.page = Math.max(1, state.page - 1);
      await reloadTable(listType);
    }),
    el("span", {
      class: "sm muted",
      text: t("purchaseorders.rangeof").replace("{start}", String(rangeStart)).replace("{end}", String(rangeEnd)).replace("{total}", String(state.total)),
    }),
    navButton("chevronright", t("purchaseorders.nextpage"), atLast, async () => {
      state.page = Math.min(totalPages, state.page + 1);
      await reloadTable(listType);
    }),
    navButton("chevronsright", t("purchaseorders.lastpage"), atLast, async () => {
      state.page = totalPages;
      await reloadTable(listType);
    }),
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
 * Page one of all four paginated tables, at their own default search
 * (none) and page size — decision 0446. Called from `ap-setup.js`'s
 * own `load()` alongside `loadCodingListCsvFormats()`, so
 * `accountCodingTab()`'s own first render already has real data for
 * whichever sub-tab is active, the same "in its final state by the
 * time render() runs" discipline that function's own comment
 * describes. A failed fetch leaves that one table's own `freshTableState()`
 * defaults in place (empty rows, `total: 0`) rather than throwing —
 * `loadTable()` itself already degrades this way for any later
 * page/search change, so the first load is no different.
 */
export async function loadAccountCodingTables() {
  tableState = Object.fromEntries(PAGINATED_LIST_TYPES.map((listType) => [listType, freshTableState()]));
  await Promise.all(PAGINATED_LIST_TYPES.map((listType) => loadTable(listType)));
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
  const loadButton = actionLink("load", { primary: true, onclick: () => runLoad(), label: t("purchaseorders.loadbutton") });

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

  const templateButton = actionLink("download", { onclick: () => downloadCsvTemplate(listType), label: t("purchaseorders.templatebutton") });
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

function costCentreRow(costCentre, onClick) {
  // **The server's own resolved name, not recomputed here** —
  // `handleListCostCentresDetailed` already joins to `parentName`, and
  // a parent set on this cost centre may well not be among the rows
  // this page currently holds, now that the table is paginated
  // (decision 0446) — a client-side lookup against just this page
  // would silently miss it.
  const parentName = costCentre.parentName ?? "—";
  const companyCode = costCentre.filters.find((f) => f.filterListTypeId === "company_code")?.filterEntryName ?? "—";
  const row = el("tr", { class: "clickable" }, [
    el("td", { text: costCentre.name }),
    el("td", { class: "muted", text: parentName }),
    el("td", { class: "muted", text: costCentre.ownerName ?? "—" }),
    el("td", { class: "muted", text: costCentre.approvalLimit ?? "—" }),
    el("td", { class: "muted", text: companyCode }),
  ]);
  row.onclick = onClick;
  return row;
}

/**
 * `costCentreNames` is `/org/overview`'s own lightweight `{id, name}`
 * list, cached at module level (`cachedCostCentreNames`) — see this
 * file's own header comment for why the parent picker no longer reads
 * the (now paginated) table itself.
 */
function costCentreTab(costCentreNames) {
  const state = tableState.cost_centre;
  const onSaved = () => reloadTable("cost_centre");
  return el("div", {}, [
    el("div", { class: "panel" }, [searchAndPaginationRow("cost_centre")]),
    section(
      "apsetup.codingtab.costcentre",
      "apsetup.codingcostcentresub",
      state.search ? "apsetup.codingnomatches" : "apsetup.nocostcentres",
      ["apsetup.codingname", "apsetup.codingparent", "apsetup.codingapprover", "apsetup.codingapprovallimit", "apsetup.codingtab.companycode"],
      state.rows.map((c) =>
        costCentreRow(c, () => openCostCentreForm(c, { costCentres: costCentreNames, units: cachedUnits, users: cachedUsers, onSaved }))
      ),
      actionLink("create", {
        primary: true,
        label: t("apsetup.add"),
        onclick: () => openCostCentreForm(null, { costCentres: costCentreNames, units: cachedUnits, users: cachedUsers, onSaved }),
      })
    ),
  ]);
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
  // The missing half of what Cost Centre's own form already has —
  // decision 0452. Same field, same "sent alongside the approver in
  // the same request, always" shape `openCostCentreForm`'s own
  // limitInput already established, here in both create and edit
  // (this form, unlike Cost Centre's, already shows every field in
  // both) — `coding-list-route.ts` refuses a limit with no owner in
  // the same call, and this form always sends both together.
  const limitInput = el("input", { type: "number", min: "0", value: existing?.approvalLimit ?? "" });

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
    el("label", { text: t("apsetup.codingapprovallimit") }),
    limitInput,
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
      const limit = limitInput.value.trim();
      const approvalLimit = limit === "" ? null : Number(limit);
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
                approvalLimit,
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
                approvalLimit,
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

function codingEntryRow(entry, declaredFilters, onClick) {
  const cells = [
    el("td", { text: entry.name }),
    el("td", { class: "muted", text: entry.parentName ?? "—" }),
    el("td", { class: "muted", text: entry.approverName ?? "—" }),
    el("td", { class: "muted", text: entry.approvalLimit ?? "—" }),
    el("td", { class: "muted", text: entry.isDefault ? t("roles.yes") : "—" }),
  ];
  for (const filterListTypeId of declaredFilters) {
    cells.push(el("td", { class: "muted", text: entry.filters.find((f) => f.filterListTypeId === filterListTypeId)?.filterEntryName ?? "—" }));
  }
  const row = el("tr", { class: "clickable" }, cells);
  row.onclick = onClick;
  return row;
}

/**
 * Fetches this list's own full entries (for the parent picker) and,
 * when it declares a Commodity Code filter, that list's own full
 * entries too (for the filter picker) — both lazily, right before the
 * form opens, per this file's own header comment. A fetch failure
 * degrades to the table's own last-known `declaredFilters` and empty
 * picker options, rather than refusing to open the form at all — the
 * same "a help affordance's own failure blocks only itself" choice
 * `loadCodingListCsvFormats()` already makes for the Template button.
 */
async function openCodingEntryEditor(listType, titleKey, existing) {
  const known = tableState[listType];
  const [own, commodityFull] = await Promise.all([
    loadFullEntries(listType),
    known.declaredFilters.includes("commodity_code") ? loadFullEntries("commodity_code") : Promise.resolve(null),
  ]);
  const filterSources = {
    company_code: cachedUnits,
    commodity_code: commodityFull?.entries ?? [],
  };
  openCodingEntryForm(listType, titleKey, existing, {
    entries: own?.entries ?? [],
    declaredFilters: own?.declaredFilters ?? known.declaredFilters,
    users: cachedUsers,
    filterSources,
    onSaved: () => reloadTable(listType),
  });
}

function codingListTab(listType, titleKey, subKey, emptyKey) {
  const state = tableState[listType];
  const headers = ["apsetup.codingname", "apsetup.codingparent", "apsetup.codingapprover", "apsetup.codingapprovallimit", "apsetup.codingdefault"];
  for (const filterListTypeId of state.declaredFilters) {
    headers.push(`apsetup.codingtab.${filterListTypeId === "company_code" ? "companycode" : "commoditycode"}`);
  }
  return el("div", {}, [
    el("div", { class: "panel" }, [searchAndPaginationRow(listType)]),
    section(
      titleKey,
      subKey,
      state.search ? "apsetup.codingnomatches" : emptyKey,
      headers,
      state.rows.map((entry) =>
        codingEntryRow(entry, state.declaredFilters, () => openCodingEntryEditor(listType, titleKey, entry))
      ),
      actionLink("create", {
        primary: true,
        label: t("apsetup.add"),
        onclick: () => openCodingEntryEditor(listType, titleKey, null),
      })
    ),
  ]);
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

/** After a CSV load, a fresh view — the same "back to page 1" choice `purchase-orders.js`'s own loader already makes (decision 0376), extended here to also clear a stale search term. */
function csvRefresh(listType) {
  return async () => {
    const state = tableState[listType];
    state.search = "";
    state.page = 1;
    await reloadTable(listType);
  };
}

/**
 * The active sub-tab's own content, built from this module's own
 * cached props and `tableState` — no arguments, since both
 * `accountCodingTab()` (the first render) and `reloadTable()`'s own
 * targeted redraw (every later one) need exactly the same thing.
 */
function buildActiveSection() {
  return {
    company_code: () => companyCodeTab(cachedUnits),
    cost_centre: () => el("div", {}, [csvLoaderPanel("cost_centre", csvRefresh("cost_centre")), costCentreTab(cachedCostCentreNames)]),
    project: () =>
      el("div", {}, [
        csvLoaderPanel("project", csvRefresh("project")),
        codingListTab("project", "apsetup.codingtab.project", "apsetup.codingprojectsub", "apsetup.noprojects"),
      ]),
    commodity_code: () =>
      el("div", {}, [
        csvLoaderPanel("commodity_code", csvRefresh("commodity_code")),
        codingListTab("commodity_code", "apsetup.codingtab.commoditycode", "apsetup.codingcommoditycodesub", "apsetup.nocommoditycodes"),
      ]),
    gl_code: () =>
      el("div", {}, [
        csvLoaderPanel("gl_code", csvRefresh("gl_code")),
        codingListTab("gl_code", "apsetup.codingtab.glcode", "apsetup.codingglcodesub", "apsetup.noglcodes"),
      ]),
  }[activeCodingTab]();
}

/**
 * The Account Coding tab's own content — called from `ap-setup.js`'s
 * own `render()`. `units`/`users`/`costCentreNames` (the last from
 * `/org/overview`'s own lightweight list) are cached here rather than
 * threaded through on every later redraw, since `reloadTable()`'s own
 * targeted redraw happens without `ap-setup.js` calling back in with
 * fresh props — see this file's own header comment.
 */
export function accountCodingTab({ units, users, costCentreNames, rerender }) {
  cachedUnits = units;
  cachedUsers = users;
  cachedCostCentreNames = costCentreNames;

  return el("div", {}, [codingSubTabBar(rerender), el("div", { id: "codingactivetab" }, [buildActiveSection()])]);
}
