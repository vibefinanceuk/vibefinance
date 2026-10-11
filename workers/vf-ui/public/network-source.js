import { t } from "/strings.js";
import { el } from "/tasks.js";
import { actionLink } from "/viewer.js";
import { asTree } from "/destinations.js";

/**
 * **A Supplier network source — decision 0726.** Invoices suppliers create
 * in the VibeFinance supplier network, as Peppol BIS Billing 3.0. Who may
 * send is who the customer invited, for the companies invited for; the
 * customer chooses here which companies this process takes them for.
 * The company of each invoice is the supplier's choice among those; its
 * supplier is the one the invitation is for.
 */

/** The companies accepted, in words. */
export function networkCompaniesSummary(ids, units) {
  if (!ids || ids.length === 0) return t("networksource.every");
  return ids.map((id) => units.find((u) => u.id === id)?.name ?? id).join(", ");
}

/** The source's own section on its panel: what it is, and the companies it accepts, with Choose. */
export function networkSection(source, units, onChanged) {
  const summary = el("span", { text: networkCompaniesSummary(source.networkOrgUnitIds, units) });
  const choose = actionLink("rename", { label: t("networksource.choose"), onclick: () => openCompanies(source, units, onChanged) });
  return el("div", { class: "panel networksource" }, [
    el("p", { class: "muted sm", text: t("networksource.about") }),
    el("div", { class: "prfields" }, [
      el("div", { class: "l", text: t("networksource.accepts") }),
      el("div", { class: "duline" }, [summary, ...(source.status === "retired" ? [] : [choose])]),
      el("div", { class: "l", text: t("networksource.company") }),
      el("div", { text: t("networksource.companyhow") }),
      el("div", { class: "l", text: t("networksource.supplier") }),
      el("div", { text: t("networksource.supplierhow") }),
      el("div", { class: "l", text: t("networksource.format") }),
      el("div", { text: t("networksource.formatwhat") }),
    ]),
  ]);
}

function openCompanies(source, units, onChanged) {
  const chosen = new Set(source.networkOrgUnitIds ?? []);
  const all = el("input", { type: "checkbox", id: "ns-all", ...(chosen.size === 0 ? { checked: "checked" } : {}) });
  const boxes = asTree(units).map((u) => {
    const box = el("input", { type: "checkbox", value: u.id, ...(chosen.has(u.id) ? { checked: "checked" } : {}) });
    box.onchange = () => {
      if (box.checked) all.checked = false;
    };
    return { box, row: el("label", { class: "httpscheck", style: `padding-left:${u.depth * 18}px` }, [box, el("span", { text: u.name })]) };
  });
  all.onchange = () => {
    if (all.checked) for (const b of boxes) b.box.checked = false;
  };
  const problem = el("div", { class: "warn", id: "ns-problem" });
  const close = () => backdrop.remove();
  const save = async () => {
    problem.textContent = "";
    const orgUnitIds = all.checked ? null : boxes.filter((b) => b.box.checked).map((b) => b.box.value);
    if (orgUnitIds && orgUnitIds.length === 0) {
      problem.textContent = t("networksource.chooseone");
      return;
    }
    const response = await fetch(`/api/sources/${encodeURIComponent(source.id)}/network-companies`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orgUnitIds }),
    }).catch(() => null);
    if (!response?.ok) {
      problem.textContent = (await response?.json().catch(() => ({})))?.error ?? t("networksource.failed");
      return;
    }
    source.networkOrgUnitIds = orgUnitIds;
    close();
    await onChanged?.();
  };
  const backdrop = el("div", { class: "backdrop" }, [
    el("div", { class: "popout dounitspop", role: "dialog", "aria-label": t("networksource.title") }, [
      el("div", { class: "cardhead" }, [
        el("h3", { text: t("networksource.title") }),
        el("div", { class: "statebuttons" }, [actionLink("save", { primary: true, onclick: save }), actionLink("close", { label: t("httpsout.cancel"), onclick: close })]),
      ]),
      el("p", { class: "muted sm", text: t("networksource.titlesub") }),
      el("label", { class: "httpscheck" }, [all, el("strong", { text: t("networksource.every") })]),
      el("div", { class: "dounits" }, boxes.map((b) => b.row)),
      problem,
    ]),
  ]);
  backdrop.onclick = (e) => {
    if (e.target === backdrop) close();
  };
  document.body.append(backdrop);
}
