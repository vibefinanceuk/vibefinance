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
import { el, frame, topbar } from "/tasks.js";

let current = null;
/** The line table's working state — decision 0109. */
let lines = [];

/**
 * The current exceptions — decision 0119.
 *
 * Held so the panel and the field highlighting draw from **one
 * source**: a field marked as failing and a row explaining why must
 * never disagree, which they would the moment each kept its own copy.
 */
let exceptions = [];

/**
 * The invoice as stored — decision 0120.
 *
 * **Fetched, not inferred from the task list.** The task list carries a
 * summary of five fields for a queue row; the keying screen needs
 * everything somebody typed, and every line. Building `existing` from
 * the summary meant a person keyed ten fields, saved, came back and saw
 * five — and reasonably concluded nothing had saved.
 */
let stored = { facts: {}, lines: [], document: null };

async function loadInvoice(invoiceId) {
  stored = { facts: {}, lines: [], document: null };
  exceptions = [];
  try {
    const response = await fetch(`/api/invoices/${encodeURIComponent(invoiceId)}`);
    if (!response.ok) return;
    const body = await response.json();
    stored = { facts: body.facts ?? {}, lines: body.lines ?? [], document: body.document ?? null };
    // **What is wrong on arrival**, not only after saving. Somebody
    // opening a document with three failures should be told, rather
    // than having to change something first (decision 0119).
    exceptions = body.validation?.involves ?? [];
  } catch {
    // An empty form is wrong, and a form showing another invoice's
    // values would be worse.
  }
}

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
/**
 * A signed URL for the retained original — decision 0073.
 *
 * Minted on demand rather than held, because it expires in five minutes
 * and a URL fetched at render time would be stale before somebody
 * pressed anything.
 */
async function documentUrl(invoiceId) {
  const response = await fetch(`/api/invoices/${encodeURIComponent(invoiceId)}/document-url`, {
    method: "POST",
  });
  if (!response.ok) return null;
  return (await response.json()).url ?? null;
}

async function openDocument(invoiceId) {
  const url = await documentUrl(invoiceId);
  if (!url) {
    note(t("viewer.nodocument"));
    return;
  }
  window.open(url, "_blank", "noopener");
}

/**
 * The document, in the panel — decision 0123.
 *
 * **The browser renders it, not us.** A PDF in an `<iframe>` gets the
 * browser's own viewer, with scrolling and zoom already working; an
 * image goes in an `<img>`. Decision 0042 records that a *Worker*
 * cannot render a PDF, which was read for longer than it should have
 * been as "this cannot be previewed".
 *
 * **The URL expires in five minutes** (decision 0073), so a frame left
 * open through a long keying session goes blank. Refreshed when
 * somebody returns to the tab, which is when they would notice.
 */
async function showPreview(invoiceId, type) {
  const holder = document.getElementById("vpreview");
  if (!holder) return;

  const url = await documentUrl(invoiceId);
  if (!url) {
    // A document nothing retained is a real state, not a failure: an
    // invoice can exist with no original at all.
    holder.replaceChildren(el("div", { class: "vthumb", text: t("viewer.nodocument") }));
    return;
  }

  const isImage = String(type ?? "").startsWith("image/");
  holder.replaceChildren(
    isImage
      ? el("img", { src: url, alt: t("viewer.document"), class: "vimage" })
      : el("iframe", { src: url, class: "vframe", title: t("viewer.document") })
  );
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
  renderExceptions();
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
  renderExceptions();
        },
      }),
      el("div", { class: "linetotal", id: "linetotal" }),
    ]),
  ]);
}

/**
 * The validation panel — decision 0119.
 *
 * **Fixed height and scrolling**, so a document with fourteen
 * exceptions does not push the fields it is complaining about off the
 * screen. The panel is a companion to the form, not a thing that
 * displaces it.
 */
/**
 * The action icons — decision 0122.
 *
 * Drawn inline rather than pulled from a library: this interface has no
 * build step, and a dependency for eight shapes would be a dependency
 * to keep current for eight shapes.
 *
 * `stroke="currentColor"` so they follow the customer's livery and the
 * light/dark surface without a second set (decisions 0096, 0108).
 *
 * **Each icon has to be true.** `discard` archives and deletes nothing
 * (decision 0078), so a waste bin would say something the system does
 * not do — the archive box is the honest shape. `release` is an open
 * padlock because claiming a task *is* a lock and locks never expire
 * (decision 0104), so letting go is unlocking.
 */
export const ICONS = {
  // Arrows to the four corners — "make this bigger", not "leave here".
  expand:
    '<path d="M4 8V4h4M16 4h4v4M20 12v4h-4M8 20H4v-4"/>',
  // A down arrow into a tray, as the reference has it.
  save:
    '<path d="M12 3v10m0 0 4-4m-4 4-4-4M4 17v3h16v-3"/>',
  // A checkmark. Nothing else reads as "done" as immediately.
  complete:
    '<path d="M4 12.5 9.5 18 20 6"/>',
  // An open padlock: a claim is a lock, so releasing is unlocking.
  release:
    '<path d="M6 11h12v9H6zM9 11V7a3 3 0 0 1 6 0"/>',
  // An arrow curving back — to an earlier stage.
  return:
    '<path d="M9 5 4 10l5 5M4 10h11a5 5 0 0 1 0 10h-6"/>',
  // Leaving the building entirely: an arrow out of a box.
  return_to_supplier:
    '<path d="M14 4h6v16h-6M10 8l4 4-4 4M14 12H3"/>',
  // An archive box, NOT a waste bin: discarding archives and deletes
  // nothing.
  discard:
    '<path d="M3 6h18v4H3zM5 10v10h14V10M10 14h4"/>',
  // A closed padlock, the mirror of release.
  claim:
    '<path d="M6 11h12v9H6zM9 11V7a3 3 0 0 1 6 0v4"/>',
};

function icon(name) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.6");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.innerHTML = ICONS[name] ?? "";
  return svg;
}

/**
 * What a task action needs, beyond a task id — decision 0138.
 *
 * **Returning and returning to a supplier need a reason.** Decision
 * 0075 made that a requirement rather than a courtesy: a document that
 * came back with no explanation is one the next person cannot act on.
 *
 * Discarding needs one too (0078) — *"nothing goes back"*, so the
 * record of why is all there is.
 */
const ACTIONS_NEEDING_A_REASON = ["return", "return_to_supplier", "discard"];

/**
 * Do something to this task.
 *
 * **The server decides what may be done** (decision 0103); this only
 * asks. A refusal is shown rather than swallowed, because a button that
 * appears to work and does not is worse than one that is absent.
 */
async function runAction(name, task, onClose) {
  let body = {};

  if (ACTIONS_NEEDING_A_REASON.includes(name)) {
    const reason = window.prompt(t(`action.${name}`) + "\n\n" + t("action.whyreason"));
    // **Cancelled means cancelled**, and an empty reason is not a
    // reason — decision 0075 refuses one server-side too.
    if (reason === null || reason.trim() === "") return;
    body = { reason: reason.trim() };
  }

  const path = name.replace(/_/g, "-");
  const response = await fetch(`/api/tasks/${encodeURIComponent(task.id)}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const failure = await response.json().catch(() => ({}));
    note(failure.error ?? t("viewer.actionfailed"));
    return;
  }

  // The task is finished or moved, so the viewer has nothing left to
  // show. Closing returns to the list, which is where the answer is.
  onClose();
}

/**
 * One action: icon above its label, in a row — decision 0122.
 *
 * **Still the server's decision** which appear (decision 0103). Giving
 * them icons changes how they look, not where they are decided.
 */
function actionLink(name, { onclick, primary } = {}) {
  const node = el("button", {
    class: primary ? "actionlink primary" : "actionlink",
    // A label a person can read, because an icon alone is a guess. The
    // reference this came from labels every one of its three.
    title: t(`action.${name}`),
    ...(onclick ? { onclick } : { disabled: "disabled" }),
  });
  node.append(icon(name), el("span", { text: t(`action.${name}`) }));
  return node;
}

function exceptionPanel() {
  return el("div", { class: "panel exceptions" }, [
    el("h3", { text: t("viewer.exceptions") }),
    el("div", { class: "exlist", id: "exlist" }),
  ]);
}

/** One row: what is wrong, and where. */
function exceptionRow(failure) {
  const where = failure.line ? ` · ${t("viewer.online")} ${failure.line}` : "";
  const value = failure.value ? ` · ${failure.value}` : "";

  return el("div", { class: "exrow" }, [
    el("div", { class: "extext", text: t(`check.${failure.check}`) }),
    el("div", {
      class: "exwhere",
      // The fields it involves, so a person can look at the panel and
      // know where to go without hovering anything.
      text: failure.fields.map((f) => t(`field.${f.toLowerCase()}`)).join(", ") + where + value,
    }),
  ]);
}

/**
 * Mark the fields an exception involves, and say why on hover.
 *
 * **The reason travels with the highlight.** A red box that does not
 * explain itself makes somebody hunt through a list to find out which
 * of fourteen exceptions is theirs.
 */
function markFields() {
  for (const node of document.querySelectorAll(".kf.failing, .linetable td.failing")) {
    node.classList.remove("failing");
    node.removeAttribute("title");
  }

  for (const failure of exceptions) {
    const reason = t(`check.${failure.check}`);
    for (const code of failure.fields) {
      const control = document.getElementById(`f-${code}`);
      // A field this stage does not show cannot be highlighted, and
      // that is not an error: the exception still appears in the panel.
      if (control?.closest(".kf")) {
        const box = control.closest(".kf");
        box.classList.add("failing");
        box.title = reason;
      }

      // Line fields, on the row the failure names — or every row, when
      // it names none, because `line_sum` is about all of them.
      const rows = document.querySelectorAll("#lines tr");
      const index = lineFields.findIndex((f) => f.field === code);
      if (index >= 0) {
        for (const [n, row] of rows.entries()) {
          if (failure.line && failure.line !== n + 1) continue;
          const cell = row.children[index + 1];
          if (cell) {
            cell.classList.add("failing");
            cell.title = reason;
          }
        }
      }
    }
  }
}

function renderExceptions() {
  const list = document.getElementById("exlist");
  if (!list) return;

  list.replaceChildren(
    ...(exceptions.length
      ? exceptions.map(exceptionRow)
      : [el("div", { class: "exrow muted", text: t("viewer.noexceptions") })])
  );
  markFields();
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

  /**
   * **The verdict is advisory** (decision 0072). Validation is re-run
   * and reported, and nothing re-evaluates the rules — so this says
   * whether the document would now pass, not that anything has moved.
   *
   * The panel carries the detail now, so the note says only that the
   * save worked. **An English sentence was built here in JavaScript**
   * until decision 0119 — a German customer read it in English, which
   * is the thing decision 0107 exists to prevent.
   */
  exceptions = body.validation?.involves ?? [];
  renderExceptions();
  note(t("viewer.saved"));

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
  // Cleared and then filled by `loadInvoice`, so one document's
  // exceptions never appear against another.
  await loadInvoice(task.subject.id);
  // The lines as stored, so keyed ones come back. Held by field code,
  // which is what the table edits.
  lines = stored.lines.map((line) => ({ ...line.facts }));

  const shell = document.getElementById("viewer");

  const known = task.subject ?? {};
  /**
   * Everything the document carries, by field code — decision 0120.
   *
   * The facts are the truth (decision 0109), so the summary's five
   * columns are only a fallback for a field the facts happen not to
   * hold.
   */
  const existing = {
    "BT-31": known.supplierVatId ?? "",
    "BT-27": known.supplierName ?? "",
    "BT-5": known.currency ?? "",
    "BT-2": known.issueDate ?? "",
    "BT-112": known.totalWithVat ?? "",
    ...stored.facts,
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
              // Filled once the signed URL is minted, so the panel has
              // somewhere to put it and does not jump when it arrives.
              el("div", { class: "vpreview", id: "vpreview" }, [
                el("div", { class: "vthumb", text: t("viewer.document") }),
              ]),
              /**
               * The actions, below the document — decision 0122.
               *
               * A horizontal row rather than a stack of full-width
               * buttons: they belong to the document above them, and
               * eight stacked buttons read as a menu rather than as
               * things to do with what is on screen.
               */
              el("div", { class: "actionrow" }, [
                actionLink("expand", { onclick: () => openDocument(task.subject.id) }),
                actionLink("save", { onclick: () => save(null), primary: true }),
                // What else this task offers is the SERVER's decision
                // (decision 0103) — collecting them visually does not
                // move where they are decided.
                ...task.actions
                  .filter((a) => a !== "key")
                  .map((a) => actionLink(a, { onclick: () => runAction(a, task, onClose) })),
              ]),
            ]),
            exceptionPanel(),
          ]),
        ]),
      ])
    )
  );

  renderLines();
  renderExceptions();
  // Not awaited: the form is usable while the document loads, and a
  // slow R2 fetch should not hold up somebody who knows what to type.
  showPreview(task.subject.id, stored.document?.contentType);
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
