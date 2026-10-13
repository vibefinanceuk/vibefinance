import { t, el } from "/strings.js";
import { icon } from "/icons.js";

/**
 * **A purchase order's Document tab, in the supplier network — decision
 * 0760**: the order as the customer sends it, as a PDF made by their
 * VibeFinance. Loaded when the tab is first opened. Its downloads are on
 * the Attachments tab (decision 0763). VibeFinance's own copy is vf-ui's
 * `order-document.js`.
 */
export function buildOrderDocumentTab(order, linkId) {
  const base = `/api/orders/${encodeURIComponent(linkId)}/${encodeURIComponent(order.id)}/document`;
  const number = order.invoiceNumber ?? "";
  const frame = el("iframe", { class: "vframe podocframe", id: "net-document-frame", title: t("orderdoc.title").replace("{order}", number) });
  const status = el("div", { class: "muted sm", id: "net-document-status", text: t("orderdoc.loading") });
  const content = el("div", { class: "podoc", id: "net-document" }, [status, frame]);
  let loaded = false;
  async function open() {
    if (loaded) return;
    loaded = true;
    try {
      const response = await fetch(`${base}?format=pdf`);
      if (!response.ok) throw new Error(String(response.status));
      const blob = await response.blob();
      frame.src = URL.createObjectURL(blob.type === "application/pdf" ? blob : new Blob([blob], { type: "application/pdf" }));
      status.remove();
    } catch {
      loaded = false;
      status.textContent = t("orderdoc.failed");
      status.className = "warn sm";
    }
  }
  return { content, open };
}

/**
 * **The order's Attachments tab, in the supplier network — decision
 * 0763**: the order as the customer sends it, as PDF, UBL XML and CSV,
 * listed as the application lists files, each to download. Dan: *"format
 * as other locations with an Attachments tab, providing available
 * downloads."*
 */
export function buildOrderAttachmentsTab(order, linkId) {
  const base = `/api/orders/${encodeURIComponent(linkId)}/${encodeURIComponent(order.id)}/document`;
  const number = order.invoiceNumber ?? "order";
  const row = (format, ext, detail) =>
    el("div", { class: "attachrow", "data-made": format }, [
      el("span", { class: "attachpick" }, [el("span", { class: "attachname", text: `${number}.${ext}` }), el("span", { class: "attachdetail", text: detail })]),
      el("a", { class: "actionlink", id: `net-attach-${format}`, href: `${base}?format=${format}&download=1`, download: "", title: t("action.download") }, [icon("download"), el("span", { text: t("action.download") })]),
    ]);
  const content = el("div", { class: "attachpane", id: "net-attachments" }, [
    el("div", { class: "attachlist" }, [
      el("div", { class: "attachgroup" }, [
        el("div", { class: "attachhead", text: t("network.order.attachhead", { customer: order.customer ?? "" }) }),
        row("pdf", "pdf", t("orderdoc.pdf")),
        row("ubl", "xml", t("orderdoc.ubl")),
        row("csv", "csv", t("orderdoc.csv")),
      ]),
    ]),
  ]);
  return { content };
}
