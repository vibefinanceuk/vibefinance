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
import { icon } from "/icons.js";
import { processRow } from "/process-row.js";

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

/** Set on open, from what the stage permits (decision 0142). */
let canEditAnything = true;

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

/**
 * Where this invoice has been — decision 0151.
 *
 * The operator's idea, from the rules screen's chevrons: **the same
 * display at the head of the viewer**, with the current stage marked
 * and how long each took beneath.
 *
 * Nothing had to be recorded for it. `stage_visits` has held a
 * timestamp per visit since decision 0009; leaving is the next visit's
 * arrival, and the duration is the gap.
 */
let progress = { inProcess: false, stages: [] };

async function loadProgress(invoiceId) {
  progress = { inProcess: false, stages: [] };
  try {
    const response = await fetch(`/api/invoices/${encodeURIComponent(invoiceId)}/progress`);
    if (response.ok) progress = await response.json();
  } catch {
    // A path nobody can show is not a document nobody can key. The
    // viewer works without it.
  }
}

/**
 * The chevron row, with what happened at each stage beneath.
 *
 * **Time, in the unit a person would use.** "4d 5h" and "40m", because
 * somebody scanning wants to know whether a stage took a moment or a
 * fortnight — the server decides the words, so a German customer reads
 * them in German.
 */
function progressRow() {
  if (!progress.inProcess || progress.stages.length === 0) return null;

  return el("div", { class: "panel" }, [
    processRow(
      progress.stages.map((stage) => ({
        ...stage,
        /**
         * **Every period, in the one box** — the operator's
         * refinement:
         *
         * > If a process stage is returned to, we do not need another
         * > box in the flow — we simply add another entry and exit
         * > timestamp in the same stage box.
         *
         * A stage entered twice took time twice, and the second time is
         * often the interesting one: it is what happened after somebody
         * sent the document back.
         */
        detail: (stage.periods ?? [])
          .map((period) =>
            period.leftAt
              ? period.duration
              : // Still here: how long it has been, rather than a blank
                // where a duration would go.
                t("progress.since").replace("{when}", shortWhen(period.enteredAt))
          )
          .filter(Boolean)
          .join(" · "),
      })),
      progress.currentStageId,
      // **No handler.** A chevron here reports where the document has
      // been; it is not a place to send it.
      null
    ),
  ]);
}

/** A timestamp somebody can read at a glance. */
function shortWhen(when) {
  if (!when) return "";
  return when.slice(0, 16).replace(" ", " ");
}

async function loadInvoice(invoiceId) {
  stored = { facts: {}, lines: [], document: null };
  exceptions = [];
  try {
    const response = await fetch(`/api/invoices/${encodeURIComponent(invoiceId)}`);
    if (!response.ok) return;
    const body = await response.json();
    stored = {
      facts: body.facts ?? {},
      lines: body.lines ?? [],
      document: body.document ?? null,
      // Whether the document could be read at all — decision 0161.
      intake: body.intake ?? null,
      // Who we matched this invoice to — decision 0219.
      supplier: body.supplier ?? null,
      // And which of our own units it is for — decision 0224.
      buyer: body.buyer ?? null,
      buyerUnplaced: body.buyerUnplaced ?? null,
      /**
       * **Which unit this document belongs to** — decision 0198, and
       * kept because it decides which fields may be edited (decision
       * 0197). Reported by the route since decision 0036 and read by
       * nothing until now.
       */
      orgUnitId: body.orgUnitId ?? null,
    };
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

async function loadFields(stageId, unitId) {
  try {
    const parts = [];
    if (stageId) parts.push(`stage=${encodeURIComponent(stageId)}`);
    // Absent means the group's answer, which is what every caller got
    // before decision 0198.
    if (unitId) parts.push(`unit=${encodeURIComponent(unitId)}`);
    const query = parts.length > 0 ? `?${parts.join("&")}` : "";
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
    ...lineFields.map(cell),
    el("td", {}, [
      /**
       * **Structure, not a field** — decision 0144.
       *
       * Field visibility governs fields. Adding and removing a line
       * changes the shape of the document, and nothing governed it —
       * so an approver on a read-only stage could add a line and save
       * it, with every field on that line rendered as text.
       */
      ...(canEditAnything
        ? [
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
          ]
        : []),
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
          // **No row counter** — decision 0173. Line no. carries the
          // sequence where a document does not give one, so a second
          // column of the same numbers said nothing.
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
      // Structure, not a field — decision 0144. See `lineRow`.
      ...(canEditAnything
        ? [
            el("button", {
              text: t("viewer.addline"),
              onclick: () => {
                lines.push({});
                renderLines();
                renderExceptions();
              },
            }),
          ]
        : []),
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

/**
 * A document nothing could read — decision 0161.
 *
 * **Said before the exceptions, because it explains them.** Every
 * arithmetic check fails on an invoice with no facts, and a person
 * reading *"net plus VAT does not equal the total"* on an empty form
 * is being told the wrong thing.
 *
 * Decision 0055 made an unreadable document an invoice with no facts,
 * waiting for a person to key it — which is right. Nobody told the
 * person.
 */
function unreadableNote() {
  if (!stored.intake || stored.intake.readable) return null;

  return el("div", { class: "unreadable" }, [
    el("div", { text: t("viewer.unreadable") }),
    // What was tried, for somebody who wants to know why — a scanned
    // PDF and a corrupt file are different problems.
    ...(stored.intake.attempted
      ? [el("div", { class: "sm muted", text: `${t("viewer.tried")} ${stored.intake.attempted}` })]
      : []),
  ]);
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
/**
 * What a person needs before they start — decisions 0175, 0176.
 *
 * **Inside the topbar**, above its rule, because these identify the
 * document rather than being the first row of content about it.
 */
function subhead(task) {
  return el("div", { class: "subhead sm muted" }, [
    // Omitted rather than invented on a document nobody is waiting on
    // (decision 0167).
    ...(task.createdAt
      ? [el("div", { text: `${t("viewer.waitinglabel")} ${waited(task.createdAt)}` })]
      : []),
    /**
     * **An address, not "Mine"** — decision 0175.
     *
     * *"Owner: Mine"* tells the person holding a task the one thing
     * they already know, and tells everybody else nothing.
     *
     * A task nobody has claimed **says so** rather than saying nothing:
     * an absent line reads as a screen that forgot, and unclaimed is a
     * real and useful answer — it means anybody may take it.
     */
    /**
     * **Who it belongs to, not who has locked it** — decision 0180.
     *
     * This read `lockedBy`, which is set only once somebody **claims**
     * a task — so a task sitting in its own owner's queue reported
     * *"Owner: Nobody yet"*.
     *
     * Assignment and claiming are different facts (decision 0104: a
     * claim **is** a lock). The owner is who it belongs to; a claim
     * says somebody is working on it now.
     */
    ...(task.stageId
      ? [
          el("div", {
            text: `${t("viewer.ownerlabel")} ${
              task.ownedBy?.email ?? task.ownedBy?.name ?? t("tasks.unclaimed")
            }`,
          }),
        ]
      : []),
  ]);
}

export async function openViewer(task, onClose) {
  // Before rendering, so a field never appears as a text box and then
  // becomes a picker under somebody's hands.
  await loadCodeLists();

  /**
   * **The invoice first, because its unit decides what may be edited**
   * — decision 0198.
   *
   * Decision 0197 let a unit override a stage's field visibility and
   * the route enforced it while this asked without a unit — so a French
   * keyer saw an editable field and got a 403 on save. Decision 0144
   * inverted: the route stricter than the screen.
   *
   * These were the other way round, because until now nothing about the
   * document affected which fields it offered.
   */
  await loadInvoice(task.subject.id);

  // The STAGE decides what may be edited, so this cannot be fetched
  // once and reused across tasks sitting at different stages — and now
  // the UNIT does too.
  await loadFields(task.stageId, stored.orgUnitId ?? null);
  /**
   * Whether anything on this screen can be changed — decision 0142.
   *
   * Read from what the stage permits rather than from its name: a
   * customer who makes Validation read-only gets a read-only Validation
   * screen, which is what decision 0114 is for.
   */
  canEditAnything =
    headerFields.some((f) => f.visibility === "edit") ||
    lineFields.some((f) => f.visibility === "edit");

  current = task;
  // Already loaded above, because its unit decides which fields are
  // editable (decision 0198). Cleared and filled by `loadInvoice`, so
  // one document's exceptions never appear against another.
  await loadProgress(task.subject.id);
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
  /**
   * **No longer a panel of its own** — decision 0224. The Buyer card
   * shows our record of the unit an invoice is for, the way the Seller
   * card shows our record of the supplier.
   *
   * The list stays, because these fields must still be **kept out of
   * the main form**: they describe a party and the form below is
   * everything else. `SELLER_FIELDS` is read twice now — once for that,
   * and once as what the Seller card falls back to when nothing
   * matched.
   */
  const BUYER_FIELDS = ["BT-44", "BT-48", "BT-49", "BT-55", "BT-10"];

  /**
   * A pop-out that finds one thing and attaches it — decisions 0222 and
   * 0224.
   *
   * **One box, not a form.** Somebody looking at an invoice has a name,
   * or a VAT number, or an address on the page, and does not know which
   * of those we hold. Asking them to pick a field first is asking them
   * to guess what we stored.
   *
   * Shared by the supplier and buyer searches because they differ only
   * in **where they look and what they say** — two near-copies would
   * drift, and the second would get the debounce wrong.
   */
  function openSearch({ heading, hint, note, search, describe, choose }) {
    const input = el("input", { type: "text", class: "searchbox", placeholder: hint });
    const results = el("div", { class: "searchresults" });
    const box = el("div", { class: "popout" }, [
      el("h3", { text: heading }),
      el("p", { class: "muted", text: note }),
      input,
      results,
      el("button", { class: "secondary", text: t("viewer.supplier.close") }),
    ]);

    const backdrop = el("div", { class: "backdrop" }, [box]);
    const close = () => backdrop.remove();
    box.querySelector("button").onclick = close;
    backdrop.onclick = (e) => {
      if (e.target === backdrop) close();
    };

    let latest = 0;
    input.oninput = async () => {
      const q = input.value;
      /**
       * **Only the newest answer counts.** Typing is faster than the
       * network, and an earlier reply arriving late would replace a
       * later one — the list would then not match the box above it.
       */
      const mine = ++latest;

      if (q.trim().length < 2) {
        results.replaceChildren();
        return;
      }

      try {
        const found = await search(q);
        if (mine !== latest) return;

        if (found.length === 0) {
          results.replaceChildren(
            el("div", { class: "muted", text: t("viewer.supplier.nomatches") })
          );
          return;
        }

        results.replaceChildren(
          ...found.map((item) => {
            const [title, detail] = describe(item);
            const row = el("button", { class: "searchresult" }, [
              el("div", { text: title }),
              // **Everything a person might have searched on**, so they
              // can see why this row came back and whether it is right.
              el("div", { class: "muted", text: detail }),
            ]);

            row.onclick = async () => {
              try {
                const response = await choose(item);
                if (!response.ok) {
                  const body = await response.json();
                  results.replaceChildren(el("div", { class: "warn", text: body.error }));
                  return;
                }
                close();
                // Reopen on the same task, so the card redraws with the
                // choice applied.
                await openViewer(current, onClose);
              } catch {
                results.replaceChildren(
                  el("div", { class: "warn", text: t("viewer.supplier.choosefailed") })
                );
              }
            };

            return row;
          })
        );
      } catch {
        if (mine === latest) {
          results.replaceChildren(
            el("div", { class: "warn", text: t("viewer.supplier.searchfailed") })
          );
        }
      }
    };

    document.body.append(backdrop);
    input.focus();
  }

  /**
   * Finding a supplier by hand — decision 0222.
   *
   * **Leaving it is a real answer**, which the note says out loud: the
   * document may be from a genuinely new supplier, and the person
   * keying it cannot create one because we are the mirror.
   */
  function openSupplierSearch() {
    openSearch({
      heading: t("viewer.supplier.findheading"),
      hint: t("viewer.supplier.searchhint"),
      note: t("viewer.supplier.orleave"),
      search: async (q) => {
        const response = await fetch(`/api/suppliers/search?q=${encodeURIComponent(q)}`);
        if (!response.ok) throw new Error();
        return (await response.json()).suppliers;
      },
      describe: (s) => [
        s.name,
        [
          s.erp_identifier,
          s.erp_site_identifier,
          s.is_pay_site ? t("suppliers.pay") : null,
          s.vat_id,
          [s.address_line, s.city, s.postal_code].filter(Boolean).join(", "),
        ]
          .filter(Boolean)
          .join(" · "),
      ],
      choose: (s) =>
        fetch(`/api/invoices/${encodeURIComponent(current.subject.id)}/supplier`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ supplierId: s.id }),
        }),
    });
  }

  /**
   * Finding one of our own units by hand — decision 0224.
   *
   * **The same pop-out as decision 0222's**, with a different endpoint
   * and a different sentence: a supplier that is not on file may be
   * genuinely new and leaving it is a real answer, where an invoice in
   * no unit **stops at the org gate** (decision 0037) and one in the
   * wrong unit is handled wrongly by every stage after it.
   *
   * So this one does not say *"leave it"*.
   */
  function openBuyerSearch() {
    openSearch({
      heading: t("viewer.buyer.findheading"),
      hint: t("viewer.buyer.searchhint"),
      note: t("viewer.buyer.why"),
      search: async (q) => {
        const response = await fetch(`/api/org/units/search?q=${encodeURIComponent(q)}`);
        if (!response.ok) throw new Error();
        return (await response.json()).units;
      },
      describe: (u) => [
        u.name,
        [u.parent_name, u.parent_vat_id ?? u.vat_id, u.city].filter(Boolean).join(" · "),
      ],
      choose: async (u) => {
        const put = await fetch(
          `/api/invoices/${encodeURIComponent(current.subject.id)}/org`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ unitId: u.id }),
          }
        );
        return put;
      },
    });
  }

  /**
   * A card's title, with its own action beside it — decision 0228.
   *
   * **Top right, in space the heading already leaves empty.** The
   * operator: *"it might extend the card size if we place at the bottom
   * right. There is space in the top right already."*
   *
   * Which is the whole argument — a footer adds height to a card in a
   * column that is already short of it, and the heading row has room
   * doing nothing.
   *
   * **Re-routing is offered even when a match was found**, because a
   * wrong answer is worse than none: none stops at the org gate
   * (decision 0037), and a wrong one sails through every org-scoped
   * stage after it behaving correctly.
   */
  const cardHead = (title, action, onclick) =>
    el("div", { class: "cardhead" }, [
      el("h3", { text: title }),
      actionLink(action, { onclick }),
    ]);

  /**
   * **Label and value on one line** — decision 0221, from the
   * operator's own mock-up, and shared by both party cards since
   * decision 0224.
   *
   * Decision 0219 stacked them, which is how the keying form works
   * **because its values are inputs**. These are short, read-only and
   * scanned against a document — a label above each doubles the height
   * for nothing.
   */
  const pair = (label, value) =>
    el("div", { class: "sfield" }, [
      el("span", { class: "slabel", text: label }),
      el("span", { class: value ? "" : "muted", text: value || "—" }),
    ]);

  /**
   * **The address as a block, under one label.** Four labelled rows is
   * four labels for one thing, and an invoice prints an address as
   * lines.
   */
  const addressBlock = (party, label) => {
    const lines = [
      party.addressLine,
      party.city,
      party.countryName ?? party.country,
      party.postalCode,
    ].filter(Boolean);

    return el("div", { class: "sfield" }, [
      el("span", { class: "slabel", text: label }),
      lines.length > 0
        ? el("span", {}, lines.map((line) => el("div", { text: line })))
        : el("span", { class: "muted", text: "—" }),
    ]);
  };

  /**
   * The Buyer card — decision 0224.
   *
   * **The same shape as the Seller's, because it is the same question
   * from the other side**: our record of who this invoice is for, set
   * beside the image so a person can see it is addressed to us.
   *
   * The operator's reason it matters:
   *
   *   The Buyer Org should be defined before validation, or validation
   *   at the latest, because subsequent stages — Matching, Coding,
   *   Approval — are impacted by Org specific configurations.
   *
   * Which is exact. Decision 0196 scopes rule sets to a unit, decision
   * 0197 field visibility, decision 0199 who may act, decision 0202 who
   * is shown the work. **An invoice in the wrong unit is one every
   * later stage handles wrongly**, and silently.
   */
  const buyerPanel = () => {
    const b = stored.buyer;

    if (!b) {
      // Amber and a reason — the same ribbon as the Seller's, for the
      // reason decision 0161 gave.
      return el("div", { class: "panel needsattention" }, [
        cardHead(t("viewer.buyer"), "changebuyer", () => openBuyerSearch()),
        el("div", { class: "warn", text: t(`viewer.buyer.${stored.buyerUnplaced ?? "none"}`) }),
      ]);
    }

    return el("div", { class: "panel" }, [
      cardHead(t("viewer.buyer"), "changebuyer", () => openBuyerSearch()),
      /**
       * **No sub-line here** — decision 0227.
       *
       * It named the entity and the unit, which decision 0224 needed
       * when an invoice was assigned to a department beneath a company.
       * **Since decision 0226 the header names the company**, so the
       * two are the same row and the line repeated the Name directly
       * beneath it.
       *
       * The Seller card keeps its sub-line, and that is not an
       * inconsistency: it carries the ERP number, the site and whether
       * the site takes payment — none of which appears anywhere else on
       * the card.
       */
      el("div", { class: "sellergrid" }, [
        el("div", {}, [
          pair(t("viewer.supplier.name"), b.entityName),
          pair(t("viewer.supplier.vat"), b.vatId),
          pair(t("viewer.supplier.endpoint"), b.electronicAddress),
          pair(t("viewer.supplier.email"), b.email),
          pair(t("viewer.supplier.phone"), b.phone),
        ]),
        addressBlock(b, t("viewer.supplier.street")),
      ]),
    ]);
  };


  /**
   * The Seller card — decision 0220.
   *
   * **One card, not two.** Decision 0219 added a second panel beside
   * this one, which the operator refused for a plain reason: *"screen
   * real-estate constraints."* A viewer that shows the document and the
   * form side by side has no room for a card that repeats what the card
   * above it says differently.
   *
   * **Matched, it shows our record**; unmatched, what the document
   * said. Never both — the two answer the same question and showing
   * both makes a person compare them instead of comparing our record
   * against the image, which is the comparison that matters.
   */
  const sellerPanel = () => {
    const s = stored.supplier;

    if (!s) {
      /**
       * **What was extracted**, which is all there is — plus why no
       * supplier was found, because three causes need three actions.
       */
      const shown = headerFields.filter((f) => SELLER_FIELDS.includes(f.field));
      const why = stored.facts?.["supplier.unmatchedReason"];

      /**
       * **An amber ribbon, like decision 0161's unreadable notice** —
       * whose own words fit this exactly: *"nothing went wrong, and
       * there is something for a person to do."*
       *
       * An unmatched supplier is not an error. The document may be from
       * a genuinely new supplier, and leaving it is a real answer —
       * decision 0222's *"the user can just leave it, to be picked up
       * later in AP Review."*
       */
      return el("div", { class: "panel needsattention" }, [
        cardHead(t("viewer.seller"), "changeseller", () => openSupplierSearch()),
        el("div", { class: "warn", text: t(`viewer.supplier.${why ?? "none"}`) }),
        shown.length > 0
          ? el("div", { class: "vfields" }, shown.map((spec) => field(spec, existing)))
          : null,
      ].filter(Boolean));
    }

    return el("div", { class: "panel" }, [
      cardHead(t("viewer.seller"), "changeseller", () => openSupplierSearch()),
      /**
       * **Which site, and what it is for.** The reason this invoice
       * reached this record rather than one of its siblings — and since
       * decision 0218 that reason is a pay-site flag, which is nowhere
       * on the document.
       */
      el("div", {
        class: "sub",
        text: [s.erpIdentifier, s.erpSiteIdentifier, s.isPaySite ? t("suppliers.pay") : null]
          .filter(Boolean)
          .join(" · "),
      }),
      s.onHold
        ? el("div", { class: "warn", text: `${t("viewer.supplier.onhold")} ${s.holdReason ?? ""}` })
        : null,
      el("div", { class: "sellergrid" }, [
        el("div", {}, [
          pair(t("viewer.supplier.name"), s.name),
          pair(t("viewer.supplier.vat"), s.vatId),
          pair(t("viewer.supplier.endpoint"), s.electronicAddress),
          pair(t("viewer.supplier.email"), s.email),
          pair(t("viewer.supplier.phone"), s.phone),
        ]),
        addressBlock(s, t("viewer.supplier.street")),
      ]),
      /**
       * **Bottom right, like the document's own actions** — decision
       * 0228. The operator asked for it in the same shape as *Expand*,
       * *Complete*, *Release* and *Return*, and a person who has
       * learned where an action lives should not have to learn twice.
       */
    ].filter(Boolean));
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

  /**
   * The status panel is gone — decision 0175.
   *
   * It carried four things and **none of them earned a card**. The
   * status read *"Not yet keyed · 0/4 fields known"* on every document,
   * counting four fields nobody chose. The stage was already the
   * heading. Waiting and Owner were real and belonged beside the
   * document's own identity rather than below it.
   *
   * Removing it moves the process row (decision 0151) up a screenful,
   * which is what somebody opening an invoice actually looks at.
   */

  shell.replaceChildren(
    frame(
      el("div", {}, [
        /**
         * **The stage's own name**, labelled — decisions 0142, 0175.
         *
         * The heading read `Validation` alone, which is a word that
         * could be anything. `Stage: Validation` says what kind of
         * thing it is, and the same screen serves every stage — a
         * heading naming one would be the screen lying about where
         * somebody is.
         *
         * Beneath it, what identifies the document and what a person
         * needs before they start: the reference, how long it has
         * waited, and who has it. All three were in a card below the
         * fold, where the last two were the only ones worth reading.
         */
        topbar(
          /**
           * **Which line, where a task is about one** — decision 0183.
           *
           * A stage scoped `per_line` raises a task per invoice line,
           * and the viewer opens the whole document either way. Without
           * saying which line, somebody approving line three has to
           * work out that it is line three.
           */
          `${t("viewer.stagelabel")} ${task.stageName ?? task.stageId ?? t("viewer.title")}${
            task.lineNumber ? ` · ${t("tasks.line")} ${task.lineNumber}` : ""
          }`,
          task.subject?.id ? `${t("viewer.reflabel")} ${task.subject.id}` : "",
          [el("button", { text: t("viewer.back"), onclick: onClose })],
          [subhead(task)]
        ),

        // Fields beside actions, rather than fields above a footer.
        // Actions collected in one place (decision 0108).
        // Above the columns, because it is context for everything
        // below it rather than one panel among them.
        progressRow(),
        el("div", { class: "columns" }, [
          el("div", {}, [
            // Seller and buyer side by side, in the space the four
            // status panels were using (decision 0115).
            el("div", { class: "parties" }, [sellerPanel(), buyerPanel()].filter(Boolean)),
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
                /**
                 * **Save appears where something can be saved** —
                 * decision 0142.
                 *
                 * It was the screen's own, always offered. An approval
                 * task has every field read-only (decision 0114), so a
                 * Save that submits nothing is a button promising an
                 * effect it cannot have — which decision 0122 already
                 * called worse than an absent one.
                 *
                 * The dominant action becomes whatever the task
                 * actually offers, which for an approval is Complete.
                 */
                ...(canEditAnything
                  ? [actionLink("save", { onclick: () => save(null), primary: true })]
                  : []),
                // What else this task offers is the SERVER's decision
                // (decision 0103) — collecting them visually does not
                // move where they are decided.
                ...(task.actions ?? [])
                  .filter((a) => a !== "key")
                  .map((a, index) =>
                    actionLink(a, {
                      onclick: () => runAction(a, task, onClose),
                      // With nothing to save, the first thing the task
                      // offers is what somebody came to do.
                      primary: !canEditAnything && index === 0,
                    })
                  ),
              ]),
            ]),
            unreadableNote(),
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
