import { t } from "/strings.js";
import { el, frame, topbar, setCurrentScreen, hasMyPermission, holdsEverywhere } from "/tasks.js";
import { load as loadOperational, renderCard as operationalCard } from "/workload.js";
import { load as loadOpenTasks, renderCard as openTasksCard } from "/workload-open-tasks.js";
import { load as loadHandlingTime, renderCard as handlingTimeCard } from "/workload-handling-time.js";
import { load as loadCycleTime, renderCard as cycleTimeCard } from "/workload-cycle-time.js";
import { load as loadPending, renderCard as pendingCard } from "/workload-pending.js";
import { load as loadQueueDepth, renderCard as queueDepthCard } from "/workload-queue-depth.js";
import { load as loadBalance, renderCard as balanceCard } from "/workload-balance.js";
// "Exceptions by user" pulled — decision 0428's own second addendum.
// Named-individual exception data behind a broad AP.Analysis gate, with
// a raw count that rewards volume over accuracy — see workers/vf-app/
// src/index.ts's own doc comment where the route used to be wired, and
// decision 0428's own second addendum, for the full reasoning. The
// working module is recoverable in full from commit 7fd97e0.
import { load as loadSupplierSpend, renderCard as supplierSpendCard } from "/supplier-performance.js";
import { load as loadAccruals, renderCard as accrualsCard } from "/accruals.js";
import { load as loadSpendUnderManagement, renderCard as spendUnderManagementCard } from "/spend-under-management.js";
import { load as loadDuplicates, renderCard as duplicatesCard } from "/fraud-duplicates.js";
import { load as loadUnapprovedSuppliers, renderCard as unapprovedSuppliersCard } from "/fraud-unapproved-suppliers.js";
import { load as loadExceptionTrends, renderCard as exceptionTrendsCard } from "/fraud-exception-trends.js";
import { load as loadStatisticalOutliers, renderCard as statisticalOutliersCard } from "/fraud-statistical-outliers.js";
import { load as loadSegregationOfDuties, renderCard as segregationOfDutiesCard } from "/fraud-segregation-of-duties.js";
import { load as loadConsolidatedSpend, renderCard as consolidatedSpendCard } from "/executive-consolidated-spend.js";
import { load as loadSupplierStatus, renderCard as supplierStatusCard } from "/supplier-status.js";
import { load as loadSupplierCycleTime, renderCard as supplierCycleTimeCard } from "/supplier-cycle-time.js";
import { load as loadSupplierExceptions, renderCard as supplierExceptionsCard } from "/supplier-exceptions.js";
import { load as loadSupplierPoVariance, renderCard as supplierPoVarianceCard } from "/supplier-po-variance.js";
import { load as loadSupplierPaymentTerms, renderCard as supplierPaymentTermsCard } from "/supplier-payment-terms.js";
import { load as loadDiscountEligibility, renderCard as discountEligibilityCard } from "/supplier-discount-eligibility.js";
import { load as loadHoldHistory, renderCard as holdHistoryCard } from "/supplier-hold-history.js";

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
 * **Five tabs, all five real now.** The operator's own names, mapped
 * onto the design's five original screens:
 *
 * | Tab | Design's own screen | Permission |
 * |---|---|---|
 * | Operational Performance | User & Team Workload | `AP.Analysis` |
 * | Financial Performance | Liabilities & Accruals | `AP.Analysis` |
 * | Supplier Performance | Supplier Performance | `AP.Supplier` |
 * | Executive IQ | Multi-Enterprise CFO View | `AP.Analysis` + `holdsEverywhere` |
 * | Fraud Prevention | Fraud & Risk Detection | `AP.FraudReview` |
 *
 * Every tab reuses the routes and screens decisions 0415–0425 already
 * built and tested. Executive IQ (decision 0425) was the last to gain
 * real content — until now it rendered a plain "not built yet"
 * placeholder, still gated on its own real permission, so who could
 * even see the tab exists was correct ahead of what was behind it.
 *
 * **Financial Performance shows two real cards, not one** — decision
 * 0419's own follow-on to 0417's accruals report: spend under
 * management (with PO) vs. total spend, the design's own fifth
 * Liabilities & Accruals bullet. `tabContent()`'s own `financial`
 * branch loads both and returns an array of cards rather than a
 * single element; `renderActive()` spreads whichever shape it gets,
 * so every other single-card tab is unaffected.
 *
 * **Supplier Performance shows all eight of its own key metrics now** —
 * decisions 0421 and 0427, the same "an array of cards, each failing
 * independently" shape `financial` already established, extended from
 * two to six and now to eight: active supplier count by status
 * (decision 0378's own route, reused), spend by supplier (0416),
 * average cycle time, exception rate and type mix, PO variance,
 * payment terms held vs. negotiated with on-time rate, early-payment
 * discount eligibility (0427 — reported as eligibility, not the
 * design's own literal "capture rate," since this system still has no
 * payment-execution data to know whether a discount was actually
 * taken), and hold history (0427 — built on a new general field-change
 * history, `supplier_field_changes`, rather than a hold-specific
 * table). The last of the five design screens to show every one of its
 * own key metrics.
 *
 * **Fraud Prevention shows five real cards, not one** — decisions
 * 0422, 0423 and 0424, the same "an array of cards, each failing
 * independently" shape `financial` and `supplier` already established:
 * potential duplicate invoices (0420), unapproved-supplier invoices —
 * an invoice with no matched supplier, or one whose matched supplier
 * is on hold today (0422) — exceptions by type, by user, by supplier,
 * trended over eight weeks (0423, `charts.js`'s own `sparkline()`
 * first real caller), statistical outliers — an invoice amount well
 * outside a supplier's own historical range (0424) — and
 * segregation-of-duties flags — the same person claiming and
 * approving where the process should prevent it (0424). Only vendor
 * banking-detail-change alerts, the design's own remaining Fraud & Risk
 * Detection metric, stays unbuilt — a real gap, not assumed solvable.
 *
 * **Executive IQ shows one real card, not the whole six-metric
 * screen** — decision 0425, "Consolidated spend across org units /
 * legal entities," the design's own first Multi-Enterprise CFO View
 * bullet, reusing the same `holdsEverywhere` gate the tab itself
 * already checks (see the route's own doc comment for the scoping
 * decision the design flagged and how it was resolved). Unlike every
 * other card on this screen, its own `load()` passes no `?org=` at
 * all — the whole point of this card is every entity at once, not
 * whichever one the switcher happens to be set to. The design's other
 * five Multi-Enterprise CFO View metrics stay unbuilt.
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
  if (key === "operational") {
    // Seven independent cards, decision 0428 — throughput (0415) plus
    // six of Workload's own remaining seven, all built together at the
    // operator's own choice, the same "one screen's own fetch failing
    // never hides another's real data" discipline every other tab on
    // this screen already follows. "Exceptions by user," the eighth
    // and last, was pulled live — decision 0428's own second addendum
    // — over a governance concern (naming individuals under a broad
    // gate) and a broken raw-count calculation found once the first
    // concern was investigated. Not rebuilt here; see that addendum.
    const [throughputOk, openTasksOk, handlingTimeOk, cycleTimeOk, pendingOk, queueDepthOk, balanceOk] =
      await Promise.all([
        loadOperational(),
        loadOpenTasks(),
        loadHandlingTime(),
        loadCycleTime(),
        loadPending(),
        loadQueueDepth(),
        loadBalance(),
      ]);
    return [
      throughputOk ? operationalCard() : loadErrorCard(),
      openTasksOk ? openTasksCard() : loadErrorCard(),
      handlingTimeOk ? handlingTimeCard() : loadErrorCard(),
      cycleTimeOk ? cycleTimeCard() : loadErrorCard(),
      pendingOk ? pendingCard() : loadErrorCard(),
      queueDepthOk ? queueDepthCard() : loadErrorCard(),
      balanceOk ? balanceCard() : loadErrorCard(),
    ];
  }
  if (key === "financial") {
    // Two independent cards, two independent failures — one screen's
    // own fetch failing never hides the other's real data.
    const [accrualsOk, spendOk] = await Promise.all([loadAccruals(), loadSpendUnderManagement()]);
    return [accrualsOk ? accrualsCard() : loadErrorCard(), spendOk ? spendUnderManagementCard() : loadErrorCard()];
  }
  if (key === "supplier") {
    // Eight independent cards, decision 0427's own follow-on to 0416
    // and 0421 — the same "one screen's own fetch failing never hides
    // another's real data" discipline "financial" already established,
    // extended from six cards to eight, all eight of the design's own
    // key metrics for this screen now real.
    const [statusOk, spendOk, cycleOk, exceptionsOk, varianceOk, termsOk, discountOk, holdOk] = await Promise.all([
      loadSupplierStatus(),
      loadSupplierSpend(),
      loadSupplierCycleTime(),
      loadSupplierExceptions(),
      loadSupplierPoVariance(),
      loadSupplierPaymentTerms(),
      loadDiscountEligibility(),
      loadHoldHistory(),
    ]);
    return [
      statusOk ? supplierStatusCard() : loadErrorCard(),
      spendOk ? supplierSpendCard() : loadErrorCard(),
      cycleOk ? supplierCycleTimeCard() : loadErrorCard(),
      exceptionsOk ? supplierExceptionsCard() : loadErrorCard(),
      varianceOk ? supplierPoVarianceCard() : loadErrorCard(),
      termsOk ? supplierPaymentTermsCard() : loadErrorCard(),
      discountOk ? discountEligibilityCard() : loadErrorCard(),
      holdOk ? holdHistoryCard() : loadErrorCard(),
    ];
  }
  if (key === "fraud") {
    // Five independent cards, decision 0424's own follow-on to 0420,
    // 0422 and 0423 — the same "one screen's own fetch failing never
    // hides another's real data" discipline `financial` and `supplier`
    // already established.
    const [duplicatesOk, unapprovedOk, trendsOk, outliersOk, segregationOk] = await Promise.all([
      loadDuplicates(),
      loadUnapprovedSuppliers(),
      loadExceptionTrends(),
      loadStatisticalOutliers(),
      loadSegregationOfDuties(),
    ]);
    return [
      duplicatesOk ? duplicatesCard() : loadErrorCard(),
      unapprovedOk ? unapprovedSuppliersCard() : loadErrorCard(),
      trendsOk ? exceptionTrendsCard() : loadErrorCard(),
      outliersOk ? statisticalOutliersCard() : loadErrorCard(),
      segregationOk ? segregationOfDutiesCard() : loadErrorCard(),
    ];
  }
  if (key === "executiveiq") {
    // The Multi-Enterprise CFO View's own first real card — decision
    // 0425. One card today, not the whole six-metric screen, the same
    // "one real vertical slice first" discipline every other tab on
    // this screen started with.
    return (await loadConsolidatedSpend()) ? consolidatedSpendCard() : loadErrorCard();
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
