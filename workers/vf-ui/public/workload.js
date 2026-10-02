import { t } from "/strings.js";
import { el } from "/tasks.js";
import { currentOrgId } from "/orgs.js";
import { stackedBarRows, chartLegend } from "/charts.js";

/**
 * Team throughput by stage — decision 0415, the first screen backed by
 * `AP.Analysis` (`workers/vf-app/src/workload-route.ts`), reserved
 * since before this bundle and never previously read by anything.
 *
 * **One card, not a standalone screen — decision 0417.** Shipped as
 * its own top-level nav item first; moved into the Operational
 * Performance tab of the new AP Analytics screen
 * (`ap-analytics.js`) once that existed, at the operator's own
 * request to consolidate every analytics screen under one tabbed
 * link. `load()` and `renderCard()` are exported for that screen to
 * call; there is no `open()` here any more, and no topbar or frame of
 * this module's own — the tab shell owns both.
 */

let data = { users: [], legend: [] };

export async function load() {
  try {
    /**
     * **The chosen org**, the same treatment `dashboard.js`'s own
     * `load()` already gives its cards (decision 0316/0317) —
     * `AP.Analysis` is scoped by org unit exactly like every other
     * analysis permission.
     */
    const org = currentOrgId();
    const query = org ? `?org=${encodeURIComponent(org)}` : "";
    const response = await fetch(`/api/workload/throughput${query}`);
    if (!response.ok) return false;
    data = await response.json();
  } catch {
    return false;
  }
  return true;
}

/**
 * **Colour travels with the bucket, not with a row's position in
 * it** — `charts.js`'s own `stackedBarRows` doc comment explains
 * why: two users can hold different subsets of the same five stage
 * buckets, so `var(--chart-${bucket})` is computed from the real
 * bucket number the route already assigned, the same number used to
 * colour the legend below.
 */
function colourFor(bucket) {
  return `var(--chart-${bucket})`;
}

function labelFor(bucket) {
  return data.legend.find((b) => b.bucket === bucket)?.label ?? "";
}

/**
 * **A person's bar opens their week in Documents** — decision 0611:
 * the invoices they completed a task on in the last seven days, the
 * same window this card counts.
 */
async function openPerson(row) {
  const { openDocumentsDoneBy } = await import("/documents.js");
  openDocumentsDoneBy(row.userId, row.label);
}

/** The card itself, built from whatever `load()` last fetched. Callers own the topbar, frame and tab shell around it. */
export function renderCard() {
  return data.users.length === 0
    ? el("div", { class: "panel card-graphic" }, [
        el("div", { class: "cardhead" }, [el("h3", { text: t("workload.throughput") })]),
        el("div", { class: "muted", text: t("workload.nothroughput") }),
      ])
    : el("div", { class: "panel card-graphic" }, [
        el("div", { class: "cardhead" }, [el("h3", { text: t("workload.throughput") })]),
        el("div", { class: "sub", text: t("workload.throughputsub") }),
        stackedBarRows(
          data.users.map((u) => ({
            label: u.userName,
            total: u.total,
            userId: u.userId,
            segments: u.buckets.map((b) => ({ value: b.n, colour: colourFor(b.bucket), label: labelFor(b.bucket) })),
          })),
          { onSelect: openPerson }
        ),
        chartLegend(
          data.legend.map((b) => ({
            label: b.label,
            value: b.n,
            colour: colourFor(b.bucket),
          }))
        ),
      ]);
}
