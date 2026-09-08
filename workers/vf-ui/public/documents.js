import { t } from "/strings.js";
import { el, frame, topbar, setCurrentScreen } from "/tasks.js";

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
 * The columns, and which are shown by default.
 *
 * **Defaults answer the questions people arrive with**: what is it, who
 * sent it, how much, when, and where has it got to. Recipient matters
 * once a customer has several mailboxes; Due to somebody chasing
 * payment terms; Hands is the product's own claim made countable.
 *
 * `always` is the document number and Expand — **a row that cannot be
 * identified or opened is not a row.**
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
  { key: "hands", on: false },
  { key: "expand", always: true },
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

async function load() {
  const response = await fetch(`/api/documents?q=${encodeURIComponent(query)}`);
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
    case "number":
      return el("td", {}, [
        unreadable
          ? el("span", { class: "sm unread", text: t("documents.unreadable") })
          : el("button", {
              class: "rulelink",
              text: doc.number ?? doc.id.slice(0, 8),
              onclick: () => expand(doc),
            }),
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

    case "hands":
      return el("td", { class: `hands ${doc.hands === 0 ? "none" : "some"}` }, [
        el("span", {
          text:
            doc.hands === 0
              ? t("documents.straightthrough")
              : t("documents.handcount").replace("{n}", String(doc.hands)),
        }),
      ]);

    case "expand":
      return el("td", {}, [
        // The same word the column is called, rather than a second
        // key saying the same thing (decision 0165).
        el("button", { class: "expand", text: t("column.expand"), onclick: () => expand(doc) }),
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

  shell.replaceChildren(
    frame(
      el("div", {}, [
        topbar(t("nav.documents"), t("documents.subtitle")),

        el("div", { class: "panel" }, [
          el("div", { class: "searchrow" }, [search, columnPicker()]),
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
                          // Expand's column needs no heading; the
                          // button says what it does.
                          el("span", { text: c.key === "expand" ? "" : t(`column.${c.key}`) }),
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
                        {},
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
      ])
    )
  );
}

export async function open() {
  setCurrentScreen("documents");
  if (!(await load())) return;
  render();
}
