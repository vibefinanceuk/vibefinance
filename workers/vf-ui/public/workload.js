import { t } from "/strings.js";
import { el, frame, topbar, setCurrentScreen } from "/tasks.js";
import { currentOrgId } from "/orgs.js";
import { stackedBarChart, chartLegend } from "/charts.js";

/**
 * Team throughput by stage — decision 0415, the first screen backed by
 * `AP.Analysis` (`workers/vf-app/src/workload-route.ts`), reserved
 * since before this bundle and never previously read by anything.
 *
 * **One chart, not a dashboard.** The Management Dashboard design
 * (decision 0414's own follow-up work) sketched five screens; this
 * ships the one chart the operator asked to stack first, built for
 * real, because it needed no new permission and no new scoping
 * concept — the vertical slice that proves the pattern before the
 * rest of that design gets its own real routes.
 */

let data = { users: [], legend: [] };

async function load() {
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
 * it** — `charts.js`'s own `stackedBarChart` doc comment explains
 * why: two users can hold different subsets of the same five stage
 * buckets, so `var(--chart-${bucket})` is computed from the real
 * bucket number the route already assigned, the same number used to
 * colour the legend below.
 */
function colourFor(bucket) {
  return `var(--chart-${bucket})`;
}

function render() {
  const shell = document.getElementById("shell");
  if (!shell) return;

  const body =
    data.users.length === 0
      ? el("div", { class: "panel card-graphic" }, [
          el("div", { class: "cardhead" }, [el("h3", { text: t("workload.throughput") })]),
          el("div", { class: "muted", text: t("workload.nothroughput") }),
        ])
      : el("div", { class: "panel card-graphic" }, [
          el("div", { class: "cardhead" }, [el("h3", { text: t("workload.throughput") })]),
          el("div", { class: "sub", text: t("workload.throughputsub") }),
          stackedBarChart(
            data.users.map((u) => ({
              label: u.userName,
              total: u.total,
              segments: u.buckets.map((b) => ({ value: b.n, colour: colourFor(b.bucket) })),
            }))
          ),
          chartLegend(
            data.legend.map((b) => ({
              label: b.label,
              value: b.n,
              colour: colourFor(b.bucket),
            }))
          ),
        ]);

  shell.replaceChildren(
    frame(
      el("div", { class: "dashboardpage" }, [
        topbar(t("workload.heading"), t("workload.sub")),
        el("div", { class: "dashflow" }, [body]),
      ])
    )
  );
}

export async function open() {
  setCurrentScreen("workload");
  if (!(await load())) return;
  render();
}
