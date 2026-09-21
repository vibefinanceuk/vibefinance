import { t } from "/strings.js";
import { el } from "/tasks.js";
import { currentOrgId } from "/orgs.js";

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

/** The bounded, recent slice of `history` sent alongside a new question — see this file's own top comment. */
function recentTurnsToSend() {
  const cutoff = Date.now() - RECENT_TURNS_WINDOW_MS;
  return history
    .filter((turn) => !turn.pending && turn.askedAt >= cutoff)
    .slice(-MAX_RECENT_TURNS)
    .map((turn) => ({ question: turn.question, answer: turn.answer }));
}

function bubble(role, text) {
  return el("div", { class: `chatbubble chatbubble-${role}` }, [el("div", { text })]);
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
        ]))
  );
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

async function send() {
  const question = inputEl?.value.trim();
  if (!question || sending) return;

  sending = true;
  inputEl.value = "";
  inputEl.disabled = true;
  if (sendButtonEl) sendButtonEl.disabled = true;

  // Computed before the new turn is added, so a question never sends
  // itself back as its own "recent" context.
  const recentTurns = recentTurnsToSend();

  const turn = { question, answer: "", pending: true, askedAt: Date.now() };
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
    }
  } catch {
    turn.answer = t("apassistant.error");
  } finally {
    turn.pending = false;
    sending = false;
    inputEl.disabled = false;
    if (sendButtonEl) sendButtonEl.disabled = false;
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

  renderMessages();

  return el("div", { class: "panel card-graphic" }, [
    el("div", { class: "cardhead" }, [el("h3", { text: t("apassistant.heading") })]),
    el("div", { class: "sub", text: t("apassistant.sub") }),
    messagesEl,
    el("div", { class: "chatinputrow" }, [inputEl, sendButtonEl]),
  ]);
}
