import { t } from "/strings.js";
import { el } from "/tasks.js";
import { actionLink } from "/viewer.js";

/**
 * **Orders to suppliers, on a Destination — decision 0759.** Shown in the
 * Destination panel on Process routes for the Purchase Orders process:
 * who orders go to (a fixed order of preference, said here so nobody has
 * to guess), its settings, starting it, and what it sent.
 */

async function call(path, init) {
  try {
    const response = await fetch(path, init);
    return { ok: response.ok, status: response.status, body: await response.json().catch(() => null) };
  } catch {
    return { ok: false, status: 0, body: null };
  }
}

const pill = (tone, text) => el("span", { class: `rmpill ${tone}`, text });
const TONE = { sent: "ok", failed: "bad", no_address: "warn", not_sent: "q" };

function when(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

/** What one send says beside its status. Exported for the order page. */
export function sendDetail(s) {
  if (s.status === "sent") return `${s.to.join(", ")} · ${t(`ordersout.from.${s.from}`)}`;
  if (s.status === "failed") return s.error ?? "";
  if (s.status === "no_address") return t("ordersout.noaddress");
  return t("ordersout.supplierown");
}

export function ordersOutSection(destination, onChanged) {
  const root = el("div", { class: "doconnector", id: "orders-out" }, [el("p", { class: "muted sm", text: t("ordersout.loading") })]);
  const base = `/api/route-instances/${encodeURIComponent(destination.id)}/orders-out`;

  async function load() {
    const r = await call(base);
    if (!r.ok) {
      root.replaceChildren(el("div", { class: "warn", text: t("ordersout.failed") }));
      return;
    }
    draw(r.body);
  }

  function draw(state) {
    const s = state.settings;
    const problem = el("div", { class: "warn", id: "oo-problem" });
    const onRelease = el("input", { type: "checkbox", id: "oo-onrelease", ...(s.sendOnRelease ? { checked: "checked" } : {}) });
    const ccBuyer = el("input", { type: "checkbox", id: "oo-ccbuyer", ...(s.ccBuyer ? { checked: "checked" } : {}) });
    const attachUbl = el("input", { type: "checkbox", id: "oo-ubl", ...(s.attachUbl ? { checked: "checked" } : {}) });
    // Decision 0760.
    const attachPdf = el("input", { type: "checkbox", id: "oo-pdf", ...(s.attachPdf !== false ? { checked: "checked" } : {}) });
    const replyTo = el("input", { type: "email", id: "oo-replyto", value: s.replyTo ?? "", placeholder: t("ordersout.replytohint") });
    const check = (input, label, hint) => el("label", { class: "oocheck" }, [input, el("span", {}, [el("span", { text: label }), hint ? el("div", { class: "muted sm", text: hint }) : null].filter(Boolean))]);
    const save = actionLink("save", {
      primary: true,
      onclick: async () => {
        problem.textContent = "";
        const r = await call(base, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sendOnRelease: onRelease.checked, ccBuyer: ccBuyer.checked, attachPdf: attachPdf.checked, attachUbl: attachUbl.checked, replyTo: replyTo.value.trim() || null }) });
        if (!r.ok) {
          problem.textContent = r.body?.reason === "bad_address" ? t("ordersout.badaddress") : r.body?.error ?? t("ordersout.failed");
          return;
        }
        await load();
      },
    });
    save.id = "oo-save";
    const start = state.started
      ? null
      : actionLink("release", {
          primary: true,
          label: t("ordersout.start"),
          onclick: async () => {
            const r = await call(`${base}/start`, { method: "POST" });
            if (!r.ok) {
              problem.textContent = r.body?.error ?? t("ordersout.failed");
              return;
            }
            await onChanged?.();
          },
        });
    if (start) start.id = "oo-start";
    const rows = state.sends.map((x) =>
      el("tr", { "data-order": x.orderNumber }, [
        el("td", { text: x.orderNumber }),
        el("td", { text: t(`ordersout.kind.${x.kind}`) }),
        el("td", {}, [pill(TONE[x.status] ?? "q", t(`ordersout.status.${x.status}`))]),
        el("td", { text: sendDetail(x) }),
        el("td", { class: "muted", text: `${when(x.at)}${x.how === "by_hand" && x.by ? ` · ${x.by}` : ""}` }),
      ])
    );
    root.replaceChildren(
      el("div", { class: "docard", id: "oo-who" }, [
        el("h4", { text: t("ordersout.who") }),
        el("ol", { class: "sm oowho" }, ["ordersout.who.order", "ordersout.who.orders", "ordersout.who.email", "ordersout.who.none"].map((k) => el("li", { text: t(k) }))),
        el("p", { class: "muted sm", text: t("ordersout.who.own") }),
        // Decision 0762.
        el("p", { class: "muted sm", id: "oo-confirmnote", text: t("ordersout.confirmnote") }),
      ]),
      el("div", { class: "docard", id: "oo-settings" }, [
        el("div", { class: "cardhead" }, [el("h4", { text: t("ordersout.settings") }), el("div", { class: "statebuttons" }, [start, save].filter(Boolean))]),
        state.started ? null : el("p", { class: "warn sm", id: "oo-notstarted", text: t("ordersout.notstarted") }),
        check(onRelease, t("ordersout.onrelease"), t("ordersout.onreleasehint")),
        check(ccBuyer, t("ordersout.ccbuyer"), null),
        check(attachPdf, t("ordersout.attachpdf"), null),
        check(attachUbl, t("ordersout.attachubl"), t("ordersout.attachublhint")),
        el("div", { class: "dofield" }, [el("label", { for: "oo-replyto", text: t("ordersout.replyto") }), replyTo, el("div", { class: "muted sm", text: t("ordersout.replytonote") })]),
        problem,
      ].filter(Boolean)),
      el("div", { class: "docard", id: "oo-sends" }, [
        el("h4", { text: t("ordersout.sends") }),
        rows.length
          ? el("table", { class: "httpskeys" }, [
              el("thead", {}, [el("tr", {}, ["ordersout.col.order", "ordersout.col.kind", "ordersout.col.status", "ordersout.col.detail", "ordersout.col.when"].map((k) => el("th", { text: t(k) })))]),
              el("tbody", {}, rows),
            ])
          : el("p", { class: "muted sm", text: t("ordersout.nosends") }),
      ])
    );
  }

  load();
  return root;
}
