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
      el("div", { class: "createmeta", text: [size(row.size), kindOf(row.name)].filter(Boolean).join(" · ") }),
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
      el("div", { class: "muted createempty", text: t("create.nothingyet") }),
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

function sendPanel() {
  if (targets.length === 0) {
    return el("div", { class: "panel" }, [
      el("div", { class: "cardhead" }, [el("h3", { text: t("create.upload") })]),
      el("div", { class: "muted", text: t("create.notargets") }),
    ]);
  }
  const select = el(
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

function render() {
  const shell = document.getElementById("shell");
  shell.replaceChildren(
    frame(
      el("div", {}, [
        topbar(t("create.heading"), t("create.subtitle")),
        el("div", { class: "creategrid" }, [sendPanel(), el("div", { id: "create-upload" }, [uploadPanel()])]),
      ])
    )
  );
}

function renderUpload() {
  document.getElementById("create-upload")?.replaceChildren(uploadPanel());
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

export async function open() {
  setCurrentScreen("create");
  upload = null;
  busy = false;
  const result = await getJson("/api/uploads/targets");
  targets = result.ok ? result.body?.targets ?? [] : [];
  limits = { maxFiles: result.body?.maxFiles ?? 50, maxBytes: result.body?.maxBytes ?? 15 * 1024 * 1024 };
  if (!targets.some((target) => target.id === chosen)) chosen = targets[0]?.id ?? "";
  render();
}
