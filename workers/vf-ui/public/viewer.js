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

/**
 * The standard's own code lists — decision 0113.
 *
 * Fetched once and held, because they are the same for every invoice
 * and every customer. **A dropdown rather than a text box**: `EUR` is
 * valid, `EURO` and `eur` are not, and a person typing a currency
 * should not have to know which.
 */
let codeLists = {};

async function loadCodeLists() {
  if (Object.keys(codeLists).length > 0) return;
  try {
    const response = await fetch("/api/code-lists");
    if (response.ok) codeLists = (await response.json()).fields ?? {};
  } catch {
    // A text box is worse than a dropdown and better than no screen.
  }
}


/**
 * The convenience columns `invoice_lines` also stores.
 *
 * They are **derived from the facts**, not typed separately: the item
 * name is the description a person reads back, and the line net amount
 * is the amount. Letting somebody type them independently is how a
 * column and a fact come to disagree.
 */
function columnsFor(line) {
  return {
    description: String(line["BT-153"] ?? "").trim(),
    amount: line["BT-131"] === "" || line["BT-131"] === undefined ? null : Number(line["BT-131"]),
    costCentre: String(line["BT-133"] ?? "").trim() || undefined,
  };
}

/**
 * What this stage shows, and what may be edited — decision 0114.
 *
 * **Fetched, not hardcoded.** Both lists here were constants until the
 * configuration existed, which made a customer's arrangement of their
 * own screen unreachable. The resolver's `line` flag says which belong
 * to a line, so the interface keeps no second list of its own — one
 * that would drift the first time a line field was added.
 */
let headerFields = [];
let lineFields = [];

async function loadFields(stageId) {
  try {
    const query = stageId ? `?stage=${encodeURIComponent(stageId)}` : "";
    const response = await fetch(`/api/field-visibility${query}`);
    if (!response.ok) return;
    const { fields } = await response.json();
    headerFields = fields.filter((f) => !f.line);
    lineFields = fields.filter((f) => f.line);
  } catch {
    // Rendering nothing is honest; guessing a field list is not.
  }
}


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
 * An input, or a picker where the standard closes the value.
 *
 * The **empty option matters**: a field a document did not supply must
 * stay unset rather than silently acquire the first code in the list.
 * Absent and "the first currency alphabetically" are very different
 * claims about a document.
 */
function codeInput(code, id, value) {
  const list = codeLists[code];
  if (!list) return null;

  const select = el("select", { id });
  select.append(el("option", { value: "", text: "—" }));
  for (const entry of list.codes) {
    // The code and its name together: `C62` means nothing without
    // "One (unit)" beside it.
    select.append(el("option", { value: entry.code, text: `${entry.code} · ${entry.label}` }));
  }
  select.value = value ?? "";

  // A value a document carried that the list does not know. Kept and
  // shown rather than silently dropped — losing what a supplier sent
  // would be worse than displaying something unfamiliar.
  if (value && !list.codes.some((entry) => entry.code === value)) {
    const unknown = el("option", { value, text: `${value} · not in ${list.id}` });
    select.append(unknown);
    select.value = value;
  }
  return select;
}

function field(spec, existing) {
  const value = existing?.[spec.field] ?? "";

  /**
   * A read-only field is **text, not a disabled input** — decision
   * 0114.
   *
   * A greyed-out box invites clicking and reads as broken. Plain text
   * says the value is information rather than something to change,
   * which is what `read` means: *"approvers should approve data, not
   * edit data."*
   */
  const control =
    spec.visibility === "read"
      ? el("div", {
          class: "readonly",
          id: `f-${spec.field}`,
          text: value === "" ? "—" : String(value),
        })
      : codeInput(spec.field, `f-${spec.field}`, value) ??
        el("input", {
          type: spec.type === "number" ? "number" : spec.type === "date" ? "date" : "text",
          id: `f-${spec.field}`,
          step: spec.type === "number" ? "0.01" : undefined,
          // What is already known is shown, so somebody correcting one
          // value does not have to retype the rest.
          value,
        });

  return el("div", { class: "kf" }, [
    // Labels by key, so a customer's language reaches the fields too.
    el("label", {
      for: `f-${spec.field}`,
      // The vocabulary's own description as a tooltip, so an
      // unfamiliar code is explicable without leaving the screen.
      title: spec.description,
      text: t(`field.${spec.field.toLowerCase()}`),
    }),
    control,
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
  const summed = lines.reduce((total, line) => total + (Number(line["BT-131"]) || 0), 0);
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
  const cell = (spec) => {
    if (spec.visibility === "read") {
      return el("td", {}, [el("div", { class: "readonly", text: line[spec.field] ?? "—" })]);
    }

    // BT-130 is a UN/ECE code, so the line table picks one too.
    const picker = codeInput(spec.field, undefined, line[spec.field]);
    const input =
      picker ??
      el("input", {
        type: spec.type === "number" ? "number" : "text",
        step: spec.type === "number" ? "0.01" : undefined,
        value: line[spec.field] ?? "",
      });

    input.addEventListener(picker ? "change" : "input", (event) => {
      line[spec.field] = event.target.value;
      updateTotals();
    });

    // BT-130 is three characters, so its column is narrow.
    return el("td", { class: spec.field === "BT-130" ? "short" : undefined }, [input]);
  };

  return el("tr", {}, [
    el("td", { class: "num muted", text: String(index + 1) }),
    ...lineFields.map(cell),
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
          ...lineFields.map((spec) =>
            el("th", {
              class: spec.type === "number" ? "num" : undefined,
              title: spec.description,
              text: t(`field.${spec.field.toLowerCase()}`),
            })
          ),
          el("th", { text: "" }),
        ]),
      ]),
      el("tbody", { id: "lines" }),
    ]),
    el("div", { class: "linefoot" }, [
      el("button", {
        text: t("viewer.addline"),
        onclick: () => {
          lines.push({});
          renderLines();
        },
      }),
      el("div", { class: "linetotal", id: "linetotal" }),
    ]),
  ]);
}

async function save(close) {
  const facts = {};
  // Only what this person could edit. A read-only value is information
  // they were shown, not a fact they supplied.
  for (const spec of headerFields.filter((f) => f.visibility === "edit")) {
    const control = document.getElementById(`f-${spec.field}`);
    if (!control) continue;
    const raw = String(control.value ?? "").trim();
    if (raw === "") continue; // Partial keying is allowed (decision 0071).
    facts[spec.field] = spec.type === "number" ? Number(raw) : raw;
  }

  // **Every line, not just the changed ones.** The writer replaces the
  // whole set (`DELETE` then reinsert), so sending a subset would
  // delete the rest. The server works out what actually changed for the
  // provenance trail (decision 0109).
  const payload = { facts };
  const usable = lines
    .filter((row) => lineFields.some((spec) => String(row[spec.field] ?? "").trim() !== ""))
    .map((line, index) => {
      const facts = {};
      // **Only editable fields are sent.** A read-only value the screen
      // displayed is not something this person changed, and submitting
      // it would record them as having keyed it (decision 0109).
      for (const spec of lineFields.filter((f) => f.visibility === "edit")) {
        const raw = line[spec.field];
        if (raw === undefined || raw === null || String(raw).trim() === "") continue;
        if (spec.type === "number") {
          facts[spec.field] = Number(raw);
        } else if (spec.field === "BT-130") {
          // A UN/ECE code, so it is upper-cased rather than stored in
          // whatever case somebody typed. `hur` and `HUR` are the same
          // unit and should not be two values.
          facts[spec.field] = String(raw).trim().toUpperCase();
        } else {
          facts[spec.field] = String(raw).trim();
        }
      }

      // BT-126 is the line identifier and is mandatory. Where a person
      // is typing a document nobody could read, its position IS its
      // identifier — stated rather than left blank.
      facts["BT-126"] = String(index + 1);

      return { lineNumber: index + 1, ...columnsFor(line), facts };
    });
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
export async function openViewer(task, onClose) {
  // Before rendering, so a field never appears as a text box and then
  // becomes a picker under somebody's hands.
  await loadCodeLists();
  // The STAGE decides what may be edited, so this cannot be fetched
  // once and reused across tasks sitting at different stages.
  await loadFields(task.stageId);
  current = task;
  // A document nobody could read usually has no lines at all, so the
  // table starts empty and the person adds what they see.
  lines = [];
  const shell = document.getElementById("viewer");

  const known = task.subject ?? {};
  const existing = {
    "BT-31": known.supplierVatId ?? "",
    "BT-27": known.supplierName ?? "",
    "BT-5": known.currency ?? "",
    "BT-2": known.issueDate ?? "",
    "BT-112": known.totalWithVat ?? "",
  };

  /**
   * Which fields describe the seller, the buyer, and neither —
   * decision 0115.
   *
   * **Derived from the standard, not listed here.** BG-4 collects the
   * seller's terms and BG-7 the buyer's, so an interface that kept its
   * own list would drift the first time a party field was added — which
   * is exactly what happened to the line fields before decision 0114.
   */
  const SELLER_FIELDS = ["BT-27", "BT-31", "BT-34", "BT-40"];
  const BUYER_FIELDS = ["BT-44", "BT-48", "BT-49", "BT-55", "BT-10"];

  const partyPanel = (titleKey, codes) => {
    const shown = headerFields.filter((f) => codes.includes(f.field));
    // A panel with nothing in it is worse than no panel: it says
    // "there should be something here" and there never will be.
    if (shown.length === 0) return null;
    return el("div", { class: "panel" }, [
      el("h3", { text: t(titleKey) }),
      el("div", { class: "vfields" }, shown.map((spec) => field(spec, existing))),
    ]);
  };

  /**
   * One status panel, not four — decision 0115.
   *
   * The operator's observation: four panels for four short values took
   * a lot of room to say very little. **Status, stage, waiting and
   * owner belong together** — they are one sentence about where this
   * document is, and reading them as a row of separate cards makes
   * that harder rather than easier.
   *
   * The space they were using now belongs to the seller and the buyer,
   * which the screen had nowhere to show at all.
   */
  const keyed = ["supplierVatId", "currency", "issueDate", "totalWithVat"].filter(
    (f) => known[f] !== null && known[f] !== undefined
  ).length;

  const statusItem = (labelKey, value, className) =>
    el("div", { class: className ? `statitem ${className}` : "statitem" }, [
      el("div", { class: "label", text: t(labelKey) }),
      el("div", { class: "value", text: value }),
    ]);

  const status = el("div", { class: "statusrow" }, [
    el("div", { class: "panel statusbar" }, [
      statusItem("viewer.status", `${t("tasks.notkeyed")} · ${keyed}/4 ${t("viewer.known")}`, "warn"),
      statusItem("tasks.stage", task.stageName ?? task.stageId),
      statusItem("tasks.waiting", waited(task.createdAt)),
      statusItem("tasks.owner", t(`tasks.${task.ownership}`)),
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
            // Seller and buyer side by side, in the space the four
            // status panels were using (decision 0115).
            el("div", { class: "parties" }, [partyPanel("viewer.seller", SELLER_FIELDS), partyPanel("viewer.buyer", BUYER_FIELDS)].filter(Boolean)),
            el("div", { class: "panel" }, [
              el("h3", { text: t("viewer.fields") }),
              // **Party fields removed**, or they would appear twice —
              // once in their own panel and once here.
              el(
                "div",
                { class: "vfields" },
                headerFields
                  .filter((spec) => ![...SELLER_FIELDS, ...BUYER_FIELDS].includes(spec.field))
                  .map((spec) => field(spec, existing))
              ),
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
