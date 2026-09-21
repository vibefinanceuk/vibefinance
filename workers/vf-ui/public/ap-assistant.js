import { t } from "/strings.js";
import { el } from "/tasks.js";
import { currentOrgId } from "/orgs.js";
import { POPOUT_NAME } from "/viewer.js";

/**
 * Talk to an AP Expert — decision 0430, Screen 6 of the Management
 * Dashboard design, the last of its six tabs to gain real content.
 *
 * **No `load()`/`renderCard()` pair**, unlike every other tab on this
 * screen — there is no report to fetch ahead of render. This module
 * exports one function, `renderPanel()`, that builds a small,
 * self-contained chat: a question typed here becomes one POST to
 * `POST /api/ap-assistant/ask`, gated server-side on `AP.Assistant`
 * (checked again, per-tool, by `workers/vf-app/src/ap-assistant.ts` —
 * this module trusts nothing about what a question can or cannot
 * answer; the server decides that).
 *
 * **Ephemeral, the operator's own explicit choice.** History lives in
 * a module-level array, in memory only — nothing persisted server-side.
 * Switching tabs and back keeps it (the array survives); reloading the
 * page does not.
 *
 * **A bounded recent slice is sent, decision 0430's third addendum.**
 * Live testing found that a follow-up like "both" or "the second one"
 * always failed — the server had never seen anything but the single
 * question being asked, so a reply to its own clarifying question was
 * unusable. This array was already being kept for display; now the
 * last `MAX_RECENT_TURNS` completed turns from the last
 * `RECENT_TURNS_WINDOW_MS` also go out with each new question, so the
 * server can resolve what a short follow-up refers back to. Still
 * nothing persisted anywhere, still gone on reload — only the *destination*
 * of this same in-memory array changed, not its lifetime.
 *
 * **A document link renders as a real, clickable link — decision
 * 0430's sixth addendum.** Before this, `bubble()` put every answer
 * through `el()`'s own `text` prop, `textContent` only, on purpose —
 * so a raw URL the server's own answer text happened to include showed
 * up as inert, unclickable characters, which is exactly what a live
 * test complained about. `renderAnswerText()` below is not a markdown
 * renderer and does not add one: it looks for exactly one pattern,
 * `[label](url)` — the only markup `ap-assistant.ts`'s own answer
 * prompt is ever told to produce — and for that pattern alone builds a
 * real `<a>` node with `el()`, the same safe, `textContent`-only DOM
 * construction every other node on this page already uses. Everything
 * else in the answer, including a supplier name or an invoice number
 * that happens to sit right next to a link, still only ever becomes a
 * plain text node — never parsed, never treated as markup.
 *
 * **A downloadable report, on explicit ask only — decision 0430's
 * seventh addendum.** The live-test complaint wasn't only that a link
 * didn't click — it was also "when asked for a report, provide
 * something I can download." `handleAskApAssistant` already builds
 * `table` (real rows behind an answer, from a tool's own result, never
 * LLM-authored) whenever the tool run was `invoice_search`; this file
 * stores it on the turn and, only when that turn's own question also
 * reads like a download ask (`DOWNLOAD_INTENT` below), renders
 * "Download CSV" / "Download PDF" under the answer bubble. Both read
 * from the same `turn.table` the answer text was generated from, so a
 * download can never show a number the chat bubble above it didn't.
 * CSV is a client-built, properly escaped Blob download — the same
 * `URL.createObjectURL` pattern `purchase-orders.js` already uses. PDF
 * has no precedent in this codebase and no bundler to pull one in
 * (`public/*.js` are raw ES modules, decision — see this repo's own
 * build docs), so `downloadTableAsPdf()` opens a blank window, builds
 * a plain `<table>` in it with the same `textContent`-only discipline
 * as everywhere else, and calls `win.print()` — the browser's own
 * "print to PDF" is the export, not a generated file.
 *
 * **A "Clear" button, next to "Ask"** — asked for directly, live —
 * resets `history` to empty and re-renders. Nothing server-side to
 * undo: this screen has never persisted history anywhere (this file's
 * own top comment, above), so "clear" is just "forget," instantly.
 */

// The operator's own choice, revised after checking the real cost:
// at Workers AI's exact per-token pricing for the model this app
// already calls, even 50 turns is a small fraction of a cent per
// question — negligible, on a screen with no users yet, being
// limited to AP Managers and C-Suite. The server (`ap-assistant.ts`'s
// own `sanitizeRecentTurns`) re-caps independently regardless of what
// this sends, so the two do not need to be changed together.
const MAX_RECENT_TURNS = 50;
const RECENT_TURNS_WINDOW_MS = 15 * 60 * 1000;

let history = [];
let sending = false;
let messagesEl = null;
let inputEl = null;
let sendButtonEl = null;
let clearButtonEl = null;

/** The bounded, recent slice of `history` sent alongside a new question — see this file's own top comment. */
function recentTurnsToSend() {
  const cutoff = Date.now() - RECENT_TURNS_WINDOW_MS;
  return history
    .filter((turn) => !turn.pending && turn.askedAt >= cutoff)
    .slice(-MAX_RECENT_TURNS)
    .map((turn) => ({ question: turn.question, answer: turn.answer }));
}

/** Matches exactly "[label](url)" — the one, deliberately narrow markup this chat's own answer prompt is ever told to produce. See this file's own top comment. */
const MARKDOWN_LINK = /\[([^\]]+)\]\((\S+)\)/g;

/**
 * Builds the answer bubble's own children: real text nodes for
 * everything that isn't a `[label](url)` link, and a real, safe `<a>`
 * node (built with `el()`, never innerHTML) for each one that is.
 * `target`/`rel` here, not on the container, since only the link
 * itself should ever navigate anywhere.
 */
function answerNodes(text) {
  const nodes = [];
  let lastIndex = 0;
  for (const match of text.matchAll(MARKDOWN_LINK)) {
    if (match.index > lastIndex) nodes.push(document.createTextNode(text.slice(lastIndex, match.index)));
    const [whole, label, url] = match;
    // A relative, in-app path only (`document-window.html?task=...`,
    // decision 0384) — never an absolute URL to somewhere else, since
    // nothing this chat's own tools ever return points off this app.
    if (url.startsWith("/")) {
      nodes.push(el("a", { href: url, target: POPOUT_NAME, rel: "noopener", text: label }));
    } else {
      nodes.push(document.createTextNode(whole));
    }
    lastIndex = match.index + whole.length;
  }
  if (lastIndex < text.length) nodes.push(document.createTextNode(text.slice(lastIndex)));
  return nodes;
}

function bubble(role, text) {
  const inner = el("div", {});
  inner.append(...(role === "answer" ? answerNodes(text) : [document.createTextNode(text)]));
  return el("div", { class: `chatbubble chatbubble-${role}` }, [inner]);
}

/**
 * A loose, deliberately generous match — "download", "export", the
 * format names themselves, or "as a file"/"spreadsheet" — for whether
 * *this* question was itself a download ask. Checked against the
 * question that produced a turn's `table`, not every turn with a
 * table: a plain "list the invoices" answer gets no buttons unless the
 * user actually asked to download it. See this file's own top comment.
 */
const DOWNLOAD_INTENT = /\b(download|export|csv|pdf|spreadsheet|as a file)\b/i;

/** One CSV cell, quoted and escaped only when it needs to be. */
function csvCell(value) {
  const s = value === null || value === undefined ? "" : String(value);
  return /["\n,]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Builds and immediately clicks a hidden download link — `purchase-orders.js`'s own established Blob pattern. */
function downloadTableAsCsv(table) {
  const lines = [table.columns, ...table.rows].map((row) => row.map(csvCell).join(","));
  const blob = new Blob([lines.join("\n") + "\n"], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const anchor = el("a", { href: url, download: "ap-assistant-report.csv" });
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/**
 * No PDF library ships here and none can be `import`ed at runtime (no
 * bundler in this workspace — see this file's own top comment), so the
 * "download" is the browser's own print-to-PDF: a plain window, a
 * plain `<table>` built the same `textContent`-only way as every other
 * node on this page, then `win.print()`.
 */
function downloadTableAsPdf(table) {
  const win = window.open("", "_blank", "width=900,height=700");
  if (!win) {
    window.alert(t("apassistant.popupblocked"));
    return;
  }
  win.document.title = t("apassistant.heading");

  const style = win.document.createElement("style");
  style.textContent =
    "body { font-family: sans-serif; padding: 24px; } " +
    "table { border-collapse: collapse; width: 100%; } " +
    "th, td { border: 1px solid #ccc; padding: 6px 10px; text-align: left; font-size: 13px; } " +
    "th { background: #f2f2f2; }";
  win.document.head.append(style);

  const headRow = win.document.createElement("tr");
  for (const column of table.columns) {
    const th = win.document.createElement("th");
    th.textContent = column;
    headRow.append(th);
  }
  const thead = win.document.createElement("thead");
  thead.append(headRow);

  const tbody = win.document.createElement("tbody");
  for (const row of table.rows) {
    const tr = win.document.createElement("tr");
    for (const cell of row) {
      const td = win.document.createElement("td");
      td.textContent = cell === null || cell === undefined ? "—" : String(cell);
      tr.append(td);
    }
    tbody.append(tr);
  }

  const tableEl = win.document.createElement("table");
  tableEl.append(thead, tbody);
  win.document.body.append(tableEl);

  win.focus();
  win.print();
}

/** The download buttons under a completed answer bubble, when the question that produced it was itself a download ask. */
function downloadActions(turn) {
  if (!turn.table || !DOWNLOAD_INTENT.test(turn.question)) return [];
  return [
    el("div", { class: "chatactions" }, [
      el("button", { class: "secondary", text: t("apassistant.downloadcsv"), onclick: () => downloadTableAsCsv(turn.table) }),
      el("button", { class: "secondary", text: t("apassistant.downloadpdf"), onclick: () => downloadTableAsPdf(turn.table) }),
    ]),
  ];
}

function renderMessages() {
  if (!messagesEl) return;
  messagesEl.replaceChildren(
    ...(history.length === 0
      ? [el("div", { class: "muted", text: t("apassistant.empty") })]
      : history.flatMap((turn) => [
          bubble("question", turn.question),
          turn.pending
            ? el("div", { class: "chatbubble chatbubble-answer muted", text: t("apassistant.thinking") })
            : bubble("answer", turn.answer),
          ...(turn.pending ? [] : downloadActions(turn)),
        ]))
  );
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function clear() {
  history = [];
  renderMessages();
}

async function send() {
  const question = inputEl?.value.trim();
  if (!question || sending) return;

  sending = true;
  inputEl.value = "";
  inputEl.disabled = true;
  if (sendButtonEl) sendButtonEl.disabled = true;
  if (clearButtonEl) clearButtonEl.disabled = true;

  // Computed before the new turn is added, so a question never sends
  // itself back as its own "recent" context.
  const recentTurns = recentTurnsToSend();

  const turn = { question, answer: "", table: null, pending: true, askedAt: Date.now() };
  history = [...history, turn];
  renderMessages();

  try {
    const org = currentOrgId();
    const query = org ? `?org=${encodeURIComponent(org)}` : "";
    const response = await fetch(`/api/ap-assistant/ask${query}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, recentTurns }),
    });
    if (!response.ok) {
      turn.answer = t("apassistant.error");
    } else {
      const body = await response.json();
      turn.answer = typeof body.answer === "string" && body.answer ? body.answer : t("apassistant.error");
      turn.table = body.table ?? null;
    }
  } catch {
    turn.answer = t("apassistant.error");
  } finally {
    turn.pending = false;
    sending = false;
    inputEl.disabled = false;
    if (sendButtonEl) sendButtonEl.disabled = false;
    if (clearButtonEl) clearButtonEl.disabled = false;
    renderMessages();
    inputEl?.focus();
  }
}

export function renderPanel() {
  messagesEl = el("div", { class: "chatmessages" });
  inputEl = el("input", {
    type: "text",
    class: "chatinput",
    placeholder: t("apassistant.placeholder"),
    onkeydown: (e) => {
      if (e.key === "Enter") send();
    },
  });
  sendButtonEl = el("button", { class: "primary", text: t("apassistant.send"), onclick: send });
  clearButtonEl = el("button", { class: "secondary", text: t("apassistant.clear"), onclick: clear });

  renderMessages();

  return el("div", { class: "panel card-graphic" }, [
    el("div", { class: "cardhead" }, [el("h3", { text: t("apassistant.heading") })]),
    el("div", { class: "sub", text: t("apassistant.sub") }),
    messagesEl,
    el("div", { class: "chatinputrow" }, [inputEl, sendButtonEl, clearButtonEl]),
  ]);
}
