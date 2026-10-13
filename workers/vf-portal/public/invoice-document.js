import { t, el } from "/strings.js";
import { icon } from "/icons.js";

/**
 * **An invoice's or credit note's Document and Attachments, in the
 * supplier network — decision 0770.** The
 * Document is the file the customer received, as they received it: the
 * supplier's own PDF, or the page drawn from their e-invoice. Attachments
 * lists that file (and the e-invoice behind a page, where there is one)
 * to download, and nothing else: never the email around it, nor other
 * files that came with it.
 */
export function buildInvoiceDocumentTab(inv, linkId) {
  const base = `/api/invoices/${encodeURIComponent(linkId)}/${encodeURIComponent(inv.id)}/document`;
  const frame = el("iframe", { class: "vframe podocframe", id: "net-invdoc-frame", title: inv.invoiceNumber ?? "" });
  const status = el("div", { class: "muted sm", id: "net-invdoc-status", text: t("orderdoc.loading") });
  const content = el("div", { class: "podoc", id: "net-invdoc" }, [status, frame]);
  let loaded = false;
  function open() {
    if (loaded) return;
    loaded = true;
    frame.addEventListener("load", () => status.remove(), { once: true });
    frame.src = base;
  }
  return { content, open };
}

export function buildInvoiceAttachmentsTab(inv, linkId) {
  const base = `/api/invoices/${encodeURIComponent(linkId)}/${encodeURIComponent(inv.id)}/document`;
  const files = inv.documentFiles ?? [];
  // What each file is, in the supplier's words: their PDF or e-invoice as sent, or the page drawn from it.
  const detail = (f) => {
    if (f.key !== "original") return t(`network.invoice.file.${f.key}`);
    const type = f.contentType ?? "";
    return t(type.includes("pdf") ? "network.invoice.file.pdf" : type.includes("xml") ? "network.invoice.file.xml" : "network.invoice.file.other");
  };
  const row = (f) =>
    el("div", { class: "attachrow", "data-file": f.key }, [
      el("span", { class: "attachpick" }, [el("span", { class: "attachname", text: f.name }), el("span", { class: "attachdetail", text: detail(f) })]),
      el("a", { class: "actionlink", href: `${base}?file=${encodeURIComponent(f.key)}&download=1`, download: "", title: t("action.download") }, [icon("download"), el("span", { text: t("action.download") })]),
    ]);
  const content = el("div", { class: "attachpane", id: "net-attachments" }, [
    el("div", { class: "attachlist" }, [
      el("div", { class: "attachgroup" }, [el("div", { class: "attachhead", text: t("network.invoice.attachhead", { customer: inv.customer ?? "" }) }), ...files.map(row)]),
    ]),
    el("p", { class: "muted sm", text: t("network.invoice.attachnote") }),
  ]);
  return { content };
}
