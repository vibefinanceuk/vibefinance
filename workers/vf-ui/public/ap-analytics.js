import { t } from "/strings.js";
import { el, frame, topbar, setCurrentScreen, hasMyPermission, holdsEverywhere } from "/tasks.js";
import { load as loadOperational, renderCard as operationalCard } from "/workload.js";
import { load as loadSupplierSpend, renderCard as supplierSpendCard } from "/supplier-performance.js";
import { load as loadAccruals, renderCard as accrualsCard } from "/accruals.js";
import { load as loadSpendUnderManagement, renderCard as spendUnderManagementCard } from "/spend-under-management.js";
import { load as loadDuplicates, renderCard as duplicatesCard } from "/fraud-duplicates.js";
import { load as loadUnapprovedSuppliers, renderCard as unapprovedSuppliersCard } from "/fraud-unapproved-suppliers.js";
import { load as loadExceptionTrends, renderCard as exceptionTrendsCard } from "/fraud-exception-trends.js";
import { load as loadSupplierStatus, renderCard as supplierStatusCard } from "/supplier-status.js";
import { load as loadSupplierCycleTime, renderCard as supplierCycleTimeCard } from "/supplier-cycle-time.js";
import { load as loadSupplierExceptions, renderCard as supplierExceptionsCard } from "/supplier-exceptions.js";
import { load as loadSupplierPoVariance, renderCard as supplierPoVarianceCard } from "/supplier-po-variance.js";
import { load as loadSupplierPaymentTerms, renderCard as supplierPaymentTermsCard } from "/supplier-payment-terms.js";

/**
 * AP Analytics — decision 0417, the single tabbed home for every
 * screen the Management Dashboard design sketched.
 *
 * **Consolidates standalone screens, at the operator's own request.**
 * Workload (decision 0415), Supplier Performance (decision 0416), and
 * now Accruals (decision 0417's own follow-on) each shipped as, or
 * would otherwise have shipped as, their own top-level nav item;
 * asked directly whether Workload and Supplier Performance should
 * stay there or fold into one tabbed screen, the operator chose to
 * fold them in — their own `open()` entry points are gone, replaced
 * by an exported `load()` + `renderCard()` pair each this screen
 * calls directly, the same shape Accruals was built with from the
 * start rather than ever having a standalone screen of its own. The
 * pill tabs are `access.js`'s own `.tabbar`/`.tab` component, reused
 * rather than rebuilt — the same shape the operator pointed at by
 * name.
 *
 * **Five tabs, four real.** The operator's own names, mapped onto the
 * design's five original screens:
 *
 * | Tab | Design's own screen | Permission |
 * |---|---|---|
 * | Operational Performance | User & Team Workload | `AP.Analysis` |
 * | Financial Performance | Liabilities & Accruals | `AP.Analysis` |
 * | Supplier Performance | Supplier Performance | `AP.Supplier` |
 * | Executive IQ | Multi-Enterprise CFO View | `AP.Analysis` + `holdsEverywhere` |
 * | Fraud Prevention | Fraud & Risk Detection | `AP.FraudReview` |
 *
 * Operational, Financial, Supplier Performance, and now Fraud
 * Prevention (decision 0420's own potential-duplicate-invoices table,
 * joined by decision 0422's own unapproved-supplier-invoices table and
 * decision 0423's own exceptions-by-type/user/supplier trend) are
 * real, reusing the routes and screens decisions 0415–0423 already
 * built and tested. Only Executive IQ still renders a plain "not built
 * yet" placeholder — still gated on its own real permission, so who
 * can even see the tab exists is correct today, ahead of what is
 * behind it.
 *
 * **Financial Performance shows two real cards, not one** — decision
 * 0419's own follow-on to 0417's accruals report: spend under
 * management (with PO) vs. total spend, the design's own fifth
 * Liabilities & Accruals bullet. `tabContent()`'s own `financial`
 * branch loads both and returns an array of cards rather than a
 * single element; `renderActive()` spreads whichever shape it gets,
 * so every other single-card tab is unaffected.
 *
 * **Supplier Performance shows six real cards, not one** — decision
 * 0421, the same "an array of cards, each failing independently"
 * shape `financial` already established, extended from two to six:
 * active supplier count by status (decision 0378's own route,
 * reused), spend by supplier (0416), average cycle time, exception
 * rate and type mix, PO variance, and payment terms held vs.
 * negotiated with on-time rate. Of the design's own eight key metrics
 * for this screen, only early-payment/discount capture (parked,
 * decision 0420 — no structured discount data exists anywhere) and
 * hold history (parked, decision 0421 — no history table exists,
 * only current `on_hold` state) stay unbuilt.
 *
 * **Fraud Prevention shows three real cards, not one** — decisions
 * 0422 and 0423, the same "an array of cards, each failing
 * independently" shape `financial` and `supplier` already established:
 * potential duplicate invoices (0420), unapproved-supplier invoices —
 * an invoice with no matched supplier, or one whose matched supplier
 * is on hold today (0422) — and exceptions by type, by user, by
 * supplier, trended over eight weeks (0423), `charts.js`'s own
 * `sparkline()` first real caller.
 *
 * **The permission each tab actually checks matches its own route's
 * own gate, not the design document's own original proposal.**
 * The design's Role-Based Access Model table lists two permissions
 * for Workload (`AP.TaskManage` + `AP.Analysis`) and two for Supplier
 * Performance (`AP.Supplier` + `AP.Analysis`) — but decisions 0415 and
 * 0416 each deliberately shipped with a single permission instead,
 * and gating a tab more strictly than the data behind it would mean
 * a person could reach data through the API that the tab itself hid
 * from them, or the reverse. A tab's own gate is always exactly what
 * `hasPermission` already checks server-side for that tab's data —
 * never a second, independent guess at it.
 */

const TABS = [
  { key: "operational", labelKey: "apanalytics.operational", permission: "AP.Analysis" },
  { key: "financial", labelKey: "apanalytics.financial", permission: "AP.Analysis" },
  { key: "supplier", labelKey: "apanalytics.supplier", permission: "AP.Supplier" },
  { key: "executiveiq", labelKey: "apanalytics.executiveiq", permission: "AP.Analysis", global: true },
  { key: "fraud", labelKey: "apanalytics.fraud", permission: "AP.FraudReview" },
];

function availableTabs() {
  return TABS.filter((tab) => hasMyPermission(tab.permission) && (!tab.global || holdsEverywhere()));
}

let activeTab = null;

function tabBar(available) {
  return el(
    "div",
    { class: "tabbar" },
    available.map((tab) =>
      el("button", {
        class: `tab${activeTab === tab.key ? " active" : ""}`,
        text: t(tab.labelKey),
        onclick: async () => {
          activeTab = tab.key;
          await renderActive();
        },
      })
    )
  );
}

/** A placeholder card for a tab whose own screen does not exist yet — still real content, never a blank pane. */
function placeholderCard(tab) {
  return el("div", { class: "panel card-graphic" }, [
    el("div", { class: "cardhead" }, [el("h3", { text: t(tab.labelKey) })]),
    el("div", { class: "muted", text: t("apanalytics.notbuilt") }),
  ]);
}

function loadErrorCard() {
  return el("div", { class: "panel card-graphic" }, [el("div", { class: "muted", text: t("apanalytics.loaderror") })]);
}

async function tabContent(key) {
  const tab = TABS.find((candidate) => candidate.key === key);
  if (key === "operational") return (await loadOperational()) ? operationalCard() : loadErrorCard();
  if (key === "financial") {
    // Two independent cards, two independent failures — one screen's
    // own fetch failing never hides the other's real data.
    const [accrualsOk, spendOk] = await Promise.all([loadAccruals(), loadSpendUnderManagement()]);
    return [accrualsOk ? accrualsCard() : loadErrorCard(), spendOk ? spendUnderManagementCard() : loadErrorCard()];
  }
  if (key === "supplier") {
    // Six independent cards, decision 0421's own follow-on to 0416 —
    // the same "one screen's own fetch failing never hides another's
    // real data" discipline "financial" already established, extended
    // from two cards to six.
    const [statusOk, spendOk, cycleOk, exceptionsOk, varianceOk, termsOk] = await Promise.all([
      loadSupplierStatus(),
      loadSupplierSpend(),
      loadSupplierCycleTime(),
      loadSupplierExceptions(),
      loadSupplierPoVariance(),
      loadSupplierPaymentTerms(),
    ]);
    return [
      statusOk ? supplierStatusCard() : loadErrorCard(),
      spendOk ? supplierSpendCard() : loadErrorCard(),
      cycleOk ? supplierCycleTimeCard() : loadErrorCard(),
      exceptionsOk ? supplierExceptionsCard() : loadErrorCard(),
      varianceOk ? supplierPoVarianceCard() : loadErrorCard(),
      termsOk ? supplierPaymentTermsCard() : loadErrorCard(),
    ];
  }
  if (key === "fraud") {
    // Three independent cards, decision 0423's own follow-on to 0420
    // and 0422 — the same "one screen's own fetch failing never hides
    // another's real data" discipline `financial` and `supplier`
    // already established.
    const [duplicatesOk, unapprovedOk, trendsOk] = await Promise.all([
      loadDuplicates(),
      loadUnapprovedSuppliers(),
      loadExceptionTrends(),
    ]);
    return [
      duplicatesOk ? duplicatesCard() : loadErrorCard(),
      unapprovedOk ? unapprovedSuppliersCard() : loadErrorCard(),
      trendsOk ? exceptionTrendsCard() : loadErrorCard(),
    ];
  }
  return placeholderCard(tab);
}

async function renderActive() {
  const shell = document.getElementById("shell");
  if (!shell) return;

  const available = availableTabs();
  if (!activeTab || !available.some((tab) => tab.key === activeTab)) {
    activeTab = available[0]?.key ?? null;
  }

  const body = activeTab
    ? await tabContent(activeTab)
    : el("div", { class: "panel card-graphic" }, [el("div", { class: "muted", text: t("apanalytics.none") })]);
  const bodyCards = Array.isArray(body) ? body : [body];

  shell.replaceChildren(
    frame(
      el("div", { class: "dashboardpage" }, [
        topbar(t("apanalytics.heading"), t("apanalytics.sub")),
        tabBar(available),
        el("div", { class: "dashflow" }, bodyCards),
      ])
    )
  );
}

export async function open() {
  setCurrentScreen("apanalytics");
  await renderActive();
}
