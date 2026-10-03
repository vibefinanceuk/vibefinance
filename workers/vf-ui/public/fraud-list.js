import { t } from "/strings.js";
import { el } from "/tasks.js";
import { sparkline } from "/charts.js";

/**
 * **Fraud Prevention, a summary on top and a short list per check** —
 * decision 0618.
 *
 * Dan: *"The report cards are narrow and grow very long down the page.
 * Is there a way to improve the visuals and also allow drill-down in
 * these cards?"* Each of the five checks was a table squeezed into a
 * tile about 290px wide, four of them listing every invoice flagged,
 * with no limit and nothing to click. Now:
 *
 * - **a row of tiles**, one per check, each with its count, so the whole
 *   picture is on one line; a tile takes you to its list;
 * - **each check a full-width list of its first five**, the most urgent
 *   first as each route already orders them, with *Show all N* where
 *   there are more, opening Documents at exactly those;
 * - **a row opens its invoice**, read-only, and closing it comes back
 *   here.
 */
export const TOP = 5;

/**
 * Open one invoice in the viewer, read-only: no task, so no actions,
 * as Documents opens one (decision 0164). Closing it brings this screen
 * back as it was, without fetching again.
 */
export async function openInvoice(invoiceId) {
  const { openViewer } = await import("/viewer.js");
  const shell = document.getElementById("shell");
  const viewer = document.getElementById("viewer");
  if (shell) shell.hidden = true;
  if (viewer) viewer.hidden = false;
  await openViewer({ subject: { type: "invoice", id: invoiceId }, stageId: null, stageName: null, actions: [] }, async () => {
    if (viewer) viewer.hidden = true;
    if (shell) shell.hidden = false;
  });
}

/** By mouse, or Enter or Space from the keyboard. */
export function makeClickable(node, action) {
  node.classList.add("clickable");
  node.tabIndex = 0;
  node.setAttribute("role", "button");
  node.addEventListener("click", action);
  node.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      action();
    }
  });
  return node;
}

/** A table row that opens its invoice. */
export function invoiceRow(invoiceId, cells) {
  const row = el("tr", {}, cells);
  return invoiceId ? makeClickable(row, () => openInvoice(invoiceId)) : row;
}

/**
 * Documents at exactly these invoices, with the check's own banner —
 * for a check worked out here and not a filter Documents has (outliers,
 * say).
 */
export async function openTheseInvoices(ids, banner) {
  const { openDocumentsWithIds } = await import("/documents.js");
  openDocumentsWithIds(ids, banner);
}

/**
 * A check's heading: its title and count, and *Show all N* where the
 * list below is cut to the first five.
 */
export function listHead(title, total, onShowAll) {
  return el("div", { class: "cardhead fraudhead" }, [
    el("h3", { text: title }),
    el("span", { class: "fraudcount", text: String(total) }),
    total > TOP && onShowAll
      ? el("button", { class: "chip fraudshowall", text: t("fraudprevention.showall").replace("{n}", String(total)), onclick: onShowAll })
      : null,
  ].filter(Boolean));
}

/** A check's full-width card, with the id its tile scrolls to. */
export function listCard(key, children) {
  return el("div", { class: "panel card-list fraudlist", id: `fraud-${key}` }, children.filter(Boolean));
}

/**
 * The row of tiles: each check's count, and for exception trends its
 * eight weeks as a line. A tile takes you down to its list.
 *
 * @param summaries `[{ key, label, count, weekly? }]`, one per check that loaded
 */
export function fraudTiles(summaries) {
  return el(
    "div",
    { class: "panel card-list fraudtiles" },
    summaries.map((s) =>
      makeClickable(
        el("div", { class: `fraudtile${s.count > 0 ? " flagged" : ""}` }, [
          el("div", { class: "fraudtilecount", text: String(s.count) }),
          el("div", { class: "fraudtilelabel", text: s.label }),
          s.weekly && s.weekly.some((n) => n > 0) ? sparkline(s.weekly, { height: 22 }) : null,
        ].filter(Boolean)),
        () => document.getElementById(`fraud-${s.key}`)?.scrollIntoView({ behavior: "smooth", block: "start" })
      )
    )
  );
}
