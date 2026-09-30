import { t } from "/strings.js";
import { el, frame, topbar, setCurrentScreen, hasMyPermission, openTaskById } from "/tasks.js";
import { icon } from "/icons.js";

/**
 * **Create → Upload documents — decision 0573.**
 *
 * The AP team brings invoices in themselves, from the mock-up Dan
 * approved on 30 September:
 *
 * - **Send to** chooses the AP upload source: a process, and the company
 *   its invoices belong to. Usually there is one, already chosen.
 * - Files are dropped or chosen: PDFs, images, XML or CSV, or a zip of
 *   them, unpacked here. Each file becomes one invoice.
 * - **One upload is one route message.** It is opened, each file is sent
 *   on its own and shown as it lands (read as email reads an
 *   attachment), then it is closed. So a long upload shows progress, and
 *   the Route monitor sees it as one message from this person.
 * - Each created invoice shows its number, supplier, total and stage,
 *   with **Open**.
 */

let targets = [];
let limits = { maxFiles: 50, maxBytes: 15 * 1024 * 1024 };
let chosen = "";
let upload = null; // { messageId, receivedAt, rows: [{ name, size, status, why, invoice }] }
let busy = false;
// Decision 0575: which tab, and the keyed invoice's choices.
let tab = "upload";
let keyedFile = null;
let selfBilled = false;
// Decision 0576: Batch upload — the layout, the published CSV mappings, and the preview.
let batchLayout = "template";
let batchMapping = "";
let batchMappings = null;
let preview = null; // { kind: "csv"|"xml", filename, layout, rows, counts, invoices, problems, problemsCsv, file, files }
let includeDuplicates = false;

async function getJson(path, init) {
  try {
    const response = await fetch(path, init);
    const body = await response.json().catch(() => null);
    return { ok: response.ok, status: response.status, body };
  } catch {
    return { ok: false, status: 0, body: null };
  }
}

function size(bytes) {
  if (bytes === null || bytes === undefined) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function kindOf(name) {
  return (name.match(/\.([A-Za-z0-9]+)$/)?.[1] ?? "").toUpperCase();
}

function money(total, currency) {
  if (total === null || total === undefined) return null;
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currency || "EUR" }).format(total);
  } catch {
    return `${currency ?? ""} ${Number(total).toFixed(2)}`.trim();
  }
}

function when(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

const skipped = (name) => /(^|\/)(__MACOSX|\.)/.test(name) || name.endsWith("/");

/**
 * **A zip, unpacked here** — its central directory read, each file
 * inflated with the browser's own `DecompressionStream`. Stored and
 * deflated entries only, which is every zip a person makes by hand;
 * folders, hidden files and a Mac's `__MACOSX` are left out.
 */
export async function unzip(buffer) {
  const view = new DataView(buffer);
  let end = -1;
  for (let i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 65557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      end = i;
      break;
    }
  }
  if (end < 0) throw new Error("not a zip");
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const files = [];
  for (let n = 0; n < count; n++) {
    if (view.getUint32(at, true) !== 0x02014b50) throw new Error("not a zip");
    const method = view.getUint16(at + 10, true);
    const compressed = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(new Uint8Array(buffer, at + 46, nameLength));
    at += 46 + nameLength + extraLength + commentLength;
    if (skipped(name)) continue;
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const raw = new Uint8Array(buffer, start, compressed);
    let bytes;
    if (method === 0) bytes = raw.slice();
    else if (method === 8) {
      const stream = new Response(raw).body.pipeThrough(new DecompressionStream("deflate-raw"));
      bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    } else continue;
    files.push({ name: name.split("/").pop(), type: "", bytes });
  }
  return files;
}

/** The files chosen, with any zip unpacked. */
async function expand(fileList) {
  const out = [];
  const notes = [];
  for (const file of fileList) {
    if (/\.zip$/i.test(file.name) || file.type === "application/zip" || file.type === "application/x-zip-compressed") {
      try {
        out.push(...(await unzip(await file.arrayBuffer())));
      } catch {
        notes.push(t("create.zipfailed").replace("{name}", file.name));
      }
    } else {
      out.push({ name: file.name, type: file.type, bytes: null, file });
    }
  }
  return { files: out, notes };
}

function statusPill(row) {
  const [key, tone] =
    row.status === "created"
      ? ["create.created", "ok"]
      : row.status === "reading"
        ? ["create.reading", "info"]
        : row.status === "notread"
          ? ["create.notread", "bad"]
          : ["create.waiting", "muted"];
  return el("span", { class: `createpill ${tone}`, text: t(key) });
}

function invoiceLine(invoice) {
  return [
    invoice.number ?? t("create.nonumber"),
    invoice.seller,
    money(invoice.total, invoice.currency),
    invoice.stage ? t("create.atstage").replace("{stage}", invoice.stage) : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

function fileRow(row) {
  // A reason from the server reads as a sentence, starting with a capital (as 0568's card does).
  const why = row.why ? row.why.charAt(0).toUpperCase() + row.why.slice(1) : null;
  const detail = row.status === "created" && row.invoice ? invoiceLine(row.invoice) : why;
  const open =
    row.invoice?.taskId
      ? el("button", {
          class: "actionlink",
          title: t("create.open"),
          onclick: () =>
            openTaskById({ id: row.invoice.taskId, stageId: row.invoice.taskStageId, subject: { id: row.invoice.id, type: "invoice" } }),
        }, [icon("expand"), el("span", { text: t("create.open") })])
      : null;
  return el("div", { class: "createrow" }, [
    el("div", { class: "createfile" }, [
      el("div", { class: "createname", text: row.name }),
      // A batch's invoice is its number, not a file (0576): no size or type.
      el("div", { class: "createmeta", text: row.size === null ? "" : [size(row.size), kindOf(row.name)].filter(Boolean).join(" · ") }),
    ]),
    el("div", { class: "createstatus" }, [statusPill(row), detail ? el("div", { class: "createmeta", text: detail }) : null].filter(Boolean)),
    el("div", { class: "createact" }, open ? [open] : []),
  ]);
}

function summary() {
  const count = (s) => upload.rows.filter((r) => r.status === s).length;
  const pills = [
    ["created", "ok", "create.ncreated"],
    ["reading", "info", "create.nreading"],
    ["waiting", "muted", "create.nwaiting"],
    ["notread", "bad", "create.nnotread"],
  ]
    .filter(([s]) => count(s) > 0)
    .map(([s, tone, key]) => el("span", { class: `createpill ${tone}`, text: t(key).replace("{n}", String(count(s))) }));
  return el("div", { class: "createsummary" }, pills);
}

function uploadPanel() {
  if (!upload) {
    return el("div", { class: "panel" }, [
      el("div", { class: "cardhead" }, [el("h3", { text: t("create.thisupload") })]),
      el("div", { class: "muted createempty", text: t(tab === "keyed" ? "create.nothingkeyed" : "create.nothingyet") }),
    ]);
  }
  const monitor = upload.messageId && hasMyPermission("Integration.Monitor")
    ? el("button", {
        class: "actionlink",
        title: t("create.monitor"),
        onclick: async () => {
          const { open } = await import("/route-monitor.js");
          await open({ message: upload.messageId });
        },
      }, [icon("systemalert"), el("span", { text: t("create.monitor") })])
    : null;
  return el("div", { class: "panel" }, [
    el("div", { class: "cardhead" }, [
      el("div", {}, [
        el("h3", { text: t("create.thisupload") }),
        upload.messageId
          ? el("div", {
              class: "createmeta",
              text: t("create.meta")
                .replace("{message}", upload.messageId)
                .replace("{n}", String(upload.rows.length))
                .replace("{when}", when(upload.receivedAt)),
            })
          : null,
      ].filter(Boolean)),
      monitor,
    ].filter(Boolean)),
    upload.note ? el("div", { class: "warn", text: upload.note }) : null,
    summary(),
    ...upload.rows.map(fileRow),
  ].filter(Boolean));
}

function targetSelect() {
  return el(
    "select",
    { id: "create-target", onchange: (e) => (chosen = e.target.value) },
    targets.map((target) =>
      el("option", {
        value: target.id,
        text: [target.name, target.processName, target.orgName].filter(Boolean).join(" · "),
        ...(target.id === chosen ? { selected: "selected" } : {}),
      })
    )
  );
}

function targetField() {
  return el("div", { class: "createfield" }, [
    el("label", { for: "create-target", text: t("create.sendto") }),
    targetSelect(),
    el("div", { class: "createmeta", text: t("create.sendtohint") }),
  ]);
}

/**
 * **Create an invoice — decision 0575.** One invoice keyed by hand:
 * where it goes, an optional file to start from (read first, so the form
 * opens filled in), and whether it is self-billed. Create makes it and
 * opens it straight into the viewer, where it is claimed and keyed as at
 * Validation.
 */
function keyedPanel() {
  if (targets.length === 0) {
    return el("div", { class: "panel" }, [
      el("div", { class: "cardhead" }, [el("h3", { text: t("create.keyed") })]),
      el("div", { class: "muted", text: t("create.notargets") }),
    ]);
  }
  const picker = el("input", {
    type: "file",
    id: "create-keyedfile",
    accept: ".pdf,.xml,.png,.jpg,.jpeg,.tif,.tiff",
    hidden: true,
    onchange: (e) => {
      keyedFile = e.target.files?.[0] ?? null;
      render();
    },
  });
  const box = el("input", {
    type: "checkbox",
    id: "create-selfbilled",
    onchange: (e) => (selfBilled = e.target.checked),
    ...(selfBilled ? { checked: "checked" } : {}),
  });
  return el("div", { class: "panel" }, [
    el("div", { class: "cardhead" }, [el("h3", { text: t("create.keyed") })]),
    el("div", { class: "createmeta createintro", text: t("create.keyedintro") }),
    targetField(),
    el("div", { class: "createfield" }, [
      el("label", { text: t("create.startfrom") }),
      el("div", { class: "createfilepick" }, [
        el("span", { id: "create-keyedname", text: keyedFile ? `${keyedFile.name} · ${size(keyedFile.size)}` : t("create.nofile") }),
        el("button", { class: "actionlink", onclick: () => picker.click() }, [icon("load"), el("span", { text: t("create.choosefile") })]),
        keyedFile
          ? el("button", { class: "actionlink", id: "create-keyedclear", onclick: () => ((keyedFile = null), render()) }, [
              icon("close"),
              el("span", { text: t("create.removefile") }),
            ])
          : null,
        picker,
      ].filter(Boolean)),
      el("div", { class: "createmeta", text: t("create.startfromhint") }),
    ]),
    el("label", { class: "createcheck", for: "create-selfbilled" }, [box, el("span", { text: t("create.selfbilled") })]),
    el("div", { class: "createmeta", text: t("create.selfbilledhint") }),
    el("div", { class: "createbuttons" }, [
      el("button", { class: "actionlink primary", id: "create-keyedgo", onclick: () => createKeyed(), ...(busy ? { disabled: "disabled" } : {}) }, [
        icon("create"),
        el("span", { text: t("create.createinvoice") }),
      ]),
    ]),
  ]);
}

function sendPanel() {
  if (targets.length === 0) {
    return el("div", { class: "panel" }, [
      el("div", { class: "cardhead" }, [el("h3", { text: t("create.upload") })]),
      el("div", { class: "muted", text: t("create.notargets") }),
    ]);
  }
  const select = targetSelect();
  const picker = el("input", {
    type: "file",
    id: "create-files",
    multiple: "multiple",
    accept: ".pdf,.xml,.csv,.png,.jpg,.jpeg,.tif,.tiff,.zip",
    hidden: true,
    onchange: (e) => send(e.target.files),
  });
  const drop = el("div", { class: busy ? "createdrop busy" : "createdrop", id: "create-drop" }, [
    el("div", { class: "createdropicon" }, [icon("load")]),
    el("div", { class: "createdroptitle", text: t("create.drop") }),
    el("div", {
      class: "createmeta",
      text: t("create.dropsub").replace("{n}", String(limits.maxFiles)).replace("{mb}", String(Math.round(limits.maxBytes / 1024 / 1024))),
    }),
    el("button", { class: "actionlink primary", id: "create-choose", onclick: () => picker.click(), ...(busy ? { disabled: "disabled" } : {}) }, [
      icon("load"),
      el("span", { text: t("create.choose") }),
    ]),
    picker,
  ]);
  drop.addEventListener("dragover", (e) => {
    e.preventDefault();
    drop.classList.add("over");
  });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("over");
    if (!busy) send(e.dataTransfer.files);
  });
  return el("div", { class: "panel" }, [
    el("div", { class: "cardhead" }, [el("h3", { text: t("create.upload") })]),
    el("div", { class: "createfield" }, [
      el("label", { for: "create-target", text: t("create.sendto") }),
      select,
      el("div", { class: "createmeta", text: t("create.sendtohint") }),
    ]),
    drop,
  ]);
}

async function selectTab(key) {
  tab = key;
  render();
  if (key === "batch" && batchMappings === null) {
    const result = await getJson("/api/uploads/mappings");
    batchMappings = result.ok ? result.body?.mappings ?? [] : [];
    if (!batchMapping && batchMappings[0]) batchMapping = batchMappings[0].id;
    if (tab === "batch") render();
  }
}

/**
 * **Batch upload — decision 0576**, as the mock-up Dan approved: the
 * layout (the VibeFinance template, or a supplier's own through its
 * mapping), the file, and what goes in the template. Choosing a file reads
 * it into a preview; nothing is made until Create.
 */
function batchPanel() {
  if (targets.length === 0) {
    return el("div", { class: "panel" }, [
      el("div", { class: "cardhead" }, [el("h3", { text: t("create.batch") })]),
      el("div", { class: "muted", text: t("create.notargets") }),
    ]);
  }
  const radio = (value, label, extra) =>
    el("label", { class: "createradio" }, [
      el("input", {
        type: "radio",
        name: "create-layout",
        id: `create-layout-${value}`,
        value,
        onchange: () => ((batchLayout = value), (preview = null), render()),
        ...(batchLayout === value ? { checked: "checked" } : {}),
      }),
      el("span", { text: label }),
      extra,
    ].filter(Boolean));
  const template = el("a", { class: "actionlink createinline", id: "create-template", href: "/api/uploads/template.csv", download: "vibefinance-batch-template.csv" }, [
    icon("download"),
    el("span", { text: t("create.template") }),
  ]);
  const mappings = batchMappings ?? [];
  const mappingSelect =
    mappings.length > 0
      ? el(
          "select",
          { class: "createinlineselect", id: "create-mapping", onchange: (e) => ((batchMapping = e.target.value), (batchLayout = "mapping"), (preview = null), render()) },
          mappings.map((m) => el("option", { value: m.id, text: `${m.name} · v${m.version}`, ...(m.id === batchMapping ? { selected: "selected" } : {}) }))
        )
      : el("span", { class: "createmeta", text: t(batchMappings === null ? "create.loading" : "create.nomappings") });
  const picker = el("input", {
    type: "file",
    id: "create-batchfiles",
    multiple: "multiple",
    accept: ".csv,.xml,.zip",
    hidden: true,
    onchange: (e) => readForPreview(e.target.files),
  });
  const drop = el("div", { class: busy ? "createdrop busy" : "createdrop", id: "create-batchdrop" }, [
    el("div", { class: "createdropicon" }, [icon("load")]),
    el("div", { class: "createdroptitle", text: t("create.batchdrop") }),
    el("div", { class: "createmeta", text: t("create.batchdropsub") }),
    el("button", { class: "actionlink primary", onclick: () => picker.click(), ...(busy ? { disabled: "disabled" } : {}) }, [icon("load"), el("span", { text: t("create.choosefile") })]),
    picker,
  ]);
  drop.addEventListener("dragover", (e) => {
    e.preventDefault();
    drop.classList.add("over");
  });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("over");
    if (!busy) readForPreview(e.dataTransfer.files);
  });
  return el("div", { class: "panel" }, [
    el("div", { class: "cardhead" }, [el("h3", { text: t("create.batch") })]),
    el("div", { class: "createmeta createintro", text: t("create.batchintro") }),
    targetField(),
    el("div", { class: "createfield" }, [
      el("label", { text: t("create.layout") }),
      radio("template", t("create.layouttemplate"), template),
      radio("mapping", t("create.layoutmapping"), mappingSelect),
      el("div", { class: "createmeta", text: t("create.layouthint") }),
    ]),
    drop,
    el("details", { class: "createdetails" }, [
      el("summary", { text: t("create.templatewhat") }),
      el("div", { class: "createmeta", text: t("create.templatecolumns") }),
    ]),
  ]);
}

const STATUS_PILL = { ready: ["create.ready", "ok"], duplicate: ["create.duplicate", "warn"], problem: ["create.problem", "bad"] };

function previewRow(inv) {
  const [key, tone] = STATUS_PILL[inv.status];
  const detail =
    inv.status === "problem"
      ? inv.problems.join(" · ")
      : inv.status === "duplicate"
        ? t("create.duplicateof").replace("{number}", inv.duplicateOf.number).replace("{when}", when(inv.duplicateOf.receivedAt.replace(" ", "T") + (inv.duplicateOf.receivedAt.includes("T") ? "" : "Z")))
        : inv.lines > 1 && tab === "batch" && preview?.kind === "csv"
          ? t("create.rowsinone").replace("{n}", String(inv.lines))
          : null;
  return el("tr", { class: inv.status === "ready" ? "" : `create${inv.status}` }, [
    el("td", { text: inv.number || "—" }),
    el("td", { text: inv.supplier ?? "—" }),
    el("td", { text: inv.date ?? "—" }),
    el("td", { class: "num", text: String(inv.lines) }),
    el("td", { class: "num", text: money(inv.total, inv.currency) ?? "—" }),
    el("td", {}, [el("span", { class: `createpill ${tone}`, text: t(key) }), detail ? el("div", { class: "createmeta", text: detail }) : null].filter(Boolean)),
  ]);
}

function toCreate() {
  return preview.invoices.filter((i) => i.status === "ready" || (includeDuplicates && i.status === "duplicate"));
}

function previewPanel() {
  const n = toCreate().length;
  const pills = [
    ["ready", "ok", "create.nready"],
    ["duplicate", "warn", "create.nduplicate"],
    ["problem", "bad", "create.nproblem"],
  ]
    .filter(([s]) => preview.counts[s] > 0)
    .map(([s, tone, key]) =>
      el("span", { class: `createpill ${tone}`, text: t(s === "duplicate" && preview.counts[s] === 1 ? "create.nduplicate1" : key).replace("{n}", String(preview.counts[s])) })
    );
  const meta =
    preview.kind === "csv"
      ? t("create.previewmeta").replace("{file}", preview.filename).replace("{rows}", String(preview.rows)).replace("{n}", String(preview.invoices.length)).replace("{layout}", preview.layout)
      : t("create.previewxml").replace("{n}", String(preview.invoices.length));
  const include = el("input", {
    type: "checkbox",
    id: "create-duplicates",
    onchange: (e) => ((includeDuplicates = e.target.checked), renderUpload()),
    ...(includeDuplicates ? { checked: "checked" } : {}),
  });
  const download = el("button", {
    class: "actionlink",
    id: "create-problems",
    onclick: () => {
      const a = el("a", { href: URL.createObjectURL(new Blob([preview.problemsCsv], { type: "text/csv" })), download: "problems.csv" });
      document.body.append(a);
      a.click();
      a.remove();
    },
  }, [icon("download"), el("span", { text: t("create.downloadproblems") })]);
  return el("div", { class: "panel" }, [
    el("div", { class: "cardhead" }, [
      el("div", {}, [el("h3", { text: t("create.preview") }), el("div", { class: "createmeta", text: meta })]),
      el("button", { class: "actionlink", id: "create-cancel", onclick: () => ((preview = null), render()) }, [icon("close"), el("span", { text: t("create.cancel") })]),
    ]),
    preview.problems.length > 0 ? el("div", { class: "warn", text: preview.problems.join(" ") }) : null,
    el("div", { class: "createsummary" }, pills),
    preview.invoices.length > 0
      ? el("div", { class: "createtablewrap" }, [
          el("table", { class: "createtable" }, [
            el("thead", {}, [
              el("tr", {}, ["create.colinvoice", "create.colsupplier", "create.coldate", "create.collines", "create.coltotal", null].map((k) =>
                el("th", { class: k === "create.collines" || k === "create.coltotal" ? "num" : "", text: k ? t(k) : "" })
              )),
            ]),
            el("tbody", {}, preview.invoices.map(previewRow)),
          ]),
        ])
      : null,
    preview.counts.duplicate > 0 ? el("label", { class: "createcheck", for: "create-duplicates" }, [include, el("span", { text: t("create.includeduplicates") })]) : null,
    el("div", { class: "createfoot" }, [
      el("div", { class: "createmeta", text: preview.counts.problem > 0 ? t("create.fixhint") : "" }),
      el("div", { class: "createbtns" }, [
        preview.counts.problem > 0 || preview.problems.length > 0 ? download : null,
        el("button", {
          class: "actionlink primary",
          id: "create-batchgo",
          onclick: () => createBatch(),
          ...(n === 0 || busy || preview.problems.length > 0 ? { disabled: "disabled" } : {}),
        }, [icon("create"), el("span", { text: t(n === 1 ? "create.createone" : "create.createn").replace("{n}", String(n)) })]),
      ].filter(Boolean)),
    ]),
  ].filter(Boolean));
}

/**
 * The file read into a preview: one CSV, by the layout chosen, or XML
 * invoices (a zip unpacked here), each read on its own. Nothing is kept.
 */
export async function readForPreview(fileList) {
  if (busy || !fileList || fileList.length === 0) return;
  busy = true;
  const chosenFiles = [...fileList];
  const csv = chosenFiles.filter((f) => /\.csv$/i.test(f.name));
  preview = null;
  let note = null;
  if (csv.length > 0) {
    if (chosenFiles.length > 1) note = t("create.onecsv");
    const file = csv[0];
    const q = batchLayout === "mapping" && batchMapping ? `layout=mapping&mapping=${encodeURIComponent(batchMapping)}` : "layout=template";
    const result = await getJson(`/api/uploads/preview?${q}&name=${encodeURIComponent(file.name)}`, { method: "POST", headers: { "Content-Type": "text/csv" }, body: file });
    if (result.ok) preview = { kind: "csv", file, ...result.body };
    else note = result.body?.error ?? t("create.failed");
  } else {
    const { files, notes } = await expand(chosenFiles);
    const xml = files.filter((f) => /\.xml$/i.test(f.name)).slice(0, 500);
    const invoices = [];
    for (const f of xml) {
      const result = await getJson(`/api/uploads/preview?layout=xml&name=${encodeURIComponent(f.name)}`, { method: "POST", headers: { "Content-Type": "application/xml" }, body: f.bytes ?? f.file });
      for (const inv of result.ok ? result.body?.invoices ?? [] : [{ key: `file|${f.name}`, number: "", status: "problem", problems: [result.body?.error ?? t("create.failed")], lines: 0 }]) {
        invoices.push({ ...inv, source: f });
      }
    }
    const counts = { ready: 0, duplicate: 0, problem: 0 };
    for (const inv of invoices) counts[inv.status] += 1;
    const q = (v) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    preview = {
      kind: "xml",
      filename: "",
      layout: "XML",
      rows: invoices.length,
      counts,
      invoices,
      problems: notes,
      problemsCsv: ["row,invoice_number,problem", ...invoices.flatMap((i) => i.problems.map((p) => ["", q(i.number), q(p)].join(",")))].join("\r\n") + "\r\n",
    };
    if (xml.length === 0) note = t("create.nothingtoread");
  }
  if (preview && note) preview.problems = [...(preview.problems ?? []), note];
  if (!preview && note) upload = { messageId: null, receivedAt: null, note, rows: [] };
  includeDuplicates = false;
  busy = false;
  render();
}

/**
 * Creates the batch: one upload; a CSV's invoices made a few at a time, or
 * each XML invoice sent as a file; then the results, as an upload's, with
 * Open.
 */
export async function createBatch() {
  if (busy || !preview || !chosen) return;
  const selected = toCreate();
  if (selected.length === 0) return;
  busy = true;
  const p = preview;
  upload = {
    messageId: null,
    receivedAt: null,
    note: null,
    rows: selected.map((inv) => ({ key: inv.key, name: inv.number || inv.source?.name || "—", size: null, status: "waiting", why: null, invoice: null })),
  };
  preview = null;
  render();
  const opened = await getJson("/api/uploads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourceId: chosen, kind: "batch", files: p.kind === "csv" ? 1 : selected.length }),
  });
  if (!opened.ok) {
    upload.note = opened.body?.error ?? t("create.failed");
    busy = false;
    render();
    return;
  }
  upload.messageId = opened.body.messageId;
  upload.receivedAt = opened.body.receivedAt;
  const id = encodeURIComponent(upload.messageId);
  const byKey = new Map(upload.rows.map((r) => [r.key, r]));
  if (p.kind === "csv") {
    const q = batchLayout === "mapping" && batchMapping ? `layout=mapping&mapping=${encodeURIComponent(batchMapping)}` : "layout=template";
    const CHUNK = 20;
    for (let from = 0; from < selected.length; from += CHUNK) {
      for (const r of upload.rows.slice(from, from + CHUNK)) r.status = "reading";
      renderUpload();
      const result = await getJson(
        `/api/uploads/${id}/batch?${q}&name=${encodeURIComponent(p.filename)}&from=${from}&count=${CHUNK}&duplicates=${includeDuplicates ? 1 : 0}`,
        { method: "POST", headers: { "Content-Type": "text/csv" }, body: p.file }
      );
      if (!result.ok) {
        for (const r of upload.rows.slice(from, from + CHUNK)) {
          r.status = "notread";
          r.why = result.body?.error ?? t("create.failed");
        }
        continue;
      }
      for (const m of result.body.made ?? []) {
        const r = byKey.get(m.key);
        if (r) {
          r.status = "created";
          r.invoice = m.invoice ?? null;
        }
      }
      for (const f of result.body.failed ?? []) {
        const r = byKey.get(f.key);
        if (r) {
          r.status = "notread";
          r.why = f.why;
        }
      }
      renderUpload();
    }
  } else {
    for (const inv of selected) {
      const r = byKey.get(inv.key);
      r.status = "reading";
      renderUpload();
      const f = inv.source;
      const result = await getJson(`/api/uploads/${id}/files?name=${encodeURIComponent(f.name)}`, {
        method: "POST",
        headers: { "Content-Type": "application/xml" },
        body: f.bytes ?? f.file,
      });
      if (result.ok && result.body?.captured) {
        r.status = "created";
        r.invoice = result.body.invoice ?? null;
      } else {
        r.status = "notread";
        r.why = result.body?.why ?? result.body?.error ?? t("create.failed");
      }
      renderUpload();
    }
  }
  await getJson(`/api/uploads/${id}/finish`, { method: "POST" });
  busy = false;
  render();
}

function render() {
  const shell = document.getElementById("shell");
  shell.replaceChildren(
    frame(
      el("div", {}, [
        topbar(t("create.heading"), t("create.subtitle")),
        // Decision 0575: a tab each, as the approved mock-up had.
        el(
          "div",
          { class: "doctabs createtabs" },
          [
            ["upload", "create.upload"],
            ["keyed", "create.keyed"],
            ["batch", "create.batch"],
          ].map(([key, label]) =>
            el("button", { class: tab === key ? "doctab on" : "doctab", id: `create-tab-${key}`, onclick: () => selectTab(key) }, [
              el("span", { text: t(label) }),
            ])
          )
        ),
        el("div", { class: "creategrid" }, [
          tab === "keyed" ? keyedPanel() : tab === "batch" ? batchPanel() : sendPanel(),
          el("div", { id: "create-upload" }, [tab === "batch" && preview ? previewPanel() : uploadPanel()]),
        ]),
      ])
    )
  );
}

function renderUpload() {
  document.getElementById("create-upload")?.replaceChildren(tab === "batch" && preview ? previewPanel() : uploadPanel());
}

/**
 * Sends the files, one at a time, into one upload. Nothing is sent
 * without somewhere to send it; a file over the size limit is shown as
 * not read, without being sent.
 */
export async function send(fileList) {
  if (busy || !chosen || !fileList || fileList.length === 0) return;
  busy = true;
  const { files: expanded, notes } = await expand([...fileList]);
  const files = expanded.slice(0, limits.maxFiles);
  if (expanded.length > limits.maxFiles) notes.push(t("create.toomany").replace("{n}", String(limits.maxFiles)));
  upload = {
    messageId: null,
    receivedAt: null,
    note: notes.join(" ") || null,
    rows: files.map((f) => ({ name: f.name, size: f.bytes ? f.bytes.length : f.file.size, status: "waiting", why: null, invoice: null })),
  };
  render();
  if (files.length === 0) {
    busy = false;
    render();
    return;
  }

  const opened = await getJson("/api/uploads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourceId: chosen, files: files.length }),
  });
  if (!opened.ok) {
    upload.note = opened.body?.error ?? t("create.failed");
    busy = false;
    render();
    return;
  }
  upload.messageId = opened.body.messageId;
  upload.receivedAt = opened.body.receivedAt;
  renderUpload();

  for (const [i, f] of files.entries()) {
    const row = upload.rows[i];
    if (row.size > limits.maxBytes) {
      row.status = "notread";
      row.why = t("create.toolarge").replace("{mb}", String(Math.round(limits.maxBytes / 1024 / 1024)));
      renderUpload();
      continue;
    }
    row.status = "reading";
    renderUpload();
    const result = await getJson(`/api/uploads/${encodeURIComponent(upload.messageId)}/files?name=${encodeURIComponent(f.name)}`, {
      method: "POST",
      headers: { "Content-Type": f.type || "application/octet-stream" },
      body: f.bytes ?? f.file,
    });
    if (result.ok && result.body?.captured) {
      row.status = "created";
      row.invoice = result.body.invoice ?? null;
    } else {
      row.status = "notread";
      row.why = result.body?.why ?? result.body?.error ?? t("create.failed");
    }
    renderUpload();
  }

  await getJson(`/api/uploads/${encodeURIComponent(upload.messageId)}/finish`, { method: "POST" });
  busy = false;
  render();
}

/**
 * Makes the invoice: a keyed upload, its file read first if there is
 * one, then opened in the viewer to be claimed and keyed. Where it has no
 * task this person can open, it is listed like an upload's file.
 */
export async function createKeyed() {
  if (busy || !chosen) return;
  busy = true;
  const file = keyedFile;
  upload = {
    messageId: null,
    receivedAt: null,
    note: null,
    rows: [{ name: file ? file.name : t("create.keyedrow"), size: file ? file.size : 0, status: "reading", why: null, invoice: null }],
  };
  render();
  const opened = await getJson("/api/uploads", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sourceId: chosen, kind: "keyed", files: file ? 1 : 0 }),
  });
  if (!opened.ok) {
    upload.note = opened.body?.error ?? t("create.failed");
    upload.rows[0].status = "notread";
    busy = false;
    render();
    return;
  }
  upload.messageId = opened.body.messageId;
  upload.receivedAt = opened.body.receivedAt;
  const id = encodeURIComponent(upload.messageId);
  const result = file
    ? await getJson(`/api/uploads/${id}/files?name=${encodeURIComponent(file.name)}${selfBilled ? "&selfBilled=1" : ""}`, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      })
    : await getJson(`/api/uploads/${id}/keyed`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selfBilled }),
      });
  await getJson(`/api/uploads/${id}/finish`, { method: "POST" });
  const row = upload.rows[0];
  if (result.ok && result.body?.captured) {
    row.status = "created";
    row.invoice = result.body.invoice ?? null;
  } else {
    row.status = "notread";
    row.why = result.body?.why ?? result.body?.error ?? t("create.failed");
  }
  busy = false;
  keyedFile = null;
  selfBilled = false;
  render();
  if (row.invoice?.taskId) {
    await openTaskById({ id: row.invoice.taskId, stageId: row.invoice.taskStageId, subject: { id: row.invoice.id, type: "invoice" } });
  }
}

export async function open() {
  setCurrentScreen("create");
  upload = null;
  busy = false;
  tab = "upload";
  keyedFile = null;
  selfBilled = false;
  preview = null;
  includeDuplicates = false;
  const result = await getJson("/api/uploads/targets");
  targets = result.ok ? result.body?.targets ?? [] : [];
  limits = { maxFiles: result.body?.maxFiles ?? 50, maxBytes: result.body?.maxBytes ?? 15 * 1024 * 1024 };
  if (!targets.some((target) => target.id === chosen)) chosen = targets[0]?.id ?? "";
  render();
}
