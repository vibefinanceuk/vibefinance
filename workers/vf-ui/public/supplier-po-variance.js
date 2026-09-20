import { t } from "/strings.js";
import { el } from "/tasks.js";
import { currentOrgId } from "/orgs.js";
import { barList } from "/charts.js";

/**
 * Invoice variance to order value, ranked by supplier — decision
 * 0421, one of the six remaining vertical slices of the Supplier
 * Performance screen (the design's own fifth bullet under "Key
 * metrics").
 *
 * **`barList`, sized by percentage variance, highest first** — the
 * route (`workers/vf-app/src/supplier-po-variance-route.ts`) already
 * ranks highest-variance first, the same "problems surface first"
 * ordering this whole screen's own new reports share.
 */

let data = { suppliers: [] };

export async function load() {
  try {
    const org = currentOrgId();
    const query = org ? `?org=${encodeURIComponent(org)}` : "";
    const response = await fetch(`/api/suppliers/po-variance${query}`);
    if (!response.ok) return false;
    data = await response.json();
  } catch {
    return false;
  }
  return true;
}

function percent(n) {
  const rounded = Math.round(n * 10) / 10;
  return `${rounded}%`;
}

export function renderCard() {
  return data.suppliers.length === 0
    ? el("div", { class: "panel card-graphic" }, [
        el("div", { class: "cardhead" }, [el("h3", { text: t("supplierperformance.povariance") })]),
        el("div", { class: "muted", text: t("supplierperformance.nopovariance") }),
      ])
    : el("div", { class: "panel card-graphic" }, [
        el("div", { class: "cardhead" }, [el("h3", { text: t("supplierperformance.povariance") })]),
        el("div", { class: "sub", text: t("supplierperformance.povariancesub") }),
        barList(
          data.suppliers.map((s) => ({
            label: s.supplierName,
            value: s.averageVariancePct,
            display: percent(s.averageVariancePct),
            note: t("supplierperformance.invoicecount").replace("{n}", String(s.invoiceCount)),
          }))
        ),
      ]);
}
