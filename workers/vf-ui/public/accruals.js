import { t } from "/strings.js";
import { el } from "/tasks.js";
import { currentOrgId } from "/orgs.js";
import { barList } from "/charts.js";

/**
 * The accruals report — decision 0417's own follow-on, the first real
 * card in the Financial Performance tab (`ap-analytics.js`), built the
 * same way Workload and Supplier Performance each were: `load()` and
 * `renderCard()`, no `open()` of its own — this screen has never had a
 * standalone nav item, unlike its two predecessors before decision
 * 0417 folded them in.
 *
 * **One metric of six.** The design's own first bullet under
 * Liabilities & Accruals' key metrics — "Accruals report — invoices
 * received but not yet at the payment-eligible stage... the natural
 * definition of a liability not yet settled" — because it needed no
 * new permission (`AP.Analysis`, already gating this whole tab) and no
 * new scoping concept, the same discipline 0415 and 0416 each already
 * followed. The other five — early-payment/discount eligibility, cash
 * flow forecasting, spend under management vs. total, payment terms
 * held vs. actual, and DPO — stay unbuilt.
 *
 * **Never one blended figure.** Real invoices here are genuinely
 * multi-currency and this system has no FX conversion, so the route
 * (`workers/vf-app/src/accruals-route.ts`) groups by `(currency,
 * stage)` and hands back one total and one stage breakdown per
 * currency, rather than one number nobody could trust. **Always shown
 * with its own total, even for the ordinary single-currency case** —
 * unlike Supplier Performance's own currency label, which the common
 * case hides entirely, the accrued total here is the report's own
 * headline figure (the design's own "stat tile"), not merely a
 * currency disambiguation.
 *
 * **Ordered by stage, not by size.** The design's own suggested
 * visualization is "Stat tile + table broken out by stage" — a
 * liability reads naturally in the order the money moves through the
 * process, earliest stage first, not ranked biggest-first the way
 * Supplier Performance's own ranking is.
 */

let data = { currencies: [] };

export async function load() {
  try {
    const org = currentOrgId();
    const query = org ? `?org=${encodeURIComponent(org)}` : "";
    const response = await fetch(`/api/accruals${query}`);
    if (!response.ok) return false;
    data = await response.json();
  } catch {
    return false;
  }
  return true;
}

/** The same shape every other screen's own `money()` already renders — one currency, two decimal places, never blended with another. */
function money(amount, currency) {
  if (amount === null || amount === undefined) return "—";
  return `${currency ?? ""} ${Number(amount).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`.trim();
}

function currencySection(group) {
  // `money()` already carries the currency code, so the header needs
  // no separate currency prefix the way `supplier-performance.js`'s
  // own bare-code label does — this header is a sentence, not a tag.
  const header = el("div", {
    class: "muted",
    text: t("financialperformance.accrued").replace("{amount}", money(group.total, group.currency)),
  });
  const rows = barList(
    group.stages.map((s) => ({
      label: s.stageName,
      value: s.total,
      display: money(s.total, group.currency),
      note: t("financialperformance.invoicecount").replace("{n}", String(s.count)),
    }))
  );

  // A wrapper with extra spacing only when there is more than one
  // currency to tell apart — the header itself (currency and total)
  // always shows, since it is the report's own headline figure, not
  // merely a disambiguation the single-currency case can drop.
  return data.currencies.length > 1
    ? el("div", { class: "accrualcurrency" }, [header, rows])
    : el("div", {}, [header, rows]);
}

/** The card itself, built from whatever `load()` last fetched. Callers own the topbar, frame and tab shell around it. */
export function renderCard() {
  return data.currencies.length === 0
    ? el("div", { class: "panel card-graphic" }, [
        el("div", { class: "cardhead" }, [el("h3", { text: t("financialperformance.accruals") })]),
        el("div", { class: "muted", text: t("financialperformance.noaccruals") }),
      ])
    : el("div", { class: "panel card-graphic" }, [
        el("div", { class: "cardhead" }, [el("h3", { text: t("financialperformance.accruals") })]),
        el("div", { class: "sub", text: t("financialperformance.accrualssub") }),
        ...data.currencies.map((group) => currencySection(group)),
      ]);
}
