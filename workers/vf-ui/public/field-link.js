/**
 * **The invoice form's half of the lasso — decision 0697.**
 *
 * Clicking a field (or tabbing into it) asks the document to show where
 * its value is. The last editable field to have focus is the lasso's
 * **target**: when the document sends back what was lassoed, it is read as
 * that field's kind of value and put there, exactly as if typed — the
 * same `input` and `change` events, so the line totals, the exception
 * marks and Save all see it the ordinary way.
 *
 * Listeners sit on the `document`, once, and read the `data-field` marks
 * `markField()` puts on every field: the header, the line table and the
 * Header Fields pop-out are built in different places, and none of them
 * needs to know about the lasso.
 */
import { MONEY_FIELDS, formatMoney, parseAmount, plainAmount } from "/money.js";
import { valueFromLasso, squash } from "/doc-words.js";
import { docLink } from "/doc-link.js";
import { t } from "/strings.js";

/** How a field's value is written: `amount`, `date`, `number` or `text`. */
export function fieldKind(spec) {
  if (MONEY_FIELDS.has(spec.field)) return "amount";
  if (spec.type === "date") return "date";
  if (spec.type === "number") return "number";
  return "text";
}

/**
 * Marks `node` as a field's control (an input, a picker, or the text of a
 * read-only field). `value` is needed only for read-only text, whose shown
 * form (`£1,234.50`) is not its value; `line` is the row of a line field.
 */
export function markField(node, { field, kind, value, line }) {
  if (!node?.dataset) return node;
  node.dataset.field = field;
  node.dataset.kind = kind;
  if (value !== undefined && value !== null) node.dataset.value = String(value);
  if (line !== undefined && line !== null) node.dataset.line = String(line);
  return node;
}

const state = {
  invoiceId: null,
  link: null,
  target: null,
  currency: () => "",
  lineDescription: () => "",
  readOnlyReason: () => null,
  // Decision 0701: where each header value is on the page, as recorded; and how to record more.
  regions: new Map(),
  regionsApi: null,
  recorded: new Set(),
  lastLocate: null,
  lastLasso: null,
};
let installed = false;

/**
 * **Where values are, recorded and read back — decision 0701.** The real
 * API calls; `connectFields({ regionsApi })` replaces them in tests.
 */
export const REGIONS_API = {
  async list(invoiceId) {
    try {
      const res = await fetch(`/api/invoices/${encodeURIComponent(invoiceId)}/regions`);
      if (!res.ok) return [];
      return (await res.json()).regions ?? [];
    } catch {
      return [];
    }
  },
  async record(invoiceId, field, body) {
    try {
      await fetch(`/api/invoices/${encodeURIComponent(invoiceId)}/regions/${encodeURIComponent(field)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {
      // Recording where a value is helps learning later; it never stops anyone working.
    }
  },
};

/** The same value: numbers by amount, text without case or punctuation (as vf-app's `sameValue`). */
function sameValue(a, b) {
  const x = Number(a);
  const y = Number(b);
  if (String(a ?? "").trim() !== "" && String(b ?? "").trim() !== "" && Number.isFinite(x) && Number.isFinite(y)) return Math.abs(x - y) < 0.005;
  return squash(a) !== "" && squash(a) === squash(b);
}

function isHeader(node) {
  return /^BT-\d{1,3}$/.test(node.dataset.field ?? "") && node.dataset.line === undefined;
}

function record(field, body) {
  if (!state.invoiceId || !state.regionsApi) return;
  const key = `${field}|${body.source}|${body.pageNumber}|${[body.box.x, body.box.y, body.box.w, body.box.h].map((n) => n.toFixed(3)).join(",")}|${body.value}`;
  if (state.recorded.has(key)) return;
  state.recorded.add(key);
  state.regionsApi.record(state.invoiceId, field, body);
}

/**
 * The viewer found a value. Recorded as where that field is (`found`) only
 * when there is no doubt: it appears once on the document, or beside its own
 * label — design §5, decision 4.
 */
function onLocated(message) {
  const asked = state.lastLocate;
  if (!asked || asked.field !== message.field || !message.best || !message.unambiguous || !asked.header) return;
  record(message.field, { pageNumber: message.best.pageNumber, box: message.best.box, label: message.best.label ?? null, value: asked.value, source: "found" });
}

function isEditable(node) {
  return node && /^(INPUT|SELECT|TEXTAREA)$/.test(node.tagName) && !node.disabled && !node.readOnly;
}

function valueOf(node) {
  if (/^(INPUT|SELECT|TEXTAREA)$/.test(node.tagName)) {
    return node.dataset.kind === "amount" ? parseAmount(node.value) : node.value;
  }
  return node.dataset.value ?? "";
}

function labelOf(node) {
  return t(`field.${node.dataset.field.toLowerCase()}`);
}

function locateFor(node) {
  if (!state.link) return;
  const value = String(valueOf(node) ?? "").trim();
  if (!value) {
    state.link.send("clear");
    return;
  }
  const message = { field: node.dataset.field, label: labelOf(node), kind: node.dataset.kind, value };
  state.lastLocate = { field: node.dataset.field, value, header: isHeader(node) };
  // Decision 0701: a value taken from the page with the box is shown exactly where it was taken.
  const region = isHeader(node) ? state.regions.get(node.dataset.field) : null;
  if (region && region.source !== "found" && sameValue(region.value, value)) message.region = { pageNumber: region.pageNumber, box: region.box };
  // A line's amount is looked for on its own row: beside its description.
  if (node.dataset.line !== undefined && node.dataset.field !== "BT-153") {
    const description = String(state.lineDescription(Number(node.dataset.line)) ?? "").trim();
    if (description) message.near = { field: "BT-153", kind: "text", value: description };
  }
  state.link.send("locate", message);
}

function onFocus(event) {
  const node = event.target?.closest?.("[data-field]");
  if (!node || !isEditable(node)) return;
  state.target = node;
  locateFor(node);
}

function onClick(event) {
  const node = event.target?.closest?.("[data-field]");
  // An editable field was handled on focus; this is read-only text.
  if (!node || /^(INPUT|SELECT|TEXTAREA)$/.test(node.tagName)) return;
  locateFor(node);
}

function reply(ok, reason, label, read) {
  state.link?.send("filled", { ok, reason: reason ?? null, label: label ?? null, read: read ?? null });
}

function choose(select, text) {
  const wanted = squash(text);
  const options = [...select.options].filter((o) => o.value);
  const hit =
    options.find((o) => squash(o.value) === wanted) ??
    options.find((o) => wanted && squash(o.textContent).includes(wanted)) ??
    options.find((o) => wanted.includes(squash(o.value)) && o.value.length >= 3);
  return hit?.value ?? null;
}

/**
 * Below this, a word Tesseract read is not trusted on its own: the lassoed
 * part of the page is read again by the AI (decision 0699). Tesseract gives
 * clean print 90 and more; a smudged or skewed word falls well under 75.
 */
export const OCR_TRUSTED = 75;

/** The header fields someone could fill now, for the AI to choose from (0699). */
function fillableFields() {
  const seen = new Set();
  const out = [];
  for (const node of document.querySelectorAll("[data-field]")) {
    if (!isEditable(node) || node.dataset.line !== undefined || seen.has(node.dataset.field)) continue;
    seen.add(node.dataset.field);
    out.push({ field: node.dataset.field, label: labelOf(node), kind: node.dataset.kind ?? "text" });
  }
  return out;
}

/**
 * What the document lassoed, put in the field that last had focus.
 *
 * Decision 0699: words Tesseract was unsure of, or that are not the
 * field's kind of value, are first read again by the AI (the document is
 * asked to send its cut-out); with no field chosen, the AI is asked which
 * field it looks like, and the answer is offered, never applied unasked.
 */
export function fillTarget(message) {
  if (message.box && message.pageNumber) state.lastLasso = { pageNumber: message.pageNumber, box: message.box, label: message.label ?? null };
  /**
   * **Nothing on screen can be changed — decision 0700.** Dan, 9 October
   * 2026, having lassoed on a task he had not claimed: *"the lasso was
   * having no effect"*. It says why (claim the task, or this stage does
   * not allow changes) and shows the words it read, so a look-up still
   * works; it does not ask the AI to fill a field nobody may fill.
   */
  const locked = state.readOnlyReason();
  if (locked) return reply(false, locked, null, message.text ?? "");
  const target = state.target;
  if (!target?.isConnected || !isEditable(target)) {
    if (message.source === "ai") {
      if (message.suggested) {
        const node = fieldNode(message.suggested);
        if (node) return state.link?.send("filled", { ok: false, reason: "viewer.lasso.suggest", text: message.text, suggestion: { field: message.suggested, label: labelOf(node) } });
      }
      return reply(false, "viewer.lasso.nofield");
    }
    const fields = fillableFields();
    if (!fields.length) return reply(false, "viewer.lasso.nofield");
    state.link?.send("readRegion", { purpose: "suggest", ocrText: message.text ?? "", context: message.context ?? "", fields });
    return;
  }
  const kind = target.dataset.kind ?? "text";
  const label = labelOf(target);

  if (message.source === "ocr" && target.tagName !== "SELECT") {
    const value = valueFromLasso(message.text, kind, parseAmount);
    if (value === null || (message.confidence ?? 0) < OCR_TRUSTED) {
      state.link?.send("readRegion", { purpose: "read", kind, label, ocrText: message.text ?? "", context: message.context ?? "" });
      return;
    }
  }

  const previous = String(valueOf(target) ?? "").trim();
  if (target.tagName === "SELECT") {
    const value = choose(target, message.text);
    if (value === null) return reply(false, "viewer.lasso.notinlist", label);
    target.value = value;
  } else {
    const value = valueFromLasso(message.text, kind, parseAmount);
    if (value === null) return reply(false, `viewer.lasso.wrongkind.${kind}`, label);
    if (kind === "amount") {
      const field = target.dataset.field;
      target.value = document.activeElement === target ? plainAmount(value) : formatMoney(value, state.currency(), field);
    } else {
      target.value = value;
    }
  }
  target.dispatchEvent(new Event("input", { bubbles: true }));
  target.dispatchEvent(new Event("change", { bubbles: true }));
  target.classList.add("lassofilled");
  setTimeout(() => target.classList.remove("lassofilled"), 1200);
  reply(true, null, label);

  // Decision 0701: a person pointed at where this value is. The strongest evidence there is.
  const where = state.lastLasso;
  const value = String(valueOf(target) ?? "").trim();
  if (where && value && isHeader(target)) {
    record(target.dataset.field, { pageNumber: where.pageNumber, box: where.box, label: where.label, value, previous, source: "lassoed" });
    state.regions.set(target.dataset.field, { pageNumber: where.pageNumber, box: where.box, value, source: previous && !sameValue(previous, value) ? "lassoed_corrected" : "lassoed" });
  }
}

/** The editable header control for `field`, if it is on screen. */
function fieldNode(field) {
  return [...document.querySelectorAll("[data-field]")].find((n) => n.dataset.field === field && n.dataset.line === undefined && isEditable(n)) ?? null;
}

/** "Put it there": the suggested field becomes the target and takes the value (0699). */
export function fillField(message) {
  const node = fieldNode(message.field);
  if (!node) return reply(false, "viewer.lasso.nofield");
  state.target = node;
  fillTarget({ text: message.text, source: "ai" });
}

/**
 * Connects the form on screen to the document of `invoiceId` — called
 * each time an invoice is opened. `currency()` is the invoice's currency
 * for showing a lassoed amount; `lineDescription(i)` is line `i`'s
 * description, to find that line's other values beside it.
 */
export function connectFields(invoiceId, { currency, lineDescription, readOnlyReason, makeLink = docLink, regionsApi = REGIONS_API } = {}) {
  // A fresh link each time, so nothing heard for the previous invoice lands on this one.
  state.link?.close();
  state.link = invoiceId ? makeLink(invoiceId) : null;
  state.link?.on("lassoed", fillTarget);
  state.link?.on("fillField", fillField);
  state.link?.on("located", onLocated);
  state.regionsApi = regionsApi;
  state.regions = new Map();
  state.recorded = new Set();
  state.lastLocate = null;
  state.lastLasso = null;
  if (invoiceId && regionsApi) {
    const forInvoice = invoiceId;
    regionsApi.list(invoiceId).then((regions) => {
      if (state.invoiceId !== forInvoice) return;
      for (const r of regions ?? []) if (r.current) state.regions.set(r.field, r);
    });
  }
  state.invoiceId = invoiceId;
  state.target = null;
  state.currency = currency ?? (() => "");
  state.lineDescription = lineDescription ?? (() => "");
  state.readOnlyReason = readOnlyReason ?? (() => null);
  if (!installed && typeof document !== "undefined") {
    document.addEventListener("focusin", onFocus);
    document.addEventListener("click", onClick);
    installed = true;
  }
}
