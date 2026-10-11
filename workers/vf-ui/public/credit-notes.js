import { t } from "/strings.js";
import { el as make } from "/tasks.js";
import { actionLink, compactLink } from "/viewer.js";

/**
 * **Credit notes — decision 0731.** Three places:
 *
 * - **AP Setup › Credit Notes** (`creditNotesTab`): what a credit note
 *   does to the invoice it credits, and who confirms;
 * - **Credits to confirm** at the top of Tasks (`fill`), for that team:
 *   each credit note waiting, with Credit / Pay (or, where its invoice
 *   was not found, which invoice, or none);
 * - **the viewer** (`creditPanel`): on a credit note, what it credits;
 *   on an invoice, what credited it — with the same buttons while it
 *   waits.
 */

const el = (tag, props = {}, children = []) => make(tag, props, [].concat(children).filter((c) => c !== null && c !== undefined && c !== false));
const words = (key, values = {}) => Object.entries(values).reduce((s, [k, v]) => s.split(`{${k}}`).join(v === null || v === undefined ? "" : String(v)), t(key));

async function call(path, init) {
  try {
    const response = await fetch(path, init);
    return { ok: response.ok, status: response.status, body: await response.json().catch(() => null) };
  } catch {
    return { ok: false, status: 0, body: null };
  }
}

const post = (path, body) => call(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

function money(amount, currency) {
  if (typeof amount !== "number") return "—";
  try {
    return new Intl.NumberFormat(document.documentElement.lang || "en", { style: "currency", currency: currency || "GBP" }).format(amount);
  } catch {
    return amount.toFixed(2);
  }
}

// ---------------------------------------------------------------------------
// AP Setup › Credit Notes
// ---------------------------------------------------------------------------

let setup = null;

/** Loaded with the rest of AP Setup; its own failure leaves this tab saying so, not the screen. */
export async function loadCreditNoteSetup() {
  const r = await call("/api/credit-note-config");
  setup = r.ok ? r.body : null;
}

export function creditNotesTab(rerender) {
  if (!setup) return el("div", { class: "panel" }, [el("p", { class: "problem", text: t("apsetup.credit.loadfailed") })]);
  const draft = { ...setup.config };
  const problem = el("div", { class: "warn" });

  const choice = (name, value, extra = null) => {
    const input = el("input", { type: "radio", name: `credit-${name}`, value, id: `credit-${name}-${value}`, ...(draft[name] === value ? { checked: "checked" } : {}) });
    input.addEventListener("change", () => (draft[name] = value));
    return el("div", {}, [
      el("label", { class: "radiochoice", for: `credit-${name}-${value}` }, [
        input,
        el("span", {}, [el("b", { text: t(`apsetup.credit.${name}.${value}`) }), el("span", { class: "muted sm", text: t(`apsetup.credit.${name}.${value}.help`) })]),
      ]),
      extra,
    ]);
  };
  const question = (key, body) => el("div", { class: "creditq" }, [el("b", { class: "creditqtitle", text: t(key) }), body]);

  const team = el("select", { "aria-label": t("apsetup.credit.team") }, [
    el("option", { value: "", text: t("apsetup.credit.team.none") }),
    ...setup.teams.map((tm) => el("option", { value: tm.id, text: tm.name })),
  ]);
  team.value = draft.confirmTeamId ?? "";
  team.addEventListener("change", () => (draft.confirmTeamId = team.value || null));

  const network = el("input", { type: "checkbox", id: "credit-network", ...(draft.networkAllowed ? { checked: "checked" } : {}) });
  network.addEventListener("change", () => (draft.networkAllowed = network.checked));

  const save = compactLink("save", {
    primary: true,
    onclick: async () => {
      problem.textContent = "";
      const r = await call("/api/credit-note-config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) });
      if (!r.ok) {
        problem.textContent = r.body?.error ?? t("apsetup.credit.savefailed");
        return;
      }
      setup = { ...setup, config: r.body.config };
      rerender();
    },
  });

  return el("div", { class: "panel creditsetup" }, [
    el("div", { class: "cardhead" }, [el("h3", { text: t("apsetup.creditnotes") }), el("div", { class: "statebuttons" }, [save])]),
    el("p", { class: "muted sm", text: t("apsetup.credit.sub") }),
    question("apsetup.credit.fullUnpaid", el("div", { class: "radiochoices" }, [choice("fullUnpaid", "take_out"), choice("fullUnpaid", "confirm")])),
    question("apsetup.credit.partial", el("div", { class: "radiochoices" }, [choice("partial", "pay"), choice("partial", "hold")])),
    question("apsetup.credit.notFound", el("div", { class: "radiochoices" }, [choice("notFound", "review"), choice("notFound", "process")])),
    question("apsetup.credit.paid", el("p", { class: "creditfixed sm", text: t("apsetup.credit.paid.help") })),
    question("apsetup.credit.team", el("div", { class: "creditteam" }, [team, el("span", { class: "muted sm", text: t("apsetup.credit.team.help") })])),
    question(
      "apsetup.credit.network",
      el("label", { class: "radiochoice", for: "credit-network" }, [
        network,
        el("span", {}, [el("b", { text: t("apsetup.credit.network.allow") }), el("span", { class: "muted sm", text: t("apsetup.credit.network.help") })]),
      ])
    ),
    problem,
  ]);
}

// ---------------------------------------------------------------------------
// Deciding one
// ---------------------------------------------------------------------------

/** What it says: which invoice, in full or part, and how it stands. */
export function creditLine(c) {
  if (!c.invoice) return words("credit.line.notfound", { reference: c.reference ?? "—" });
  return words(c.covers === "full" ? "credit.line.full" : "credit.line.partial", { invoice: c.invoice.number ?? "—", total: money(c.invoice.total, c.currency) });
}

/** The buttons while it waits: Credit and Pay with its invoice; otherwise which invoice, or none. */
function decideButtons(c, after) {
  const problem = el("span", { class: "warn sm" });
  const decide = async (body) => {
    problem.textContent = "";
    const r = await post(`/api/credit-notes/${encodeURIComponent(c.creditNoteId)}/decide`, body);
    if (!r.ok) {
      problem.textContent = r.body?.reason ? t(`credit.problem.${r.body.reason}`) : r.body?.error ?? t("credit.problem.failed");
      return;
    }
    await after();
  };
  if (c.invoice) {
    return el("div", { class: "dobuttons" }, [
      actionLink("tick", { label: t("credit.do.credit"), primary: true, onclick: () => decide({ decision: "credit" }) }),
      actionLink("post", { label: t("credit.do.pay"), onclick: () => decide({ decision: "pay" }) }),
      problem,
    ]);
  }
  const number = el("input", { type: "text", class: "creditnumber", placeholder: t("credit.do.number"), "aria-label": t("credit.do.number") });
  return el("div", { class: "dobuttons" }, [
    number,
    actionLink("purchaseorders", { label: t("credit.do.link"), primary: true, onclick: () => decide({ decision: "link", invoiceNumber: number.value }) }),
    actionLink("post", { label: t("credit.do.none"), onclick: () => decide({ decision: "none" }) }),
    problem,
  ]);
}

// ---------------------------------------------------------------------------
// Credits to confirm, on Tasks
// ---------------------------------------------------------------------------

export async function fill(holder) {
  if (!holder) return 0;
  const r = await call("/api/credit-notes/to-confirm");
  const credits = r.ok ? r.body?.credits ?? [] : [];
  if (credits.length === 0) {
    holder.hidden = true;
    holder.replaceChildren();
    return 0;
  }
  holder.hidden = false;
  const refill = () => fill(holder);
  const open = async (id) => {
    const { openViewer } = await import("/viewer.js");
    document.getElementById("shell").hidden = true;
    document.getElementById("viewer").hidden = false;
    await openViewer({ subject: { type: "invoice", id }, actions: [] }, async () => {
      document.getElementById("viewer").hidden = true;
      document.getElementById("shell").hidden = false;
      refill();
    });
  };
  const row = (c) =>
    el("div", { class: "agentnote creditconfirm" }, [
      el("div", { class: "agentnotehead" }, [
        el("div", {}, [
          el("span", { class: "agentnotename", text: [words("credit.title", { number: c.creditNoteNumber ?? "—" }), c.supplierName].filter(Boolean).join(" · ") }),
          el("span", { class: "rmpill warn agentnotetag", text: money(-(c.total ?? 0), c.currency) }),
          el("div", { class: "muted sm", text: creditLine(c) }),
          c.note ? el("div", { class: "agentnotewhy", text: c.note }) : null,
        ]),
        el("div", {}, [
          el("div", { class: "dobuttons" }, [
            actionLink("expand", { label: t("credit.open.credit"), onclick: () => open(c.creditNoteId) }),
            c.invoice ? actionLink("expand", { label: t("credit.open.invoice"), onclick: () => open(c.invoice.id) }) : null,
          ]),
          decideButtons(c, refill),
        ]),
      ]),
    ]);
  holder.replaceChildren(
    el("div", { class: "panel agentnotes creditconfirms" }, [
      el("h3", { text: t("credit.heading") }),
      el("p", { class: "muted sm", text: t("credit.sub") }),
      el("div", { class: "receiptconvlist" }, credits.map(row)),
    ])
  );
  return credits.length;
}

// ---------------------------------------------------------------------------
// The viewer
// ---------------------------------------------------------------------------

/** On a credit note, what it credits; on an invoice, what credited it. Null when neither. */
export function creditPanel(credits, after) {
  if (!credits || (!credits.credit && !(credits.creditedBy ?? []).length)) return null;
  const rows = [];
  const c = credits.credit;
  if (c) {
    rows.push(
      el("div", { class: "reasonline-row" }, [
        el("span", { class: "reasonline-label", text: t("credit.viewer.this") }),
        el("span", { text: `${creditLine(c)} · ${t(`credit.state.${c.state}`)}${c.afterPayment ? ` · ${t("credit.afterpayment")}` : ""}` }),
      ])
    );
    if (c.state === "to_confirm" && credits.mayConfirm) rows.push(decideButtons(c, after));
  }
  for (const by of credits.creditedBy ?? []) {
    rows.push(
      el("div", { class: "reasonline-row" }, [
        el("span", { class: "reasonline-label", text: t("credit.viewer.by") }),
        el("span", { text: `${words("credit.title", { number: by.creditNoteNumber ?? "—" })} · ${money(by.total, by.currency)} · ${t(`credit.state.${by.state}`)}` }),
      ])
    );
    if (by.state === "to_confirm" && credits.mayConfirm) rows.push(decideButtons(by, after));
  }
  return el("div", { class: `panel reasonline creditpanel${(c?.state ?? credits.creditedBy?.[0]?.state) === "to_confirm" ? " waiting" : ""}` }, rows);
}
