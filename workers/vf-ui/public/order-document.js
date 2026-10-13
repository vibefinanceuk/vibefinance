import { t } from "/strings.js";
import { el } from "/tasks.js";
import { icon } from "/icons.js";

/**
 * **A purchase order's Document tab — decision 0760**: the order as the
 * supplier gets it, as a PDF (pdf-lib, in vf-app), shown as the invoice
 * viewer shows a document, with downloads as PDF, UBL XML and CSV. Loaded
 * when the tab is first opened. The supplier network's own copy of this is
 * vf-portal's `order-document.js`.
 */
export function buildOrderDocumentTab(orderNumber, { base = `/api/purchase-orders/${encodeURIComponent(orderNumber)}/document`, id = "po-document" } = {}) {
  const frame = el("iframe", { class: "vframe podocframe", id: `${id}-frame`, title: t("orderdoc.title").replace("{order}", orderNumber) });
  const status = el("div", { class: "muted sm", id: `${id}-status`, text: t("orderdoc.loading") });
  const link = (format, label) =>
    el("a", { class: "actionlink compactlink", id: `${id}-${format}`, href: `${base}?format=${format}&download=1`, download: "" }, [icon("download"), el("span", { text: label })]);
  const content = el("div", { class: "podoc", id }, [
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
