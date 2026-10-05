import { t } from "/strings.js";
import { el } from "/tasks.js";
import { actionLink } from "/viewer.js";

/**
 * **From agents — decision 0622.** What a person's agents delivered,
 * shown at the top of their Tasks screen and nowhere when there is
 * nothing. Each note is a report, not a task: it belongs to no stage and
 * counts in no workload. **Open** shows its table in place; **Done**
 * takes it off the list.
 */

async function call(path, init) {
  try {
    const response = await fetch(path, init);
    return { ok: response.ok, status: response.status, body: await response.json().catch(() => null) };
  } catch {
    return { ok: false, status: 0, body: null };
  }
}

function stamp(iso) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** One cell's value as its column says: money, a count, a date, days or a percentage. */
export function cellText(value, kind) {
  if (value === null || value === undefined || value === "") return "—";
  if (kind === "money") return Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (kind === "count" || kind === "days") return String(value);
  if (kind === "percent") return `${Math.round(Number(value) * 100)}%`;
  return String(value);
}

/** Decision 0624: "up 50.00 since the last report", against what this person was last sent. */
export function compareText(x, previous) {
  if (!previous) return "";
  const before = previous.find((p) => (p.currency ?? null) === (x.currency ?? null));
  const now = x.currency ? Number(x.total ?? 0) : x.count;
  const then = before ? (x.currency ? Number(before.total ?? 0) : before.count) : 0;
  const diff = Math.round((now - then) * 100) / 100;
  if (diff === 0) return t("agents.notes.same");
  const n = x.currency ? cellText(Math.abs(diff), "money") : String(Math.abs(diff));
  return t(diff > 0 ? "agents.notes.up" : "agents.notes.down").replace("{n}", n);
}

function totalsLine(totals, previous) {
  const parts = (totals ?? []).map((x) => {
    const base = x.currency ? `${cellText(x.total, "money")} ${x.currency} (${t("agents.notes.invoices").replace("{n}", String(x.count))})` : t("agents.notes.items").replace("{n}", String(x.count));
    const change = compareText(x, previous);
    return change ? `${base}, ${change}` : base;
  });
  return parts.join(" · ");
}

/** The report a note carries, as a table. */
/** Decision 0629: whether a row names the invoices behind it. */
function rowHasInvoices(row) {
  return Boolean((typeof row._ids === "string" && row._ids) || row.invoiceId);
}

/** What a row is about, for the Documents banner: its supplier, invoice, stage or person. */
function rowLabel(row) {
  return [row.org, row.supplier ?? row.invoice ?? row.stage, row.person].filter(Boolean).join(" · ");
}

export function reportTable(table, opts = {}) {
  // Decision 0629: rows with invoices open Documents at them; all of them from the link above.
  const openable = Boolean(opts.openRow) && table.rows.some(rowHasInvoices);
  const numeric = new Set(["money", "count", "days", "percent"]);
  return el("div", { class: "agentreport" }, [
    // Decision 0626: the AI summary, marked as the AI's, checked against this table before it was kept.
    ...(table.summary
      ? [
          el("div", { class: "agentsummary", id: "agent-note-summary" }, [
            el("span", { class: "agentsummarytag", text: t("agents.summary.notelabel") }),
            el("p", { text: table.summary }),
          ]),
        ]
      : []),
    ...(table.skippedOrgs?.length ? [el("p", { class: "muted sm", text: t("agents.notes.skipped").replace("{orgs}", table.skippedOrgs.join(", ")) })] : []),
    // Decision 0624: what narrowed it, and what a highlight means.
    ...(table.options?.minTotal !== undefined ? [el("p", { class: "muted sm", text: t("agents.notes.mintotal").replace("{n}", cellText(table.options.minTotal, "money")) })] : []),
    ...(table.rows.some((r) => r._highlight)
      ? [
          el("p", {
            class: "muted sm",
            text: t("agents.notes.highlighted").replace(
              "{why}",
              t(`agents.notes.why.${table.report}`).replace(
                "{n}",
                String(table.report === "outstanding_payables" ? table.options?.highlightDays ?? "" : (table.options?.olderThanDays ?? 5) * 2)
              )
            ),
          }),
        ]
      : []),
    ...(openable && opts.openAll
      ? [
          el("div", { class: "agentreportopen" }, [
            actionLink("expand", { label: t("agents.notes.opendocs"), onclick: () => opts.openAll() }),
            el("span", { class: "muted sm", text: t("agents.notes.rowhint") }),
          ]),
        ]
      : []),
    el("div", { class: "agentreportwrap" }, [
      el("table", { class: "agentreporttable" }, [
        el("thead", {}, [el("tr", {}, table.columns.map((c) => el("th", { class: numeric.has(c.kind) ? "num" : "", text: t(c.label) })))]),
        el(
          "tbody",
          {},
          table.rows.map((row, i) =>
            el(
              "tr",
              {
                ...(row._highlight || (openable && rowHasInvoices(row))
                  ? { class: [row._highlight ? "agenthighlight" : "", openable && rowHasInvoices(row) ? "clickable" : ""].filter(Boolean).join(" ") }
                  : {}),
                ...(openable && rowHasInvoices(row) ? { "data-row": String(i), onclick: () => opts.openRow(i, rowLabel(row)) } : {}),
              },
              table.columns.map((c) => {
                const raw = row[c.key];
                const value =
                  c.key === "person" && (raw === null || raw === undefined)
                    ? t("agents.notes.unclaimed")
                    : c.key === "reason" && typeof raw === "string"
                      ? t(`agents.reason.${raw}`)
                      : cellText(raw, c.kind);
                return el("td", { class: numeric.has(c.kind) ? "num" : "", text: value });
              })
            )
          )
        ),
      ]),
    ]),
    ...(table.totals?.length ? [el("p", { class: "muted sm", text: `${t("agents.notes.total")} ${totalsLine(table.totals, table.previous)}` })] : []),
  ]);
}

/** Fills the Tasks screen's place for notes; hidden while there are none. */
export async function fill(holder) {
  if (!holder) return;
  // Decision 0631: what waits for this person's approval, beside the notes.
  const [r, a] = await Promise.all([call("/api/agent-notes"), call("/api/agent-actions")]);
  const notes = r.ok ? r.body?.notes ?? [] : [];
  const actions = a.ok ? a.body?.actions ?? [] : [];
  if (notes.length === 0 && actions.length === 0) {
    holder.hidden = true;
    holder.replaceChildren();
    return;
  }
  holder.hidden = false;
  const opened = new Map();

  // Decision 0627: a failing agent, for its author: what went wrong, how often, and the way to it.
  const failureRow = (note) => {
    const f = note.failure ?? {};
    const key = `agents.runerror.${f.error}`;
    const said = t(key) === key ? f.error : t(key);
    const row = el("div", { class: "agentnote failure", "data-note": note.id, "data-agent": note.agentId }, [
      el("div", { class: "agentnotehead" }, [
        el("div", {}, [
          el("span", { class: "agentnotename", text: note.agentName }),
          el("span", { class: "rmpill bad agentnotetag", text: t("agents.notes.failedtag") }),
          el("div", { class: "agentnotewhy", text: `${t(f.partial ? "agents.notes.failure.partial" : "agents.notes.failure.failed")}: ${said}` }),
          el("div", {
            class: "muted sm",
            text: (f.times ?? 1) > 1 ? t("agents.notes.failure.times").replace("{n}", String(f.times)).replace("{since}", stamp(f.firstAt)) : stamp(f.lastAt ?? note.createdAt),
          }),
        ]),
        el("div", { class: "dobuttons" }, [
          actionLink("expand", {
            label: t("agents.notes.openagent"),
            onclick: async () => {
              const { openAgentById } = await import("/agents.js");
              await openAgentById(note.agentId);
            },
          }),
          actionLink("done", {
            label: t("agents.notes.done"),
            onclick: async () => {
              const done = await call(`/api/agent-notes/${encodeURIComponent(note.id)}/done`, { method: "POST" });
              if (done.ok) {
                row.remove();
                if (!holder.querySelector(".agentnote")) holder.hidden = true;
              }
            },
          }),
        ]),
      ]),
    ]);
    return row;
  };

  const rowOf = (note) => {
    if (note.kind === "failure") return failureRow(note);
    const detail = el("div", { class: "agentnotedetail" });
    detail.hidden = true;
    const row = el("div", { class: "agentnote", "data-note": note.id, "data-agent": note.agentId }, [
      el("div", { class: "agentnotehead" }, [
        el("div", {}, [
          el("span", { class: "agentnotename", text: note.agentName }),
          el("span", { class: "rmpill q agentnotetag", text: t("agents.notes.tag") }),
          el("div", {
            class: "muted sm",
            text: [stamp(note.createdAt), t("agents.rows").replace("{n}", String(note.rowCount ?? 0)), note.late ? t("agents.late") : ""].filter(Boolean).join(" · "),
          }),
        ]),
        el("div", { class: "dobuttons" }, [
          actionLink("expand", {
            label: t("agents.notes.open"),
            onclick: async () => {
              if (!detail.hidden) {
                detail.hidden = true;
                return;
              }
              if (!opened.has(note.id)) {
                const one = await call(`/api/agent-notes/${encodeURIComponent(note.id)}`);
                opened.set(note.id, one.ok ? one.body : null);
              }
              const body = opened.get(note.id);
              const toDocuments = async (args) => {
                const { openDocumentsFromAgent } = await import("/documents.js");
                await openDocumentsFromAgent({ note: note.id, name: note.agentName, ...args });
              };
              detail.replaceChildren(
                body
                  ? reportTable(body.table, {
                      openAll: () => toDocuments({}),
                      openRow: (row, label) => toDocuments({ row, label }),
                    })
                  : el("p", { class: "muted sm", text: t("agents.failed") })
              );
              detail.hidden = false;
            },
          }),
          // Decision 0623: anyone but its author may stop receiving it.
          ...(note.canStop
            ? [
                actionLink("discard", {
                  label: t("agents.notes.stop"),
                  onclick: async () => {
                    const r = await call(`/api/agents/${encodeURIComponent(note.agentId)}/stop`, { method: "POST" });
                    if (r.ok) {
                      holder.querySelectorAll(`.agentnote[data-agent="${note.agentId}"] .actionlink[title="${t("agents.notes.stop")}"]`).forEach((b) => b.remove());
                      row.querySelector(".agentnotehead .muted")?.append(` · ${t("agents.notes.stopped")}`);
                    }
                  },
                }),
              ]
            : []),
          actionLink("done", {
            label: t("agents.notes.done"),
            onclick: async () => {
              const done = await call(`/api/agent-notes/${encodeURIComponent(note.id)}/done`, { method: "POST" });
              if (done.ok) {
                row.remove();
                if (!holder.querySelector(".agentnote")) holder.hidden = true;
              }
            },
          }),
        ]),
      ]),
      detail,
    ]);
    return row;
  };

  holder.replaceChildren(
    ...(actions.length ? [approvalsPanel(actions, holder)] : []),
    ...(notes.length
      ? [
          el("div", { class: "panel agentnotes" }, [
            el("h3", { text: t("agents.notes.heading") }),
            el("p", { class: "muted sm", text: t("agents.notes.sub") }),
            ...notes.map(rowOf),
          ]),
        ]
      : [])
  );
}

/**
 * **The link in an email — decision 0623.** `?stopagent=<id>` stops that
 * agent for whoever is signed in, says so, and leaves the address clean.
 */
export async function stopFromLink(shell) {
  const params = new URLSearchParams(location.search);
  const id = params.get("stopagent");
  if (!id) return;
  params.delete("stopagent");
  const rest = params.toString();
  history.replaceState(null, "", `${location.pathname}${rest ? `?${rest}` : ""}${location.hash}`);
  const r = await call(`/api/agents/${encodeURIComponent(id)}/stop`, { method: "POST" });
  const text = r.ok ? t("agents.notes.stoppedlink").replace("{name}", r.body?.name ?? "") : t(r.body?.reason === "author_cannot_stop" ? "agents.error.author_cannot_stop" : "agents.notes.stopfailed");
  const notice = el("div", { class: "panel agentstopnotice", id: "agent-stop-notice", role: "status", text });
  shell?.prepend(notice);
}

/**
 * **For your approval — decision 0631.** What agents prepared and this
 * person may approve: what will happen, a note to add, Approve or
 * Reject. Nothing is done until they approve, and it is checked again
 * then.
 */
function approvalsPanel(actions, holder) {
  const cardOf = (a) => {
    const p = a.payload ?? {};
    const note = el("textarea", { id: `action-note-${a.id}`, class: "input", rows: "2", placeholder: t("agents.actions.noteplaceholder") });
    const said = el("p", { class: "sm agentactionresult", hidden: "hidden" });
    const decide = async (decision) => {
      const r = await call(`/api/agent-actions/${encodeURIComponent(a.id)}/${decision}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(decision === "approve" ? { note: note.value } : { reason: note.value }),
      });
      const key = r.ok
        ? decision === "reject"
          ? "agents.actions.rejected"
          : r.body?.emailed
            ? "agents.actions.done"
            : "agents.actions.donenoemail"
        : `agents.actionreason.${r.body?.reason ?? "failed"}`;
      said.textContent = t(key) === key ? (r.body?.error ?? t("agents.failed")) : t(key).replace("{holder}", p.holderName ?? "");
      said.hidden = false;
      card.querySelectorAll(".dobuttons, textarea").forEach((n) => n.remove());
    };
    const card = el("div", { class: "agentnote agentaction", "data-action": a.id }, [
      el("div", { class: "agentnotehead" }, [
        el("div", {}, [
          el("span", {
            class: "agentnotename",
            text: t(`agents.actions.${a.kind}.title`).replace("{holder}", p.holderName ?? "").replace("{invoice}", p.invoiceNumber ?? "—"),
          }),
          el("span", { class: "rmpill q agentnotetag", text: t("agents.actions.tag") }),
          el("div", {
            class: "muted sm",
            text: t(`agents.actions.${a.kind}.detail`)
              .replace("{supplier}", p.supplier ?? "—")
              .replace("{stage}", p.stage ?? "")
              .replace("{days}", String(p.days ?? "")),
          }),
          el("div", {
            class: "muted sm",
            text: t("agents.actions.from").replace("{agent}", a.agentName).replace("{author}", a.authorName).replace("{when}", stamp(a.expiresAt)),
          }),
        ]),
        el("div", { class: "dobuttons" }, [
          actionLink("discard", { label: t("agents.actions.reject"), onclick: () => decide("reject") }),
          actionLink("done", { label: t("agents.actions.approve"), primary: true, onclick: () => decide("approve") }),
        ]),
      ]),
      note,
      said,
    ]);
    return card;
  };
  return el("div", { class: "panel agentnotes", id: "agent-approvals" }, [
    el("h3", { text: t("agents.actions.heading") }),
    el("p", { class: "muted sm", text: t("agents.actions.sub") }),
    ...actions.map(cardOf),
  ]);
}
