import { t } from "/strings.js";
import { el as make } from "/tasks.js";
import { icon } from "/icons.js";

/**
 * **A goods receipt's Timeline and Chat — decision 0658.** Built like
 * the invoice viewer's (activity.js, collaborators.js, 0269/0470) and
 * drawn with the same classes, so the two read alike: the people and
 * teams in the conversation, what happened to the receipt oldest first
 * with the messages among it, and a box to write in.
 *
 * Unlike those two it keeps its state per call, not per module, so a
 * receipt opened again (after a fix, say) starts clean.
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
const send = (path, method, body) => call(path, { method, headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });

const initials = (name) =>
  String(name ?? "?")
    .split(" ")
    .map((w) => w[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();

/** "7 Oct 2026, 09:12", in the browser's own time. */
function when(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso ?? "");
  return d.toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** A refusal in words: the reason's own, where there is one. */
function refused(body, fallbackKey) {
  if (body?.reason) {
    const key = `receipts.error.${body.reason}`;
    const words = t(key);
    if (words !== key) return words.split("{name}").join(body.name ?? "");
  }
  return body?.error ?? t(fallbackKey);
}

const fill = (key, values) => Object.entries(values).reduce((s, [k, v]) => s.split(`{${k}}`).join(v === null || v === undefined || v === "" ? "—" : String(v)), t(key));
const qtyUnit = (x) => (x ? `${x.quantity ?? "—"}${x.unit ? ` ${x.unit}` : ""}` : "—");
const orderLine = (x) => (x ? `${x.order} / ${x.line}` : "—");

/** What one thing that happened says, in words. Exported for its test. */
export function describe(item) {
  const d = item.detail ?? {};
  const by = item.by ?? t("receipts.tl.someone");
  switch (item.kind) {
    case "received":
      if (d.messageId) return fill("receipts.tl.received.message", { source: d.sourceName ?? t("receipts.tl.aroute"), message: d.messageId, by: item.by, lines: d.lines });
      return fill(d.source === "screen" ? "receipts.tl.received.screen" : "receipts.tl.received.file", { by, lines: d.lines });
    case "stopped":
      return fill("receipts.tl.stopped", { stage: d.stage, team: d.team });
    case "claimed":
    case "released":
    case "reassigned":
      return fill(`receipts.tl.${item.kind}`, { by });
    case "line_corrected":
      return fill("receipts.tl.linecorrected", { by, line: item.lineNumber, from: qtyUnit(d.from), to: qtyUnit(d.to) });
    case "line_repointed":
      return fill("receipts.tl.linerepointed", { by, line: item.lineNumber, from: orderLine(d.from), to: orderLine(d.to) });
    case "line_rejected":
      return fill("receipts.tl.linerejected", { by, line: item.lineNumber, reason: d.reason });
    case "lines_released":
      return fill(d.counted ? "receipts.tl.linescounted" : "receipts.tl.linesmatched", { by, lines: d.lines, orders: (d.orders ?? []).join(", ") });
    case "registered": {
      const how = { register: "receipts.tl.registered.register", order_loaded: "receipts.tl.registered.order", recorded: "receipts.tl.registered.recorded" }[d.how] ?? "receipts.tl.registered.matched";
      const words = fill(how, { by, orders: d.orders });
      return d.partial ? `${words} ${t("receipts.tl.registered.partial")}` : words;
    }
    case "rejected":
      return fill("receipts.tl.rejected", { by, reason: d.reason });
    case "cancelled":
      return fill("receipts.tl.cancelled", { by, reason: d.reason });
    case "collaborator_added":
    case "collaborator_removed":
      return fill(`receipts.tl.${item.kind === "collaborator_added" ? "added" : "removed"}.${d.kind === "team" ? "team" : "user"}`, { by, name: d.name });
    default:
      return item.kind;
  }
}

/**
 * The Timeline and Chat for one receipt, loaded at once. `canWrite` is
 * false only where the page knows the person cannot post (never today:
 * whoever can open a receipt may write in it).
 */
export function buildReceiptTimeline(receiptId, { countBadge = null } = {}) {
  const root = el("div", { class: "receipttimeline", id: "receipt-timeline" });
  const s = { loading: true, error: null, items: [], collaborators: [], canManage: false, posting: false, sentNote: null, addOpen: false, problem: null, results: null, generation: 0 };
  const box = el("textarea", { id: "receipt-chat-input", placeholder: t("receipts.tl.placeholder") });
  const search = el("input", { type: "text", id: "receipt-people-search", placeholder: t("receipts.tl.searchpeople") });
  const results = el("div", { class: "collabsearchresultswrap", id: "receipt-people-results" });
  const base = `/goods-receipts/${encodeURIComponent(receiptId)}`;

  async function load() {
    const r = await call(`${base}/timeline`);
    s.loading = false;
    if (!r.ok) s.error = t("receipts.tl.failed");
    else Object.assign(s, { error: null, items: r.body.items ?? [], collaborators: r.body.collaborators ?? [], canManage: Boolean(r.body.canManage) });
    render();
  }

  async function post() {
    const text = box.value.trim();
    if (!text || s.posting) return;
    s.posting = true;
    const r = await send(`${base}/comments`, "POST", { body: text });
    s.posting = false;
    if (!r.ok) {
      s.problem = refused(r.body, "receipts.tl.postfailed");
      render();
      return;
    }
    box.value = "";
    s.problem = null;
    s.sentNote = r.body?.notified?.sent ? fill("receipts.tl.emailed", { n: r.body.notified.sent }) : null;
    await load();
  }

  async function add(who) {
    const r = await send(`${base}/collaborators`, "POST", who);
    if (!r.ok) {
      s.problem = refused(r.body, "receipts.tl.addfailed");
      render();
      return;
    }
    s.problem = null;
    s.addOpen = false;
    s.results = null;
    search.value = "";
    s.sentNote = r.body?.notified?.sent ? fill("receipts.tl.emailed", { n: r.body.notified.sent }) : null;
    await load();
  }

  async function remove(c) {
    const r = await send(`${base}/collaborators/${encodeURIComponent(c.id)}`, "DELETE");
    if (!r.ok) {
      s.problem = refused(r.body, "receipts.tl.removefailed");
      render();
      return;
    }
    s.problem = null;
    await load();
  }

  async function find(query) {
    const mine = ++s.generation;
    if (query.trim().length < 2) {
      s.results = null;
      renderResults();
      return;
    }
    const r = await call(`${base}/people?q=${encodeURIComponent(query.trim())}`);
    if (mine !== s.generation) return;
    s.results = r.ok ? r.body : { users: [], teams: [] };
    renderResults();
  }
  search.addEventListener("input", (e) => find(e.target.value));

  function renderResults() {
    const found = s.results;
    if (!found) return results.replaceChildren();
    const rows = [
      ...(found.teams ?? []).map((team) =>
        el("button", { type: "button", class: "collabsearchresult", "data-team": team.id, onclick: () => add({ teamId: team.id }) }, [
          el("div", { text: team.name }),
          el("div", { class: "muted", text: fill("receipts.tl.teammembers", { n: team.members }) }),
        ])
      ),
      ...(found.users ?? []).map((u) =>
        el("button", { type: "button", class: "collabsearchresult", "data-user": u.id, ...(u.canSee ? { onclick: () => add({ userId: u.id }) } : { disabled: "disabled" }) }, [
          el("div", { text: u.name }),
          // Someone who could not open the receipt is shown, but not offered: they need Warehouse.Collaborate first.
          el("div", { class: "muted", text: u.canSee ? u.email : t("receipts.tl.needspermission") }),
        ])
      ),
    ];
    results.replaceChildren(rows.length ? el("div", { class: "collabsearchresults" }, rows) : el("div", { class: "muted", text: t("receipts.tl.nomatches") }));
  }

  function chip(c) {
    const label = c.kind === "team" ? fill("receipts.tl.teamchip", { name: c.name, n: c.members }) : c.name;
    return el("span", { class: "collabchip", "data-collaborator": c.id }, [
      el("span", { class: "activityavatar", text: c.kind === "team" ? "" : initials(c.name) }, c.kind === "team" ? [icon("users")] : []),
      el("span", { text: label }),
      s.canManage ? el("button", { type: "button", class: "collabchipremove", title: t("receipts.tl.remove"), "aria-label": `${t("receipts.tl.remove")} ${label}`, onclick: () => remove(c) }, [icon("close")]) : null,
    ]);
  }

  function row(item) {
    if (item.kind === "comment")
      return el("div", { class: `activitycomment${item.mine ? " mine" : ""}`, "data-kind": "comment" }, [
        el("span", { class: "activityavatar", text: initials(item.by) }),
        el("div", { class: "activitybubble" }, [
          el("div", { class: "activitywho" }, [el("span", { text: item.by ?? "—" }), el("span", { class: "activitywhen", text: when(item.at) })]),
          el("div", { class: "activitybody", text: item.body }),
        ]),
      ]);
    return el("div", { class: "activitysysline", "data-kind": item.kind }, [
      el("span", { class: "activitydot" }),
      el("span", { class: "activitymsg", text: describe(item) }),
      el("span", { class: "activitywhen", text: when(item.at) }),
    ]);
  }

  function render() {
    // Decision 0659: the count on the Timeline / Chat tab, as the invoice viewer's.
    if (countBadge) {
      countBadge.textContent = s.loading ? "" : String(s.items.length);
      countBadge.hidden = s.loading;
    }
    const addButton = s.canManage
      ? el("button", { type: "button", class: "collabaddbtn", id: "receipt-addpeople", onclick: () => {
          s.addOpen = !s.addOpen;
          render();
          if (s.addOpen) search.focus();
        } }, [icon("newperson"), el("span", { text: t("receipts.tl.addpeople") })])
      : null;
    const postButton = el("button", { type: "button", id: "receipt-chat-post", class: "activitypost", onclick: post }, [icon("post"), el("span", { text: t("receipts.tl.post") })]);
    root.replaceChildren(
      ...[
        el("div", { class: "collabbar" }, [
          el("div", { class: "collabchips" }, s.collaborators.length ? s.collaborators.map(chip) : [el("span", { class: "muted sm", text: t(s.canManage ? "receipts.tl.nobodyhint" : "receipts.tl.nobody") })]),
          addButton,
          s.addOpen ? el("div", { class: "collabsearch" }, [search, results]) : null,
        ]),
        s.problem ? el("div", { class: "warn sm", id: "receipt-timeline-problem", text: s.problem }) : null,
        s.error ? el("div", { class: "warn sm", text: s.error }) : null,
        el("div", { class: "activityfeed" }, s.loading ? [el("div", { class: "muted", text: t("receipts.tl.loading") })] : s.items.length ? s.items.map(row) : [el("div", { class: "muted", text: t("receipts.tl.empty") })]),
        el("div", { class: "activityinput" }, [box, postButton]),
        s.sentNote ? el("div", { class: "muted sm", id: "receipt-chat-sent", text: s.sentNote }) : null,
      ].filter(Boolean)
    );
  }

  render();
  load();
  return root;
}
