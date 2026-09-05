/**
 * The Validation viewer — decision 0106.
 *
 * One screen for a document intake could not read: the original on the
 * left, the fields it should have yielded on the right, and the actions
 * the task says are available.
 *
 * Design reasoning in `docs/design/operator-interface.md` section 3, and
 * the mockup it is built from is
 * `docs/design/mockups/key-from-document.html`.
 */

import { t } from "/strings.js";
import { frame, topbar } from "/tasks.js";

let current = null;
/** The line table's working state — decision 0109. */
let lines = [];

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === "class") node.className = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    // textContent, never innerHTML — everything here is data from an
    // API rendered into a page.
    else if (key === "text") node.textContent = value;
    else if (value !== undefined && value !== null) node.setAttribute(key, value);
  }
  for (const child of children) node.append(child);
  return node;
}

/**
 * The fields a person can key.
 *
 * **A subset, deliberately.** Decision 0055 records that which fields
 * to offer is a per-process decision, and every field the vocabulary
 * declares would be a wall of inputs. These are the ones a validation
 * failure usually turns on.
 */
const FIELDS = [
  { code: "BT-1", type: "text" },
  { code: "BT-2", type: "date" },
  { code: "BT-31", type: "text" },
  { code: "BT-5", type: "text" },
  { code: "BT-106", type: "number" },
  { code: "BT-110", type: "number" },
  { code: "BT-112", type: "number" },
  { code: "BT-115", type: "number" },
];

function field(spec, existing) {
  const input = el("input", {
    type: spec.type,
    id: `f-${spec.code}`,
    step: spec.type === "number" ? "0.01" : undefined,
    // What is already known is shown, so somebody correcting one value
    // does not have to retype the rest.
    value: existing?.[spec.code] ?? "",
  });
  return el("div", { class: "kf" }, [
    // Labels by key, so a customer's language reaches the fields too.
    el("label", { for: `f-${spec.code}`, text: t(`field.${spec.code.toLowerCase()}`) }),
    input,
  ]);
}

/**
 * Open the retained original in its own window.
 *
 * `window.open` sends no `Authorization` header, which is why decision
 * 0073 exists: a short-lived signed URL the browser can follow on its
 * own. Minted on click rather than up front — a five-minute credential
 * created when the page loads is mostly expired by the time anybody
 * uses it.
 */
async function openDocument(invoiceId) {
  const response = await fetch(`/api/invoices/${encodeURIComponent(invoiceId)}/document-url`, {
    method: "POST",
  });
  if (!response.ok) {
    note(t("viewer.nodocument"));
    return;
  }
  const { url } = await response.json();
  window.open(url, "_blank", "noopener");
}

function note(message) {
  const box = document.getElementById("viewer-note");
  if (box) box.textContent = message;
}

/**
 * The running comparison — decision 0109.
 *
 * **Advisory, never blocking.** An invoice whose lines do not sum to
 * its printed total is a fact to record faithfully, not an input to
 * prevent — the same principle decision 0072 established for
 * validation, applied where a person can see it.
 *
 * It says what it found. It does not stop anybody saving.
 */
function updateTotals() {
  const summed = lines.reduce((total, line) => total + (Number(line.amount) || 0), 0);
  const printed = Number(document.getElementById("f-BT-112")?.value) || 0;

  const box = document.getElementById("linetotal");
  if (!box) return;

  const difference = Math.round((summed - printed) * 100) / 100;
  box.textContent =
    printed === 0
      ? `${t("viewer.linetotal")} ${summed.toFixed(2)}`
      : `${t("viewer.linetotal")} ${summed.toFixed(2)} · ${
          difference === 0 ? t("viewer.matches") : `${t("viewer.differs")} ${difference.toFixed(2)}`
        }`;
  box.className = difference === 0 || printed === 0 ? "linetotal" : "linetotal off";
}

function lineRow(line, index) {
  const cell = (field, type) =>
    el("td", {}, [
      el("input", {
        type,
        step: type === "number" ? "0.01" : undefined,
        value: line[field] ?? "",
        oninput: (event) => {
          line[field] = type === "number" ? event.target.value : event.target.value;
          updateTotals();
        },
      }),
    ]);

  return el("tr", {}, [
    el("td", { class: "num muted", text: String(index + 1) }),
    cell("description", "text"),
    cell("amount", "number"),
    el("td", {}, [
      el("button", {
        class: "rm",
        text: "×",
        title: t("viewer.removeline"),
        onclick: () => {
          lines.splice(index, 1);
          renderLines();
        },
      }),
    ]),
  ]);
}

function renderLines() {
  const body = document.getElementById("lines");
  if (!body) return;
  body.replaceChildren(...lines.map((line, index) => lineRow(line, index)));
  updateTotals();
}

function linePanel() {
  return el("div", { class: "panel" }, [
    el("h3", { text: t("viewer.lines") }),
    el("table", { class: "linetable" }, [
      el("thead", {}, [
        el("tr", {}, [
          el("th", { class: "num", text: "#" }),
          el("th", { text: t("viewer.description") }),
          el("th", { class: "num", text: t("tasks.amount") }),
          el("th", { text: "" }),
        ]),
      ]),
      el("tbody", { id: "lines" }),
    ]),
    el("div", { class: "linefoot" }, [
      el("button", {
        text: t("viewer.addline"),
        onclick: () => {
          lines.push({ description: "", amount: "" });
          renderLines();
        },
      }),
      el("div", { class: "linetotal", id: "linetotal" }),
    ]),
  ]);
}

async function save(close) {
  const facts = {};
  for (const spec of FIELDS) {
    const raw = document.getElementById(`f-${spec.code}`).value.trim();
    if (raw === "") continue; // Partial keying is allowed (decision 0071).
    facts[spec.code] = spec.type === "number" ? Number(raw) : raw;
  }

  // **Every line, not just the changed ones.** The writer replaces the
  // whole set (`DELETE` then reinsert), so sending a subset would
  // delete the rest. The server works out what actually changed for the
  // provenance trail (decision 0109).
  const payload = { facts };
  const usable = lines
    .filter((line) => String(line.description ?? "").trim() !== "" || String(line.amount ?? "") !== "")
    .map((line, index) => ({
      lineNumber: index + 1,
      description: String(line.description ?? "").trim(),
      amount: line.amount === "" ? null : Number(line.amount),
    }));
  if (usable.length > 0) payload.lines = usable;

  if (Object.keys(facts).length === 0 && usable.length === 0) {
    note(t("viewer.nothing"));
    return;
  }

  const response = await fetch(`/api/invoices/${encodeURIComponent(current.subject.id)}/key`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    note(body.error ?? t("viewer.savefailed"));
    return;
  }

  // **The verdict is advisory** (decision 0072). Validation is re-run
  // and reported, and nothing re-evaluates the rules — so this says
  // whether the document would now pass, not that anything has moved.
  const validation = body.validation;
  if (validation) {
    note(
      validation.passed
        ? `Saved. Validation would now pass (${validation.checked.join(", ")}).`
        : `Saved. Still failing: ${validation.failures.join(", ")}.`
    );
  } else {
    note(t("viewer.saved"));
  }

  if (close) close();
}

/**
 * Render the viewer for a task.
 *
 * `onClose` returns to the list. Keying does not complete the task —
 * those are separate acts, and somebody may key what they can read and
 * leave the rest for later.
 */
export function openViewer(task, onClose) {
  current = task;
  // A document nobody could read usually has no lines at all, so the
  // table starts empty and the person adds what they see.
  lines = [];
  const shell = document.getElementById("viewer");

  const known = task.subject ?? {};
  const existing = {
    "BT-31": known.supplierVatId ?? "",
    "BT-5": known.currency ?? "",
    "BT-2": known.issueDate ?? "",
    "BT-112": known.totalWithVat ?? "",
  };

  /**
   * Status first, and separately — decision 0108. The row somebody
   * reads on most documents without reading anything else.
   */
  const keyed = ["supplierVatId", "currency", "issueDate", "totalWithVat"].filter(
    (f) => known[f] !== null && known[f] !== undefined
  ).length;

  const status = el("div", { class: "statusrow" }, [
    el("div", { class: "panel stat warn" }, [
      el("div", { class: "label", text: t("viewer.status") }),
      el("div", { class: "value", text: t("tasks.notkeyed") }),
      el("div", { class: "note", text: `${keyed}/4 ${t("viewer.known")}` }),
    ]),
    el("div", { class: "panel stat" }, [
      el("div", { class: "label", text: t("tasks.stage") }),
      el("div", { class: "value", text: task.stageName ?? task.stageId }),
    ]),
    el("div", { class: "panel stat" }, [
      el("div", { class: "label", text: t("tasks.waiting") }),
      el("div", { class: "value", text: waited(task.createdAt) }),
    ]),
    el("div", { class: "panel stat" }, [
      el("div", { class: "label", text: t("tasks.owner") }),
      el("div", { class: "value", text: t(`tasks.${task.ownership}`) }),
    ]),
  ]);

  shell.replaceChildren(
    frame(
      el("div", {}, [
        topbar(t("viewer.title"), task.subject?.id ?? "", [
          el("button", { text: t("viewer.back"), onclick: onClose }),
        ]),
        status,
        // Fields beside actions, rather than fields above a footer.
        // Actions collected in one place (decision 0108).
        el("div", { class: "columns" }, [
          el("div", {}, [
            el("div", { class: "panel" }, [
              el("h3", { text: t("viewer.fields") }),
              el("div", { class: "vfields" }, FIELDS.map((spec) => field(spec, existing))),
            ]),
            linePanel(),
            el("div", { class: "problem", id: "viewer-note", role: "status" }),
          ]),
          el("div", {}, [
            el("div", { class: "panel" }, [
              el("h3", { text: t("viewer.document") }),
              // **The document is visible, not behind a button.** The
              // panel is a placeholder until something can render a PDF
              // (decision 0042); the original still opens in its own
              // window through a signed URL.
              el("div", { class: "vthumb", text: known.type ?? "document" }),
              el("button", {
                class: "act wide",
                text: t("viewer.open"),
                onclick: () => openDocument(task.subject.id),
              }),
            ]),
            el("div", { class: "panel actions" }, [
              el("h3", { text: t("viewer.actions") }),
              el("button", {
                class: "primary wide",
                text: t("viewer.save"),
                onclick: () => save(null),
              }),
              // What else this task offers is the SERVER's decision
              // (decision 0103) -- collecting them visually does not
              // move where they are decided.
              ...task.actions
                .filter((a) => a !== "key")
                .map((a) => el("button", { class: "wide", text: t(`action.${a}`), disabled: "disabled" })),
            ]),
          ]),
        ]),
      ])
    )
  );

  renderLines();
  // The comparison follows the printed total as it is typed, not only
  // when a line changes.
  document.getElementById("f-BT-112")?.addEventListener("input", updateTotals);
}

/** How long this has waited, which is the thing that costs money. */
function waited(iso) {
  const then = new Date(iso.replace(" ", "T") + "Z").getTime();
  const days = Math.floor((Date.now() - then) / 86400000);
  return days >= 1 ? `${days}d` : `${Math.max(1, Math.floor((Date.now() - then) / 3600000))}h`;
}
