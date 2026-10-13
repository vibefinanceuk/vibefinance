import { t, el } from "/strings.js";
import { icon } from "/icons.js";

/**
 * **A purchase order's Document tab, in the supplier network — decision
 * 0760**: the order as the customer sends it, as a PDF made by their
 * VibeFinance, with downloads as PDF, UBL XML and CSV. Loaded when the tab
 * is first opened. VibeFinance's own copy is vf-ui's `order-document.js`.
 */
export function buildOrderDocumentTab(order, linkId) {
  const base = `/api/orders/${encodeURIComponent(linkId)}/${encodeURIComponent(order.id)}/document`;
  const number = order.invoiceNumber ?? "";
  const frame = el("iframe", { class: "vframe podocframe", id: "net-document-frame", title: t("orderdoc.title").replace("{order}", number) });
  const status = el("div", { class: "muted sm", id: "net-document-status", text: t("orderdoc.loading") });
  const link = (format, label) =>
    el("a", { class: "actionlink compactlink", id: `net-document-${format}`, href: `${base}?format=${format}&download=1`, download: "" }, [icon("download"), el("span", { text: label })]);
  const content = el("div", { class: "podoc", id: "net-document" }, [
    el("div", { class: "podocbar" }, [link("pdf", t("orderdoc.pdf")), link("ubl", t("orderdoc.ubl")), link("csv", t("orderdoc.csv"))]),
    status,
    frame,
  ]);
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
