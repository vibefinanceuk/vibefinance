import { t, currentLocale } from "/strings.js";
import { icon } from "/icons.js";

/**
 * In-app Help — decision 0518.
 *
 * The operator's own request: a Help button between Language and Sign
 * out that *"would default to the page that the user is in and be stage
 * aware. So someone asking for help as an approver would be able to see
 * actions available to them, and be able to understand why they see a
 * complete, or route to approver button."*
 *
 * **A side panel, not a pop-out** (the operator's choice), so the
 * document and its buttons stay visible while reading.
 *
 * **Three layers, top to bottom:**
 * 1. *About this page*: written help for the screen showing now
 *    (`help.screen.<screen>`).
 * 2. *At this stage* (only with a task open): each of the person's own
 *    actions, the task's `actions` exactly as the server offered them,
 *    with written help (`help.action.<action>`) and the live reasons
 *    `GET /help/tasks/:id` gives for why it is there
 *    (`help.reason.<code>`, `{placeholders}` filled from the reason's
 *    own params).
 * 3. *Ask a question*: an AI answer grounded in the text above and the
 *    same live facts (`POST /help/ask`).
 *
 * Builds its own nodes rather than importing `el` from `tasks.js`,
 * which imports this module: no circular import to reason about.
 */

let panel = null;

function node(tag, props = {}, children = []) {
  const n = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null) continue;
    if (key === "class") n.className = value;
    else if (key === "text") n.textContent = value;
    else if (key.startsWith("on")) n.addEventListener(key.slice(2), value);
    else n.setAttribute(key, value);
  }
  for (const child of children) if (child) n.append(child);
  return n;
}

/** `{name}` placeholders, filled from a reason's params. */
export function fill(template, params = {}) {
  return template.replace(/\{(\w+)\}/g, (_, name) => {
    const value = params[name];
    if (value === null || value === undefined) return "—";
    return typeof value === "number" ? value.toLocaleString() : String(value);
  });
}

/** Opens Help, or closes it if it is already open. */
export function toggleHelp(context) {
  if (panel) {
    closeHelp();
    return;
  }
  openHelp(context);
}

export function closeHelp() {
  panel?.remove();
  panel = null;
  document.removeEventListener("keydown", onKey);
}

function onKey(event) {
  if (event.key === "Escape") closeHelp();
}

export async function openHelp({ screen, task } = {}) {
  closeHelp();
  const body = node("div", { class: "helpbody" });
  panel = node("aside", { class: "helppanel", role: "complementary", "aria-label": t("help.title") }, [
    node("div", { class: "cardhead" }, [
      node("h3", { text: t("help.title") }),
      node("button", { class: "rm", title: t("action.close"), onclick: closeHelp }, [icon("close")]),
    ]),
    body,
  ]);
  document.body.append(panel);
  document.addEventListener("keydown", onKey);

  const sections = [];
  sections.push(
    node("section", { class: "helpsection" }, [
      node("h4", { text: t("help.aboutpage") }),
      node("p", { class: "sm", text: t(`help.screen.${task ? "viewer" : screen}`) }),
    ])
  );

  if (task) {
    sections.push(await stageSection(task));
  }
  sections.push(askSection(screen, task, body));
  body.replaceChildren(...sections);
}

async function stageSection(task) {
  let context = null;
  try {
    const response = await fetch(`/api/help/tasks/${encodeURIComponent(task.id)}`);
    if (response.ok) context = await response.json();
  } catch {
    // Written help still shows; only the live reasons are missing.
  }
  const reasons = context?.reasons ?? [];
  const reasonLines = (action) =>
    reasons
      .filter((r) => r.action === action)
      .map((r) => node("p", { class: "sm helpwhy", text: fill(t(`help.reason.${r.code}`), r.params) }));

  const actions = task.actions ?? [];
  const items = actions.map((action) =>
    node("li", { class: "helpaction", "data-action": action }, [
      node("div", { class: "helpactiontitle" }, [icon(action), node("span", { text: t(`action.${action}`) })]),
      node("p", { class: "sm", text: t(`help.action.${action}`) }),
      ...reasonLines(action),
    ])
  );

  return node("section", { class: "helpsection" }, [
    node("h4", { text: fill(t("help.atstage"), { stage: context?.stage?.name ?? task.stageName ?? "" }) }),
    ...reasons.filter((r) => r.action === null).map((r) => node("p", { class: "sm helpwhy", text: fill(t(`help.reason.${r.code}`), r.params) })),
    items.length > 0
      ? node("ul", { class: "helpactions" }, items)
      : node("p", { class: "sm muted", text: t("help.noactions") }),
    ...reasons
      .filter((r) => r.action !== null && !actions.includes(r.action))
      .map((r) => node("p", { class: "sm helpwhy", text: fill(t(`help.reason.${r.code}`), r.params) })),
  ]);
}

function askSection(screen, task, body) {
  const question = node("textarea", { placeholder: t("help.ask.placeholder"), maxlength: "500" });
  const answer = node("p", { class: "sm helpanswer", hidden: "hidden" });
  const ask = async () => {
    const text = question.value.trim();
    if (!text) return;
    answer.hidden = false;
    answer.textContent = t("help.ask.thinking");
    try {
      const response = await fetch("/api/help/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: text,
          screen: task ? "viewer" : screen,
          taskId: task?.id,
          // What the panel is showing, minus this section — the model
          // answers from what the person is already reading.
          helpText: [...body.querySelectorAll(".helpsection:not(.helpask) :is(h4, p, .helpactiontitle)")]
            .map((n) => n.textContent)
            .join("\n"),
          locale: currentLocale(),
        }),
      });
      const result = await response.json().catch(() => ({}));
      answer.textContent = response.ok && result.answer ? result.answer : t("help.ask.failed");
    } catch {
      answer.textContent = t("help.ask.failed");
    }
  };
  return node("section", { class: "helpsection helpask" }, [
    node("h4", { text: t("help.ask.heading") }),
    question,
    node("button", { class: "actionlink primary", onclick: ask }, [icon("help"), node("span", { text: t("help.ask.button") })]),
    answer,
    node("p", { class: "sm muted", text: t("help.ask.disclaimer") }),
  ]);
}
