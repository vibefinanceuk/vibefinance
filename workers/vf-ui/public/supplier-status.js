import { t } from "/strings.js";
import { el } from "/tasks.js";
import { currentOrgId } from "/orgs.js";
import { donutChart } from "/charts.js";

/**
 * Active supplier count, by status — decision 0421, one of the six
 * remaining vertical slices of the Supplier Performance screen (the
 * design's own first bullet under "Key metrics": *"Active supplier
 * count, by status (active / inactive / on-hold / awaiting-ERP — the
 * same status set `suppliers.js` already tracks)"*).
 *
 * **Not a new metric — a reused one.** `/api/suppliers/status-counts`
 * (decision 0378) already computes exactly this, gated on
 * `AP.Supplier` — the same permission the rest of this screen already
 * checks — and already renders as a ring on the standalone Suppliers
 * screen. This module fetches the same endpoint and draws the same
 * `donutChart()` component for the AP Analytics tab, rather than
 * building a second backend route for a count this system already
 * answers.
 *
 * **Read-only here, deliberately.** The Suppliers screen's own ring
 * lets a click filter its own list (`onSelect`); this tab has no list
 * to filter, and decision 0420 already noted "no drill-through" as a
 * gap left open across the whole AP Analytics arc. No `onSelect` is
 * wired here either, rather than half-building a jump to a different
 * screen.
 *
 * **Nested inside its own wrapper, not a bare `.panel` child** — the
 * same reason `spend-under-management.js`'s own `.spendundermanagementtile`
 * exists (decision 0419): `.dashflow > .panel > .donutwrap` is a
 * pin-to-bottom rule written for `donutChart()`'s single-ring-per-card
 * shape (decision 0261); this card's ring opts out the same way.
 */

let counts = null;

export async function load() {
  try {
    const org = currentOrgId();
    const query = org ? `?org=${encodeURIComponent(org)}` : "";
    const response = await fetch(`/api/suppliers/status-counts${query}`);
    if (!response.ok) {
      counts = null;
      return false;
    }
    const body = await response.json();
    counts = body.counts ?? null;
  } catch {
    counts = null;
    return false;
  }
  return true;
}

/** The card itself, built from whatever `load()` last fetched. */
export function renderCard() {
  const segments = counts
    ? [
        { key: "active", label: t("suppliers.status.active"), value: counts.active ?? 0 },
        { key: "onhold", label: t("suppliers.status.onhold"), value: counts.onhold ?? 0 },
        { key: "inactive", label: t("suppliers.status.inactive"), value: counts.inactive ?? 0 },
        { key: "awaitingerp", label: t("suppliers.status.awaitingerp"), value: counts.awaitingerp ?? 0 },
      ].filter((seg) => seg.value > 0)
    : [];

  return el("div", { class: "panel card-graphic" }, [
    el("div", { class: "cardhead" }, [el("h3", { text: t("suppliers.statusheading") })]),
    segments.length > 0
      ? el("div", { class: "supplierstatustile" }, [donutChart(segments)])
      : el("div", { class: "muted", text: t("suppliers.nostatusdata") }),
  ]);
}
