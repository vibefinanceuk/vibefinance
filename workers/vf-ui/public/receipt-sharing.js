import { t } from "/strings.js";
import { el as make } from "/tasks.js";
import { compactLink } from "/viewer.js";

/**
 * **Goods receipts, shared with suppliers in the network — decision 0738.**
 * Two places:
 *
 * - **AP Setup › Supplier Network** (`supplierNetworkTab`): whether
 *   suppliers see their receipts (off until turned on), and only
 *   registered ones;
 * - **the supplier's page**, on its Supplier portal card
 *   (`receiptSharingBlock`): As AP Setup, or this supplier's own choice,
 *   which wins.
 */

const el = (tag, props = {}, children = []) => make(tag, props, [].concat(children).filter((c) => c !== null && c !== undefined && c !== false));

async function call(path, init) {
  try {
    const response = await fetch(path, init);
    return { ok: response.ok, status: response.status, body: await response.json().catch(() => null) };
  } catch {
    return { ok: false, status: 0, body: null };
  }
}

const put = (path, body) => call(path, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

/** A radio with its words and help underneath, as AP Setup's other questions. */
function radio(name, value, checked, title, help, onchange, disabled = false) {
  const input = el("input", { type: "radio", name, value, id: `${name}-${value}`, ...(checked ? { checked: "checked" } : {}), ...(disabled ? { disabled: "disabled" } : {}) });
  input.addEventListener("change", onchange);
  return el("label", { class: "radiochoice", for: `${name}-${value}` }, [input, el("span", {}, [el("b", { text: title }), help ? el("span", { class: "muted sm", text: help }) : null])]);
}

// ---------------------------------------------------------------------------
// AP Setup › Supplier Network
// ---------------------------------------------------------------------------

let setup = null;

/** Loaded with the rest of AP Setup; its own failure leaves this tab saying so. */
export async function loadNetworkSharingSetup() {
  const r = await call("/api/network-sharing-config");
  setup = r.ok ? r.body : null;
}

export function supplierNetworkTab(rerender) {
  if (!setup) return el("div", { class: "panel" }, [el("p", { class: "problem", text: t("apsetup.network.loadfailed") })]);
  const draft = { ...setup.config };
  const problem = el("div", { class: "warn" });

  const registered = el("input", { type: "checkbox", id: "network-registered", ...(draft.registeredOnly ? { checked: "checked" } : {}) });
  registered.addEventListener("change", () => (draft.registeredOnly = registered.checked));

  const save = compactLink("save", {
    primary: true,
    onclick: async () => {
      problem.textContent = "";
      const r = await put("/api/network-sharing-config", draft);
      if (!r.ok) {
        problem.textContent = r.body?.error ?? t("apsetup.network.savefailed");
        return;
      }
      setup = r.body;
      rerender();
    },
  });

  return el("div", { class: "panel creditsetup networksetup" }, [
    el("div", { class: "cardhead" }, [el("h3", { text: t("apsetup.suppliernetwork") }), el("div", { class: "statebuttons" }, [save])]),
    el("p", { class: "muted sm", text: t("apsetup.network.sub") }),
    el("div", { class: "creditq" }, [
      el("b", { class: "creditqtitle", text: t("apsetup.network.receipts") }),
      el("div", { class: "radiochoices" }, [
        radio("network-receipts", "none", !draft.shareReceipts, t("apsetup.network.receipts.none"), t("apsetup.network.receipts.none.help"), () => (draft.shareReceipts = false)),
        radio("network-receipts", "share", draft.shareReceipts, t("apsetup.network.receipts.share"), t("apsetup.network.receipts.share.help"), () => (draft.shareReceipts = true)),
      ]),
      el("label", { class: "radiochoice networkregistered", for: "network-registered" }, [
        registered,
        el("span", {}, [el("b", { text: t("apsetup.network.registered") }), el("span", { class: "muted sm", text: t("apsetup.network.registered.help") })]),
      ]),
      setup.suppliersWithOwn > 0 ? el("p", { class: "muted sm networkown", text: t("apsetup.network.own").replace("{n}", String(setup.suppliersWithOwn)) }) : null,
    ]),
    problem,
  ]);
}

// ---------------------------------------------------------------------------
// The supplier's page
// ---------------------------------------------------------------------------

/**
 * **This supplier's choice, on its Supplier portal card.** As AP Setup
 * (saying what AP Setup says now), share, or don't share. Saved as soon as
 * it is chosen; read only for someone who may not maintain suppliers.
 * Fills itself; stays empty if the setting cannot be read.
 */
export function receiptSharingBlock(supplierId) {
  const block = el("div", { class: "receiptsharing", hidden: "" });
  const base = `/api/suppliers/${encodeURIComponent(supplierId)}/receipt-sharing`;

  async function draw(data, message = "", warn = false) {
    const name = `receiptsharing-${supplierId}`;
    const choose = (setting) => async () => {
      const r = await put(base, { setting });
      if (!r.ok) return draw(data, t("suppliers.receipts.failed"), true);
      draw(r.body, t("suppliers.receipts.saved"));
    };
    const disabled = !data.canManage;
    const parts = [
      el("div", { class: "portalinvitehead receiptsharinghead", text: t("suppliers.receipts.title") }),
      el("div", { class: "radiochoices" }, [
        radio(name, "default", data.setting === "default", t("suppliers.receipts.default"), t(data.apSetup ? "suppliers.receipts.default.share" : "suppliers.receipts.default.none"), choose("default"), disabled),
        radio(name, "share", data.setting === "share", t("suppliers.receipts.share"), "", choose("share"), disabled),
        radio(name, "none", data.setting === "none", t("suppliers.receipts.none"), "", choose("none"), disabled),
      ]),
      message ? el("div", { class: warn ? "warn" : "portalnote", text: message }) : null,
    ];
    block.replaceChildren(...parts.filter(Boolean));
    block.hidden = false;
  }

  call(base).then((r) => {
    if (r.ok && r.body) draw(r.body);
  });
  return block;
}
