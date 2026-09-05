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

let current = null;

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
  { code: "BT-1", label: "Invoice number", type: "text" },
  { code: "BT-2", label: "Issue date", type: "date" },
  { code: "BT-31", label: "Supplier VAT", type: "text" },
  { code: "BT-5", label: "Currency", type: "text" },
  { code: "BT-106", label: "Net before VAT", type: "number" },
  { code: "BT-110", label: "VAT amount", type: "number" },
  { code: "BT-112", label: "Total with VAT", type: "number" },
  { code: "BT-115", label: "Amount due", type: "number" },
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
    el("label", { for: `f-${spec.code}`, text: spec.label }),
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
    note("No document is retained for this invoice.");
    return;
  }
  const { url } = await response.json();
  window.open(url, "_blank", "noopener");
}

function note(message) {
  const box = document.getElementById("viewer-note");
  if (box) box.textContent = message;
}

async function save(close) {
  const facts = {};
  for (const spec of FIELDS) {
    const raw = document.getElementById(`f-${spec.code}`).value.trim();
    if (raw === "") continue; // Partial keying is allowed (decision 0071).
    facts[spec.code] = spec.type === "number" ? Number(raw) : raw;
  }

  if (Object.keys(facts).length === 0) {
    note("Nothing to save — key at least one field.");
    return;
  }

  const response = await fetch(`/api/invoices/${encodeURIComponent(current.subject.id)}/key`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ facts }),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    note(body.error ?? "Could not save.");
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
    note("Saved.");
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
  const shell = document.getElementById("viewer");

  const known = task.subject ?? {};
  const existing = {
    "BT-31": known.supplierVatId ?? "",
    "BT-5": known.currency ?? "",
    "BT-2": known.issueDate ?? "",
    "BT-112": known.totalWithVat ?? "",
  };

  shell.replaceChildren(
    el("div", { class: "vhead" }, [
      el("div", {}, [
        el("p", { class: "vtitle", text: "Key from document" }),
        el("p", {
          class: "sub",
          // Why this task exists, from what detection actually found.
          text: `${task.stageName ?? task.stageId} · ${task.subject?.type ?? "document"}`,
        }),
      ]),
      el("button", { class: "close", text: "Back to tasks", onclick: onClose }),
    ]),

    el("div", { class: "vbody" }, [
      el("div", { class: "vdoc" }, [
        el("div", { class: "vthumb", text: "Document" }),
        el("button", {
          class: "act",
          text: "Open in new window",
          onclick: () => openDocument(task.subject.id),
        }),
      ]),
      el("div", { class: "vfields" }, FIELDS.map((spec) => field(spec, existing))),
    ]),

    el("div", { class: "vfoot" }, [
      el("div", { class: "problem", id: "viewer-note", role: "status" }),
      el("button", { class: "primary", text: "Save keyed values", onclick: () => save(null) }),
    ])
  );
}
