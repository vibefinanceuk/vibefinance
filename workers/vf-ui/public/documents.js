import { t } from "/strings.js";
import { el, frame, topbar, setCurrentScreen } from "/tasks.js";
import { currentOrgId } from "/orgs.js";

/**
 * Every document that has arrived — decision 0164.
 *
 * **Every way into a document was a task.** An invoice that went
 * straight through has none, so it was invisible: correctly processed
 * and unreachable. The system could only show what went wrong, which is
 * the minority if the product works.
 */

let documents = [];
let searched = 0;
let query = "";

/**
 * A drill-through filter from the dashboard — decision 0259.
 *
 * **Not the search box, and not the unit picker.** *Unplaced* and
 * *duplicate* are not something a person types or chooses from a list
 * of the customer's own units; they are a fixed, named question a
 * dashboard card already answered with a count, and this is where the
 * click lands.
 *
 * `null` means neither is active, which is every ordinary visit to this
 * screen.
 */
let alertFilter = null;

/**
 * **A stage, named as well as identified** — decision 0264.
 *
 * The banner has to say *which* stage without another round trip; the
 * dashboard already has the stage's own name from `whereThingsAre()`,
 * so it is carried here alongside the id rather than looked up again.
 */
let stageFilter = null;

/**
 * **A supplier, from Exceptions by Supplier — decision 0411.**
 *
 * The same shape as `stageFilter`: the dashboard's own bar already
 * shows the supplier's name, so the click carries it along rather than
 * this screen looking it up again. The name itself is the filter — it
 * is also the exact grouping key `exceptionsBySupplier()` counts by
 * (`dashboard-route.ts`), so asking the server for documents matching
 * this name, with the same 30-day/failed-validation condition, is
 * "ask the click" (decision 0368) rather than a second, separate
 * definition of the same question.
 */
let supplierFilter = null;

/**
 * **An age bucket, from Task Aging Report — decision 0411.**
 *
 * `minDays`/`maxDays` (the latter possibly `null`, for the open-ended
 * last bucket) come straight from `ageing()`'s own response
 * (`dashboard-route.ts`) rather than being decided again here — the
 * one place those five numbers are chosen. `label` is carried only for
 * the banner text.
 */
let agingFilter = null;

/**
 * Which part of the business to show — decision 0193.
 *
 * **Empty means all of them**, which is what a customer with one unit
 * always sees and what a customer with several starts from.
 */
let unit = "";
let units = [];

/**
 * The columns, and which are shown by default.
 *
 * **Defaults answer the questions people arrive with**: what is it, who
 * sent it, how much, when, and where has it got to. Recipient matters
 * once a customer has several mailboxes; Due to somebody chasing
 * payment terms; Hands is the product's own claim made countable.
 *
 * `always` is the document number alone now — decision 0287 removed
 * Expand as a column of its own. **A row that cannot be identified is
 * not a row**, decision 0164's own reasoning, unchanged; opening one
 * no longer needs a column, since the row itself does that now.
 */
const COLUMNS = [
  { key: "number", always: true },
  { key: "type", on: true },
  { key: "status", on: true },
  { key: "amount", on: true },
  { key: "sender", on: true },
  { key: "recipient", on: false },
  { key: "received", on: true },
  { key: "due", on: false },
  { key: "stage", on: true },
  /**
   * Which part of the business — decision 0193.
   *
   * **On by default**, because a customer with one unit sees a column
   * of the same word and a customer with several cannot work without
   * it. The first costs a column; the second costs an undifferentiated
   * list.
   */
  { key: "unit", on: true },
  { key: "hands", on: false },
];

/**
 * Kept in the browser, at the operator's asking.
 *
 * A column choice is a preference about one screen on one machine, not
 * something worth a column on `org_users` — and decision 0139's mood
 * control settled the same question the same way.
 */
const STORAGE_KEY = "vf.documents.columns";

function loadColumns() {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved) return new Set(JSON.parse(saved));
  } catch {
    // A browser that refuses storage gets the defaults, which is a
    // worse experience and not a broken one.
  }
  return new Set(COLUMNS.filter((c) => c.always || c.on).map((c) => c.key));
}

let shown = loadColumns();

function saveColumns() {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...shown]));
  } catch {
    // See above.
  }
}

async function loadUnits() {
  // Only operating units: an invoice may belong to one and never to a
  // legal entity (decision 0036's own invariant).
  try {
    const response = await fetch("/api/org/units");
    if (!response.ok) return;
    const body = await response.json();
    units = (body.units ?? []).filter((u) => u.kind === "operating_unit");
  } catch {
    // A customer with no units configured is the ordinary case, and a
    // missing filter is better than a broken screen.
  }
}

async function load() {
  const params = new URLSearchParams({ q: query, unit });
  if (alertFilter === "unplaced") params.set("unplaced", "1");
  if (alertFilter === "duplicates") params.set("duplicates", "1");
  if (alertFilter === "donebyme") params.set("doneByMe", "1");
  if (stageFilter) params.set("stage", stageFilter.id);
  if (supplierFilter) params.set("exceptionSupplier", supplierFilter.name);
  if (agingFilter) {
    params.set("agingMinDays", String(agingFilter.minDays));
    if (agingFilter.maxDays !== null && agingFilter.maxDays !== undefined) {
      params.set("agingMaxDays", String(agingFilter.maxDays));
    }
  }
  /**
   * **The chosen org, decision 0315** — extending decision 0314's own
   * treatment of Tasks to Documents. A different, wider concept from
   * `unit` above: `unit` is one operating unit within whichever org
   * is already in scope; this is the org itself.
   */
  const org = currentOrgId();
  if (org) params.set("org", org);

  const response = await fetch(`/api/documents?${params}`);
  if (!response.ok) return false;

  const body = await response.json();
  documents = body.documents ?? [];
  searched = body.searched ?? 0;
  return true;
}

/** A number a person reads, in the customer's own locale. */
function money(amount, currency) {
  if (amount === null || amount === undefined) return null;
  return `${Number(amount).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${currency ?? ""}`.trim();
}

function dash() {
  return el("span", { class: "muted", text: "—" });
}

/**
 * One cell.
 *
 * **A document nothing could read** has no type, no number, no amount
 * and no due date. Four empty cells say nothing, so the row says what
 * happened instead.
 */
function cell(doc, key) {
  const unreadable = doc.status === "unreadable";

  switch (key) {
    /**
     * **Plain text, not its own button, decision 0287.** The row
     * itself opens the document now; a second clickable element inside
     * a clickable row would fire twice on a click here — its own
     * `onclick`, then the row's own handler again once the click
     * bubbles up to it.
     */
    case "number":
      return el("td", {}, [
        unreadable
          ? el("span", { class: "sm unread", text: t("documents.unreadable") })
          : el("span", { text: doc.number ?? doc.id.slice(0, 8) }),
      ]);

    case "type":
      return el("td", {}, [
        unreadable
          ? el("span", { class: "unread", text: t("documents.notread") })
          : el("span", { text: t(`doctype.${doc.typeCode ?? "unknown"}`) }),
      ]);

    case "status":
      return el("td", {}, [
        el("span", { class: `status ${doc.status}`, text: t(`docstatus.${doc.status}`) }),
      ]);

    case "amount":
      return el("td", { class: "num" }, [
        money(doc.amount, doc.currency)
          ? el("span", { text: money(doc.amount, doc.currency) })
          : dash(),
      ]);

    case "sender":
      return el("td", {}, [
        el("div", { text: doc.supplier ?? t("documents.unknownsender") }),
        ...(doc.sender ? [el("div", { class: "sm muted", text: doc.sender })] : []),
      ]);

    case "recipient":
      return el("td", { class: "sm muted" }, [
        doc.recipient ? el("span", { text: doc.recipient }) : dash(),
      ]);

    case "received":
      return el("td", { text: (doc.receivedAt ?? "").slice(0, 10) });

    case "due":
      return el("td", {}, [doc.dueDate ? el("span", { text: doc.dueDate }) : dash()]);

    case "stage":
      return el("td", { class: "stage-cell" }, [
        doc.stageName
          ? el("span", { class: doc.status, text: doc.stageName })
          : el("span", { class: "muted", text: t("documents.noprocess") }),
      ]);

    case "unit":
      return el("td", {}, [
        doc.orgUnitName
          ? el("span", { text: doc.orgUnitName })
          : // Unassigned is a fact about the document, not a gap.
            el("span", { class: "muted", text: t("documents.nounit") }),
      ]);

    case "hands":
      return el("td", { class: `hands ${doc.hands === 0 ? "none" : "some"}` }, [
        el("span", {
          text:
            doc.hands === 0
              ? t("documents.straightthrough")
              : t("documents.handcount").replace("{n}", String(doc.hands)),
        }),
      ]);

    default:
      return el("td", {});
  }
}

/**
 * Open it in the viewer.
 *
 * **The same viewer a task opens** (decision 0142), and what it lets
 * somebody change is decided by the stage the invoice is at — or by
 * nothing, if it has left its process, in which case it is read-only
 * (decision 0164). Editing belongs to a task.
 */
async function expand(doc) {
  const { openViewer } = await import("/viewer.js");

  /**
   * **Showing the viewer is the caller's job** — decision 0165.
   *
   * `openViewer` renders into `#viewer` and does not unhide it; the
   * task list swaps the two panes itself. This screen called it without
   * doing that, so the viewer rendered into a hidden element and
   * nothing appeared to happen.
   *
   * Done here to match, and recorded as duplication: the second caller
   * of a function that needs three lines of preparation is the one that
   * finds out the preparation exists.
   */
  document.getElementById("shell").hidden = true;
  document.getElementById("viewer").hidden = false;

  await openViewer(
    {
      subject: { type: "invoice", id: doc.id },
      stageId: doc.stageId,
      stageName: doc.stageName,
      // No task: this is a document being looked at, not work being
      // done. The viewer offers no actions without one.
      actions: [],
    },
    async () => {
      document.getElementById("viewer").hidden = true;
      document.getElementById("shell").hidden = false;
      await open();
    }
  );
}

function columnPicker() {
  const list = el(
    "div",
    { class: "columnlist" },
    COLUMNS.map((column) => {
      const box = el("input", { type: "checkbox" });
      box.checked = shown.has(column.key);
      // A row that cannot be identified or opened is not a row.
      box.disabled = Boolean(column.always);
      box.onchange = () => {
        if (box.checked) shown.add(column.key);
        else shown.delete(column.key);
        saveColumns();
        render();
      };

      const label = el("label", {}, [box]);
      label.append(document.createTextNode(` ${t(`column.${column.key}`)}`));
      return label;
    })
  );

  // **Not `columns`** — decision 0177. That name belongs to the
  // two-column layout the viewer and sources have used since 0108.
  const picker = el("details", { class: "columnpicker" }, [
    el("summary", { title: t("documents.choosecolumns") }, [columnsIcon()]),
    list,
  ]);
  return picker;
}

function columnsIcon() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.6");
  svg.setAttribute("stroke-linecap", "round");
  svg.innerHTML =
    '<path d="M4 6h16M4 12h16M4 18h16"/>' +
    '<circle cx="9" cy="6" r="2" fill="currentColor" stroke="none"/>' +
    '<circle cx="15" cy="12" r="2" fill="currentColor" stroke="none"/>' +
    '<circle cx="7" cy="18" r="2" fill="currentColor" stroke="none"/>';
  return svg;
}

/**
 * The banner's own sentence — decision 0411 extends decision
 * 0259/0264's original ternary to two more filters rather than
 * growing it past the point a reader can follow inline.
 */
function bannerText() {
  if (stageFilter) return t("documents.showing.stage").replace("{stage}", stageFilter.name);
  if (supplierFilter) return t("documents.showing.exceptionsupplier").replace("{supplier}", supplierFilter.name);
  if (agingFilter) return t("documents.showing.aging").replace("{bucket}", agingFilter.label);
  return t(`documents.showing.${alertFilter}`);
}

function render() {
  const shell = document.getElementById("shell");
  if (!shell) return;

  const visible = COLUMNS.filter((c) => shown.has(c.key));

  const search = el("input", {
    type: "search",
    id: "docsearch",
    placeholder: t("documents.searchhint"),
  });
  search.value = query;
  search.onchange = async () => {
    query = search.value;
    await load();
    render();
    document.getElementById("docsearch")?.focus();
  };

  /**
   * **Only where there is a choice to make** — decision 0193.
   *
   * A customer with one operating unit gets a dropdown with one entry,
   * which is a control that cannot do anything. It appears when a
   * second unit exists.
   */
  const unitPicker = el("select", { class: "unitpicker" });
  if (units.length > 1) {
    unitPicker.append(el("option", { value: "", text: t("documents.allunits") }));
    for (const u of units) {
      unitPicker.append(el("option", { value: u.id, text: u.name }));
    }
    unitPicker.value = unit;
    unitPicker.onchange = async () => {
      unit = unitPicker.value;
      await load();
      render();
    };
  }

  shell.replaceChildren(
    frame(
      el("div", {}, [
        topbar(t("nav.documents"), t("documents.subtitle")),

        /**
         * **Said on the screen, not just in the URL.** A person
         * arriving here from a dashboard card sees a list that could
         * otherwise look like *all* documents when it is a fixed six or
         * one — decision 0256 fixed exactly this shape of confusion for
         * a dropdown that quietly filtered without saying so.
         */
        alertFilter || stageFilter || supplierFilter || agingFilter
          ? el("div", { class: "panel alertbanner" }, [
              el("span", { text: bannerText() }),
              el("button", {
                class: "chip",
                text: t("documents.clearfilter"),
                onclick: async () => {
                  alertFilter = null;
                  stageFilter = null;
                  supplierFilter = null;
                  agingFilter = null;
                  await load();
                  render();
                },
              }),
            ])
          : null,

        el("div", { class: "panel" }, [
          el("div", { class: "searchrow" }, [
            search,
            ...(units.length > 1 ? [unitPicker] : []),
            columnPicker(),
          ]),
        ]),

        el("div", { class: "panel" }, [
          documents.length > 0
            ? el("div", { class: "tablewrap" }, [
                el("table", {}, [
                  el("thead", {}, [
                    el(
                      "tr",
                      {},
                      visible.map((c) =>
                        el("th", { class: c.key === "amount" ? "num" : "" }, [
                          el("span", { text: t(`column.${c.key}`) }),
                        ])
                      )
                    ),
                  ]),
                  el(
                    "tbody",
                    {},
                    documents.map((doc) =>
                      el(
                        "tr",
                        {
                          class: "clickable",
                          /**
                           * **The row itself opens the document** —
                           * decision 0287, matching the dashboard's own
                           * "On my clock" list (decision 0250): "a row
                           * that reads like a link and does nothing is
                           * worse than one that does not." Removes the
                           * need for a separate Expand button or column
                           * — the whole row already says what clicking
                           * it does.
                           */
                          onclick: () => expand(doc),
                        },
                        visible.map((c) => cell(doc, c.key))
                      )
                    )
                  ),
                ]),
              ])
            : // **An empty screen is an invitation to act**, not an
              // apology.
              el("div", { class: "empty muted", text: query ? t("documents.nomatch") : t("documents.none") }),

          // What was looked through, so the screen does not imply it
          // searched everything (see the route's own note).
          ...(query && documents.length > 0
            ? [
                el("p", {
                  class: "sm muted",
                  text: t("documents.searchedcount")
                    .replace("{shown}", String(documents.length))
                    .replace("{searched}", String(searched)),
                }),
              ]
            : []),
        ]),
      ].filter(Boolean))
    )
  );
}

export async function open() {
  setCurrentScreen("documents");
  await loadUnits();
  if (!(await load())) return;
  render();
}

/**
 * Open the documents screen already filtered — decision 0259.
 *
 * The dashboard's *Unplaced Documents* and *Possible Duplicates* cards
 * each said a count and, until now, had nowhere to send a click.
 * `alertFilter` clears the ordinary search and unit choice, because the
 * two kinds of narrowing do not compose in a way a person reading the
 * screen could make sense of — arriving to see *"6 unplaced"* and
 * finding it silently ANDed with whatever unit was last chosen would be
 * a smaller version of the exact confusion decision 0256 fixed.
 */
export async function openDocumentsFiltered(kind) {
  query = "";
  unit = "";
  alertFilter = kind;
  stageFilter = null;
  setCurrentScreen("documents");
  await loadUnits();
  if (!(await load())) return;
  render();
}

/**
 * Open the documents screen filtered to what I completed this week —
 * decision 0265, from the dashboard's redefined "Done" card.
 *
 * **No userId sent from here.** The server already knows who is
 * asking — `auth.user.id`, from the same session cookie every
 * authenticated route reads — so the client only has to say *what*
 * it wants, not *who* is asking for it.
 */
export async function openDocumentsCompletedByMe() {
  return openDocumentsFiltered("donebyme");
}

/**
 * Open the documents screen filtered to one stage — decision 0264,
 * from the dashboard's "Where things are" donut.
 *
 * **Not `openDocumentsFiltered`, deliberately.** That one exists for a
 * fixed, named question a card already answered; a stage is one of a
 * customer's own, chosen at the moment of the click, which is a
 * different shape of filter even though the banner and the clearing
 * behave the same way.
 */
export async function openDocumentsAtStage(stageId, stageName) {
  query = "";
  unit = "";
  alertFilter = null;
  stageFilter = { id: stageId, name: stageName };
  setCurrentScreen("documents");
  await loadUnits();
  if (!(await load())) return;
  render();
}

/**
 * Open the documents screen filtered to one supplier's own recent
 * exceptions — decision 0411, from the dashboard's "Exceptions by
 * Supplier" bar list.
 *
 * **The supplier's own name is the filter**, the same one
 * `exceptionsBySupplier()` (`dashboard-route.ts`) already grouped by
 * to produce the bar being clicked — not a second lookup for a
 * supplier id this card was never given.
 */
export async function openDocumentsForSupplierExceptions(supplierName) {
  query = "";
  unit = "";
  alertFilter = null;
  stageFilter = null;
  agingFilter = null;
  supplierFilter = { name: supplierName };
  setCurrentScreen("documents");
  await loadUnits();
  if (!(await load())) return;
  render();
}

/**
 * Open the documents screen filtered to one aging bucket's own open
 * work — decision 0411, from the dashboard's "Task Aging Report" bars.
 *
 * **`minDays`/`maxDays` are read off the bar, not recomputed here** —
 * they came from `ageing()`'s own response in the first place
 * (`dashboard-route.ts`), the one place those five boundaries are
 * decided.
 */
export async function openDocumentsAged(bucket) {
  query = "";
  unit = "";
  alertFilter = null;
  stageFilter = null;
  supplierFilter = null;
  agingFilter = bucket;
  setCurrentScreen("documents");
  await loadUnits();
  if (!(await load())) return;
  render();
}
