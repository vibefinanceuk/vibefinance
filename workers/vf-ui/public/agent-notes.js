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

function totalsLine(totals) {
  const parts = (totals ?? []).map((x) =>
    x.currency ? `${cellText(x.total, "money")} ${x.currency} (${t("agents.notes.invoices").replace("{n}", String(x.count))})` : t("agents.notes.items").replace("{n}", String(x.count))
  );
  return parts.join(" · ");
}

/** The report a note carries, as a table. */
export function reportTable(table) {
  const numeric = new Set(["money", "count", "days", "percent"]);
  return el("div", { class: "agentreport" }, [
    ...(table.skippedOrgs?.length ? [el("p", { class: "muted sm", text: t("agents.notes.skipped").replace("{orgs}", table.skippedOrgs.join(", ")) })] : []),
    el("div", { class: "agentreportwrap" }, [
      el("table", { class: "agentreporttable" }, [
        el("thead", {}, [el("tr", {}, table.columns.map((c) => el("th", { class: numeric.has(c.kind) ? "num" : "", text: t(c.label) })))]),
        el(
          "tbody",
          {},
          table.rows.map((row) =>
            el(
              "tr",
              {},
              table.columns.map((c) => {
                const raw = row[c.key];
                const value = c.key === "person" && (raw === null || raw === undefined) ? t("agents.notes.unclaimed") : cellText(raw, c.kind);
                return el("td", { class: numeric.has(c.kind) ? "num" : "", text: value });
              })
            )
          )
        ),
      ]),
    ]),
    ...(table.totals?.length ? [el("p", { class: "muted sm", text: `${t("agents.notes.total")} ${totalsLine(table.totals)}` })] : []),
  ]);
}

/** Fills the Tasks screen's place for notes; hidden while there are none. */
export async function fill(holder) {
  if (!holder) return;
  const r = await call("/api/agent-notes");
  const notes = r.ok ? r.body?.notes ?? [] : [];
  if (notes.length === 0) {
    holder.hidden = true;
    holder.replaceChildren();
    return;
  }
  holder.hidden = false;
  const opened = new Map();

  const rowOf = (note) => {
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
              detail.replaceChildren(body ? reportTable(body.table) : el("p", { class: "muted sm", text: t("agents.failed") }));
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
    el("div", { class: "panel agentnotes" }, [
      el("h3", { text: t("agents.notes.heading") }),
      el("p", { class: "muted sm", text: t("agents.notes.sub") }),
      ...notes.map(rowOf),
    ])
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
