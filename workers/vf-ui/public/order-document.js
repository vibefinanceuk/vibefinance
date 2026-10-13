import { t } from "/strings.js";
import { el } from "/tasks.js";

/**
 * **A purchase order's Document tab — decision 0760**: the order as the
 * supplier gets it, as a PDF (pdf-lib, in vf-app), shown as the invoice
 * viewer shows a document. Loaded when the tab is first opened. Its
 * downloads are on the Attachments tab (decision 0763, `orderFiles`).
 * The supplier network's own copy of this is vf-portal's
 * `order-document.js`.
 */
export function buildOrderDocumentTab(orderNumber, { base = `/api/purchase-orders/${encodeURIComponent(orderNumber)}/document`, id = "po-document" } = {}) {
  const frame = el("iframe", { class: "vframe podocframe", id: `${id}-frame`, title: t("orderdoc.title").replace("{order}", orderNumber) });
  const status = el("div", { class: "muted sm", id: `${id}-status`, text: t("orderdoc.loading") });
  const content = el("div", { class: "podoc", id }, [status, frame]);
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
 * **The order's own files, for its Attachments tab — decision 0763**: the
 * order as the supplier gets it, as PDF, UBL XML and CSV, listed and
 * downloaded as received files are. Dan: *"format as other locations with
 * an Attachments tab, providing available downloads."*
 */
export function orderFiles(orderNumber, base = `/api/purchase-orders/${encodeURIComponent(orderNumber)}/document`) {
  return {
    heading: t("orderdoc.attachhead"),
    files: [
      { key: "pdf", name: `${orderNumber}.pdf`, detail: t("orderdoc.pdf"), url: `${base}?format=pdf`, view: "inline" },
      { key: "ubl", name: `${orderNumber}.xml`, detail: t("orderdoc.ubl"), url: `${base}?format=ubl`, view: "download" },
      { key: "csv", name: `${orderNumber}.csv`, detail: t("orderdoc.csv"), url: `${base}?format=csv`, view: "download" },
    ],
  };
}
