import { t } from "/strings.js";
import { el, frame, topbar, setCurrentScreen } from "/tasks.js";
import { currentOrgId } from "/orgs.js";
import { barList } from "/charts.js";

/**
 * Supplier Performance — decision 0416, the second real screen drawn
 * from the Management Dashboard design (decision 0415 built the
 * first, Workload).
 *
 * **One metric, not the whole scorecard.** The design lists seven key
 * metrics for this screen; this ships the second — "Spend by
 * supplier, with a top-N ranking" — because it needed no new
 * permission (`AP.Supplier`, already gating the Suppliers screen) and
 * no new scoping concept (the same `unitsWherePermitted` intersection
 * that screen already uses). The other six stay unbuilt, the same way
 * Workload left the other four Management Dashboard screens unbuilt —
 * see decision 0416's own "What is not built."
 *
 * **Never one summed figure.** Real invoices here are genuinely
 * multi-currency and this system has no FX conversion, so the route
 * (`workers/vf-app/src/supplier-performance-route.ts`) groups by
 * `(supplier, currency)` and hands back one ranked list per currency
 * rather than one blended total nobody could trust. For the common
 * case — a customer whose suppliers all invoice in one currency —
 * that reads as exactly the single simple list the design asked for.
 */

let data = { currencies: [] };

async function load() {
  try {
    const org = currentOrgId();
    const query = org ? `?org=${encodeURIComponent(org)}` : "";
    const response = await fetch(`/api/suppliers/spend${query}`);
    if (!response.ok) return false;
    data = await response.json();
  } catch {
    return false;
  }
  return true;
}

/** The same shape `dashboard.js`'s own `money()` already renders — one currency, two decimal places, never blended with another. */
function money(amount, currency) {
  if (amount === null || amount === undefined) return "—";
  return `${currency ?? ""} ${Number(amount).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`.trim();
}

function currencySection(group) {
  const rows = barList(
    group.suppliers.map((s) => ({
      label: s.supplierName,
      value: s.spend,
      display: money(s.spend, group.currency),
      note: t("supplierperformance.invoicecount").replace("{n}", String(s.invoiceCount)),
    }))
  );

  // A label above each currency's own list only when there is more
  // than one — the common single-currency case stays exactly the
  // plain single list the design asked for, nothing else added.
  return data.currencies.length > 1
    ? el("div", { class: "spendcurrency" }, [el("div", { class: "muted", text: group.currency }), rows])
    : rows;
}

function render() {
  const shell = document.getElementById("shell");
  if (!shell) return;

  const body =
    data.currencies.length === 0
      ? el("div", { class: "panel card-graphic" }, [
          el("div", { class: "cardhead" }, [el("h3", { text: t("supplierperformance.spend") })]),
          el("div", { class: "muted", text: t("supplierperformance.nospend") }),
        ])
      : el("div", { class: "panel card-graphic" }, [
          el("div", { class: "cardhead" }, [el("h3", { text: t("supplierperformance.spend") })]),
          el("div", { class: "sub", text: t("supplierperformance.spendsub") }),
          ...data.currencies.map((group) => currencySection(group)),
        ]);

  shell.replaceChildren(
    frame(
      el("div", { class: "dashboardpage" }, [
        topbar(t("supplierperformance.heading"), t("supplierperformance.sub")),
        el("div", { class: "dashflow" }, [body]),
      ])
    )
  );
}

export async function open() {
  setCurrentScreen("supplierperformance");
  if (!(await load())) return;
  render();
}
