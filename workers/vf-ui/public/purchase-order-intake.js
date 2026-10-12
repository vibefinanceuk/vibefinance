import { t } from "/strings.js";
import { el as make, frame, topbar, hasMyPermission } from "/tasks.js";
import { actionLink } from "/viewer.js";
import { icon } from "/icons.js";

/**
 * **A purchase order held at Checking — decision 0750.** Opened from its
 * task, or from the orders waiting on Purchase Orders, as a page in the
 * application's frame (as a goods receipt opens, 0741): what the
 * procurement system sent, what Checking found, and (for a change or a
 * cancellation) the order in force it would replace.
 *
 * Whoever claims its task (AP.Purchasing) may set the company or the
 * supplier, which checks it again; **Release** it (asked to confirm,
 * having seen what was found, where something still is); or **Reject**
 * it with a reason. Back returns to whatever opened it.
 */

const el = (tag, props = {}, children = []) => make(tag, props, children.filter((c) => c !== null && c !== undefined && c !== false));

async function call(path, init) {
  try {
    const response = await fetch(`/api${path}`, init);
    const body = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, body };
  } catch {
    return { ok: false, status: 0, body: {} };
  }
}
const post = (path, body) => call(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

const words = (key, values = {}) => Object.entries(values).reduce((s, [k, v]) => s.split(`{${k}}`).join(v === null || v === undefined ? "" : String(v)), t(key));
const dash = (v) => (v === null || v === undefined || v === "" ? "—" : String(v));
const num = (n) => (typeof n === "number" ? (Number.isInteger(n) ? String(n) : n.toFixed(2)) : "—");

/** One thing Checking found, in words, with the lines it is about. */
export function problemWords(p) {
  const base = words(`poin.problem.${p.code}`, { detail: p.detail ?? "" });
  return p.lines?.length ? `${base} ${words("poin.problem.lines", { lines: p.lines.join(", ") })}` : base;
}

/**
 * Opens one order on its way in. `onDone` runs after it is released or
 * rejected (Tasks reloads; Purchase Orders refreshes its lists).
 */
export async function openOrderIntake(id, { onDone = null } = {}) {
  const r = await call(`/purchase-orders/intake/${encodeURIComponent(id)}`);
  if (!r.ok) return false;
  const order = r.body.order;
  const viewerPane = document.getElementById("viewer");
  const shellPane = document.getElementById("shell");
  const before = viewerPane && !viewerPane.hidden ? [...viewerPane.childNodes] : null;
  const close = () => {
    if (!viewerPane) return;
    if (before) return void viewerPane.replaceChildren(...before);
    viewerPane.replaceChildren();
    viewerPane.hidden = true;
    if (shellPane) shellPane.hidden = false;
  };
  const reopen = async () => {
    close();
    await openOrderIntake(id, { onDone });
  };
  const problem = el("div", { class: "warn", id: "poin-problem" });
  // The server's reason in this screen's words where there are some; its own words otherwise.
  const say = (body, fallback) => {
    const key = body?.reason ? `poin.refused.${body.reason}` : null;
    problem.replaceChildren(el("div", { text: key && t(key) !== key ? t(key) : (body?.error ?? t(fallback)) }));
  };

  const task = order.task;
  const pending = order.status === "pending";
  const works = hasMyPermission("AP.Purchasing");
  const acts = pending && works && task?.canRelease;

  // ── Actions, top right, beside Back ──
  const buttons = [];
  const claimOrRelease = async (what) => {
    const done = await post(`/tasks/${encodeURIComponent(task.id)}/${what}`, {});
    if (!done.ok) return say(done.body, "poin.failed");
    await reopen();
  };
  if (pending && works && task?.canClaim) {
    const claim = actionLink("claim", { primary: true, onclick: () => claimOrRelease("claim") });
    claim.id = "poin-claim";
    buttons.push(claim);
  }
  if (acts) {
    const release = actionLink("complete", {
      primary: true,
      label: t("poin.release"),
      onclick: async () => {
        const anyway = order.problems.length > 0;
        if (anyway) {
          // Seen what was found: said, and confirmed, before it goes on.
          problem.replaceChildren(
            el("div", { text: t("poin.releaseanyway.prompt") }),
            el("ul", {}, order.problems.map((p) => el("li", { text: problemWords(p) }))),
            el("button", { class: "primary", id: "poin-releaseanyway", text: t("poin.releaseanyway"), onclick: () => doRelease(true) })
          );
          return;
        }
        await doRelease(false);
      },
    });
    release.id = "poin-release";
    if (order.blocked) release.disabled = true;
    buttons.push(release);
    const reject = actionLink("close", {
      label: t("poin.reject"),
      onclick: () => {
        const why = el("input", { type: "text", class: "searchbox", id: "poin-rejectreason", placeholder: t("poin.rejectwhy") });
        problem.replaceChildren(
          el("div", { text: t("poin.rejectprompt") }),
          why,
          el("button", {
            class: "primary",
            id: "poin-rejectconfirm",
            text: t("poin.rejectconfirm"),
            onclick: async () => {
              const done = await post(`/purchase-orders/intake/${encodeURIComponent(id)}/reject`, { reason: why.value });
              if (!done.ok) return say(done.body, "poin.failed");
              close();
              if (onDone) await onDone();
            },
          })
        );
        why.focus();
      },
    });
    reject.id = "poin-reject";
    buttons.push(reject);
  }
  if (pending && works && task?.canRelease) {
    const unclaim = actionLink("release", { label: t("poin.unclaim"), onclick: () => claimOrRelease("release") });
    unclaim.id = "poin-unclaim";
    buttons.push(unclaim);
  }
  async function doRelease(anyway) {
    const done = await post(`/purchase-orders/intake/${encodeURIComponent(id)}/release`, anyway ? { anyway: true } : {});
    if (!done.ok) return say(done.body, "poin.failed");
    close();
    if (onDone) await onDone();
  }
  const back = el("button", { class: "actionlink", type: "button", id: "poin-back", title: t("viewer.back"), onclick: () => close() }, [icon("back"), el("span", { text: t("viewer.back") })]);

  // ── What it is, and where it stands ──
  const banners = [];
  if (pending && order.process?.stage)
    banners.push(el("div", { class: "warn", id: "poin-waiting", text: words("poin.waiting", { stage: order.process.stage, process: order.process.name }) }));
  if (order.problems.length)
    banners.push(
      el("div", { class: "warn", id: "poin-found" }, [
        el("div", { text: t(order.blocked ? "poin.found.blocked" : "poin.found") }),
        el("ul", {}, order.problems.map((p) => el("li", { "data-code": p.code, text: problemWords(p) }))),
      ])
    );
  if (pending && task)
    banners.push(el("div", { class: "muted sm", id: "poin-task", text: task.claimedBy ? words("poin.claimedby", { who: task.claimedBy }) : t("poin.unclaimed") }));
  if (order.released) banners.push(el("div", { id: "poin-released", text: words(order.released.anyway ? "poin.released.anyway" : "poin.released", { who: order.released.by ?? "—" }) }));
  if (order.rejected) banners.push(el("div", { class: "warn", id: "poin-rejected", text: words("poin.rejected", { who: order.rejected.by ?? "—", why: order.rejected.reason ?? "" }) }));

  const fact = (k, v) => [el("div", { class: "muted", text: t(k) }), el("div", {}, [typeof v === "string" || v === null || v === undefined ? dash(v) : v])];

  // The company and supplier may be set while the task is held.
  const companyChoice = () => {
    const select = el("select", { id: "poin-company" }, [
      el("option", { value: "", text: t("poin.choosecompany") }),
      ...(order.companies ?? []).map((c) => el("option", { value: c.id, text: c.name, ...(order.company?.id === c.id ? { selected: "selected" } : {}) })),
    ]);
    select.onchange = async () => {
      if (!select.value) return;
      const done = await post(`/purchase-orders/intake/${encodeURIComponent(id)}/fix`, { orgUnitId: select.value });
      if (!done.ok) return say(done.body, "poin.failed");
      await reopen();
    };
    return select;
  };
  const supplierChoice = () => {
    const box = el("input", { type: "search", class: "searchbox", id: "poin-supplier", placeholder: t("poin.findsupplier") });
    const results = el("div", { class: "poinsuppliers", id: "poin-supplier-results" });
    let timer = null;
    box.oninput = () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        if (box.value.trim().length < 2) return void results.replaceChildren();
        const found = await call(`/purchase-orders/intake/${encodeURIComponent(id)}/suppliers?q=${encodeURIComponent(box.value.trim())}`);
        results.replaceChildren(
          ...(found.body?.suppliers ?? []).map((s) =>
            el("button", {
              type: "button",
              class: "linkish",
              text: [s.name, s.vatId ?? s.erpIdentifier, s.status !== "active" ? t("poin.inactive") : null].filter(Boolean).join(" · "),
              onclick: async () => {
                const done = await post(`/purchase-orders/intake/${encodeURIComponent(id)}/fix`, { supplierId: s.id });
                if (!done.ok) return say(done.body, "poin.failed");
                await reopen();
              },
            })
          )
        );
      }, 250);
    };
    return el("div", {}, [box, results]);
  };
  const companyValue = acts ? companyChoice() : order.company?.name ?? (order.buyerPartyId ? words("poin.unknowncompany", { id: order.buyerPartyId }) : null);
  const supplierText = order.supplier ? `${order.supplier.name}${order.supplier.status !== "active" ? ` · ${t("poin.inactive")}` : ""}` : order.sellerPartyId ? words("poin.unknownsupplier", { id: order.sellerPartyId }) : null;
  const supplierValue = acts && order.kind !== "cancellation" ? el("div", {}, [el("div", { text: dash(supplierText) }), supplierChoice()]) : supplierText;

  const inForceLines = new Map((order.inForce?.lines ?? []).map((l) => [l.lineNumber, l]));
  const flagged = new Map();
  for (const p of order.problems) for (const n of p.lines ?? []) flagged.set(n, [...(flagged.get(n) ?? []), p.code]);
  const linesTable =
    order.kind === "cancellation"
      ? el("p", { class: "muted", id: "poin-cancel", text: words("poin.cancels", { note: order.note ?? "—" }) })
      : el("div", { class: "tablewrap" }, [
          el("table", { id: "poin-lines" }, [
            el("thead", {}, [
              el("tr", {}, [
                ...["poin.col.line", "poin.col.item", "poin.col.quantity", "poin.col.unit", "poin.col.price", "poin.col.amount"].map((k) => el("th", { text: t(k) })),
                order.inForce ? el("th", { text: t("poin.col.inforce") }) : null,
              ]),
            ]),
            el(
              "tbody",
              {},
              order.lines.map((l) => {
                const was = inForceLines.get(l.lineNumber);
                return el("tr", { "data-line": String(l.lineNumber), class: flagged.has(l.lineNumber) ? "poinflagged" : "" }, [
                  el("td", { text: String(l.lineNumber) }),
                  el("td", { text: dash(l.itemName ?? l.sellersItemId ?? l.standardItemId) }),
                  el("td", { class: "num", text: num(l.quantity) }),
                  el("td", { text: dash(l.unitCode) }),
                  el("td", { class: "num", text: num(l.priceAmount) }),
                  el("td", { class: "num", text: num(l.lineExtensionAmount) }),
                  order.inForce ? el("td", { class: "muted sm", text: was ? words("poin.was", { quantity: num(was.quantity), price: num(was.priceAmount) }) : t("poin.newline") }) : null,
                ]);
              })
            ),
          ]),
          // Lines the order in force has that this one no longer does.
          ...(order.inForce
            ? [...inForceLines.keys()].filter((n) => !order.lines.some((l) => l.lineNumber === n)).map((n) => el("div", { class: "muted sm poinremoved", text: words("poin.removed", { line: n }) }))
            : []),
        ]);

  const main = el("div", { class: "panel receiptmain", id: "poin-main" }, [
    ...banners,
    el("div", { class: "editgrid" }, [
      ...fact("poin.kind", t(`poin.kind.${order.kind}`)),
      ...fact("poin.company", companyValue),
      ...fact("poin.supplier", supplierValue),
      ...fact("poin.issued", order.issueDate),
      ...fact("poin.currency", order.currency),
      ...fact("poin.total", order.totals?.payableAmount !== null && order.totals?.payableAmount !== undefined ? num(order.totals.payableAmount) : null),
      ...fact("poin.from", [order.from?.source, order.from?.sender].filter(Boolean).join(" · ") || null),
      ...(order.changeReference ? fact("poin.changeref", `${order.changeReference}${order.sequenceNumber ? ` (${order.sequenceNumber})` : ""}`) : []),
    ]),
    problem,
    linesTable,
  ]);
  const page = frame(
    el("div", { class: "receiptview", id: "poin" }, [
      topbar(order.orderNumber, [t("doctype.purchase_order"), t(`poin.status.${order.status}`)].join(" · "), [el("div", { class: "statebuttons receiptactions" }, [...buttons, back])]),
      main,
    ])
  );
  if (viewerPane) {
    viewerPane.replaceChildren(page);
    viewerPane.hidden = false;
    if (shellPane) shellPane.hidden = true;
    window.scrollTo?.(0, 0);
  }
  return true;
}
