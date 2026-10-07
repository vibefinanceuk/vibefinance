import { t } from "/strings.js";
import { el } from "/tasks.js";
import { icon } from "/icons.js";

/**
 * **The Attachments tab — decision 0571**, in place of the XML tab
 * (0273, 0383). Asked for live: *"call that tab Attachments instead, and
 * provide access to anything we have received"* — the email, the XML,
 * image or PDF, and anything sent with them.
 *
 * - **Loaded the first time the tab is opened**, not with the invoice:
 *   most people never open it, and the list is one more request.
 * - Grouped by the message each file came in, named by its reference
 *   (`MSG-7A86-7670-F2A5`), who sent it and when.
 * - Choosing a file shows it below the list: the email as a person reads
 *   it, XML and CSV rendered by `vf-app`, a PDF or an image as it is.
 *   A file `vf-app` will not show (an HTML or SVG attachment, a zip) is
 *   only downloaded, and says so.
 * - **Download** gives any file under its own name.
 * - The file first shown is the XML inside a PDF if there is one, else
 *   the email, else the first file that can be shown.
 */

/**
 * The pane, and what to call when the tab is opened. Loading happens
 * once per invoice; opening the tab again keeps what was chosen.
 *
 * **Its own state per call — decision 0659**, so a goods receipt's
 * pop-out can have the same tab (`base` its `/api/goods-receipts/:id`)
 * while an invoice's viewer is open beneath it.
 */
export function buildAttachmentsTab(invoiceId, { base = `/api/invoices/${encodeURIComponent(invoiceId)}`, id: paneId = "vattach", subject = "invoice" } = {}) {
  const state = { invoiceId, base, subject, loaded: false, failed: false, messages: [], files: [], selected: null };

  async function postJson(path) {
    try {
      const response = await fetch(path, { method: "POST" });
      return response.ok ? await response.json() : null;
    } catch {
      return null;
    }
  }

  /** A signed link for one file: a received part, or one of the invoice's own documents. */
  async function linkFor(file) {
    const body =
      file.kind === "part"
        ? await postJson(`${state.base}/attachments/${encodeURIComponent(file.messageId)}/${file.seq}/url`)
        : await postJson(`${state.base}/document-url?type=${encodeURIComponent(file.documentType)}`);
    return body?.url ?? null;
  }

  function keyOf(file) {
    return file.kind === "part" ? `${file.messageId}/${file.seq}` : `doc/${file.documentType}`;
  }

  function nameOf(file) {
    if (file.kind === "document") return t(file.documentType === "embedded_xml" ? "attachments.embedded" : "attachments.original");
    if (file.role === "original" && file.contentType === "message/rfc822") return t("attachments.email");
    return file.filename;
  }

  function size(bytes) {
    if (!bytes && bytes !== 0) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function when(iso) {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? String(iso ?? "") : `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
  }

  async function download(file) {
    const url = await linkFor(file);
    if (!url) return;
    const a = el("a", { href: `${url}${url.includes("?") ? "&" : "?"}download=1` });
    a.setAttribute("download", "");
    document.body.append(a);
    a.click();
    a.remove();
  }

  function firstToShow(files) {
    return (
      files.find((f) => f.documentType === "embedded_xml") ??
      files.find((f) => f.kind === "part" && f.role === "original" && f.view === "inline") ??
      files.find((f) => f.view === "inline") ??
      null
    );
  }

  async function show(content, file) {
    state.selected = file ? keyOf(file) : null;
    render(content);
    const holder = content.querySelector(".attachview");
    if (!holder) return;
    if (!file) {
      holder.replaceChildren(el("div", { class: "vthumb", text: t("attachments.choose") }));
      return;
    }
    if (file.view !== "inline") {
      holder.replaceChildren(el("div", { class: "vthumb", text: t("attachments.downloadonly") }));
      return;
    }
    const url = await linkFor(file);
    if (state.selected !== keyOf(file)) return;
    holder.replaceChildren(url ? refreshingFrame(url, () => linkFor(file), nameOf(file)) : el("div", { class: "vthumb", text: t(state.subject === "receipt" ? "receipts.attach.nofile" : "viewer.nodocument") }));
  }

  /**
   * A frame that asks for a fresh link whenever it loads again, as the
   * viewer's own frames do (decision 0380): a link lasts five minutes, and
   * only a load the viewer did not cause (a reload) needs a new one.
   */
  function refreshingFrame(firstUrl, mint, title) {
    const frame = el("iframe", { class: "vframe", title });
    let expectingLoad = false;
    const point = (url) => {
      expectingLoad = true;
      frame.src = url;
    };
    frame.addEventListener("load", async () => {
      if (expectingLoad) {
        expectingLoad = false;
        return;
      }
      const url = await mint();
      if (url) point(url);
    });
    point(firstUrl);
    return frame;
  }

  function fileRow(content, file) {
    const on = state.selected === keyOf(file);
    const detail = [file.filename && nameOf(file) !== file.filename ? file.filename : null, size(file.bytes)].filter(Boolean).join(" · ");
    const pick = el("button", { class: "attachpick", title: nameOf(file), onclick: () => show(content, file) }, [
      el("span", { class: "attachname", text: nameOf(file) }),
      detail ? el("span", { class: "attachdetail", text: detail }) : null,
    ].filter(Boolean));
    const save = el("button", { class: "actionlink", title: t("action.download"), onclick: () => download(file) }, [
      icon("download"),
      el("span", { text: t("action.download") }),
    ]);
    return el("div", { class: on ? "attachrow on" : "attachrow" }, [
      pick,
      file.thisInvoice ? el("span", { class: "attachthis", text: t("attachments.thisinvoice") }) : null,
      save,
    ].filter(Boolean));
  }

  function render(content) {
    if (!state.loaded) {
      content.replaceChildren(el("div", { class: "vthumb", text: t("attachments.loading") }));
      return;
    }
    if (state.failed) {
      content.replaceChildren(el("div", { class: "vthumb", text: t("attachments.failed") }));
      return;
    }
    if (state.files.length === 0) {
      content.replaceChildren(el("div", { class: "vthumb", text: t(state.subject === "receipt" ? "receipts.attach.empty" : "attachments.empty") }));
      return;
    }
    const groups = [];
    for (const m of state.messages) {
      const heading = (m.sender ? t("attachments.messagefrom") : t("attachments.message"))
        .replace("{message}", m.id)
        .replace("{sender}", m.sender ?? "")
        .replace("{source}", m.source ?? "")
        .replace("{when}", when(m.receivedAt));
      groups.push(
        el("div", { class: "attachgroup" }, [
          el("div", { class: "attachhead", text: heading }),
          ...state.files.filter((f) => f.messageId === m.id).map((f) => fileRow(content, f)),
        ])
      );
    }
    const others = state.files.filter((f) => f.kind === "document");
    if (others.length > 0) {
      groups.push(
        el("div", { class: "attachgroup" }, [
          el("div", { class: "attachhead", text: t("attachments.withinvoice") }),
          ...others.map((f) => fileRow(content, f)),
        ])
      );
    }
    const existing = content.querySelector(".attachview");
    content.replaceChildren(
      el("div", { class: "attachlist" }, groups),
      existing ?? el("div", { class: "attachview" })
    );
  }

  /**
   * The pane, and what to call when the tab is opened. Loading happens
   * once per invoice; opening the tab again keeps what was chosen.
   */
  const content = el("div", { class: "vpreview attachpane", id: paneId }, [
    el("div", { class: "vthumb", text: t("attachments.loading") }),
  ]);
  let started = false;
  async function open() {
    if (started) return;
    started = true;
    try {
      const response = await fetch(`${base}/attachments`);
      if (!response.ok) throw new Error(String(response.status));
      const body = await response.json();
      state.messages = body.messages ?? [];
      state.files = body.files ?? [];
    } catch {
      state.failed = true;
    }
    state.loaded = true;
    render(content);
    if (!state.failed && state.files.length > 0) await show(content, firstToShow(state.files));
  }
  return { content, open };
}
