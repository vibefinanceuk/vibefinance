import { t } from "/strings.js";
import { el } from "/tasks.js";
import { currentOrgId } from "/orgs.js";
import { barList } from "/charts.js";

/**
 * Average cycle time by supplier — decision 0421, one of the six
 * remaining vertical slices of the Supplier Performance screen (the
 * design's own third bullet under "Key metrics": *"Average cycle time
 * by supplier (receipt → payment-eligible)"*).
 *
 * **`barList`, sized by days, slowest first** — the same component
 * `supplier-performance.js`'s own spend ranking already uses, reused
 * for a different unit. The route
 * (`workers/vf-app/src/supplier-cycle-time-route.ts`) already ranks
 * slowest first, so this card draws the rows in the order they arrive
 * rather than re-sorting them.
 */

let data = { suppliers: [] };

export async function load() {
  try {
    const org = currentOrgId();
    const query = org ? `?org=${encodeURIComponent(org)}` : "";
    const response = await fetch(`/api/suppliers/cycle-time${query}`);
    if (!response.ok) return false;
    data = await response.json();
  } catch {
    return false;
  }
  return true;
}

function days(n) {
  const rounded = Math.round(n * 10) / 10;
  return t("supplierperformance.dayscount").replace("{n}", String(rounded));
}

export function renderCard() {
  return data.suppliers.length === 0
    ? el("div", { class: "panel card-graphic" }, [
        el("div", { class: "cardhead" }, [el("h3", { text: t("supplierperformance.cycletime") })]),
        el("div", { class: "muted", text: t("supplierperformance.nocycletime") }),
      ])
    : el("div", { class: "panel card-graphic" }, [
        el("div", { class: "cardhead" }, [el("h3", { text: t("supplierperformance.cycletime") })]),
        el("div", { class: "sub", text: t("supplierperformance.cycletimesub") }),
        barList(
          data.suppliers.map((s) => ({
            label: s.supplierName,
            value: s.averageDays,
            display: days(s.averageDays),
            note: t("supplierperformance.invoicecount").replace("{n}", String(s.invoiceCount)),
          }))
        ),
      ]);
}
