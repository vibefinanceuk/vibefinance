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
 *
 * **Ask has its own button and panel — decision 0519**, the operator's
 * own request: *"the Ask option is a little lost at the bottom of the
 * help side menu... create it's owns side menu, exactly the same size
 * and behaviour as the Help side menu."* The two share one panel slot,
 * so opening either closes the other. Ask's answers are still grounded
 * in exactly what Help would show for the same screen and task: it
 * builds those sections off-screen when a question is asked.
 *
 * Builds its own nodes rather than importing `el` from `tasks.js`,
 * which imports this module: no circular import to reason about.
 */

/** The one side panel open, Help or Ask, and which it is. */
let panel = null;
let panelKind = null;

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

/** Opens Help, or closes it if Help is already open. */
export function toggleHelp(context) {
  if (panel && panelKind === "help") return closeHelp();
  openHelp(context);
}

/** Opens Ask, or closes it if Ask is already open — decision 0519. */
export function toggleAsk(context) {
  if (panel && panelKind === "ask") return closeHelp();
  openAsk(context);
}

/** Closes whichever side panel is open. */
export function closeHelp() {
  panel?.remove();
  panel = null;
  panelKind = null;
  document.removeEventListener("keydown", onKey);
}

function onKey(event) {
  if (event.key === "Escape") closeHelp();
}

/** The shared frame: same size, same place, same close and Escape. */
function openPanel(kind, titleKey, body) {
  closeHelp();
  panel = node("aside", { class: `helppanel ${kind}panel`, role: "complementary", "aria-label": t(titleKey) }, [
    node("div", { class: "cardhead" }, [
      node("h3", { text: t(titleKey) }),
      node("button", { class: "rm", title: t("action.close"), onclick: closeHelp }, [icon("close")]),
    ]),
    body,
  ]);
  panelKind = kind;
  document.body.append(panel);
  document.addEventListener("keydown", onKey);
}

/** What Help shows for this screen and task, as section nodes. */
async function helpSections({ screen, task }) {
  const sections = [
    node("section", { class: "helpsection" }, [
      node("h4", { text: t("help.aboutpage") }),
      node("p", { class: "sm", text: t(`help.screen.${task ? "viewer" : screen}`) }),
    ]),
  ];
  if (task) sections.push(await stageSection(task));
  return sections;
}

export async function openHelp({ screen, task } = {}) {
  const body = node("div", { class: "helpbody" });
  openPanel("help", "help.title", body);
  const mine = panel;
  const sections = await helpSections({ screen, task });
  // Closed, or switched to Ask, while the reasons were loading.
  if (panel !== mine) return;
  body.replaceChildren(...sections);
}

/**
 * **Ask — decision 0519.** A question box and its answers, in a panel
 * of its own. Each answer stays on screen under its question, so a
 * follow-up can be read against the one before.
 */
export function openAsk({ screen, task } = {}) {
  const thread = node("div", { class: "askthread" });
  const question = node("textarea", { placeholder: t("help.ask.placeholder"), maxlength: "500" });
  const askButton = node("button", { class: "actionlink primary" }, [icon("ask"), node("span", { text: t("help.ask.button") })]);

  const ask = async () => {
    const text = question.value.trim();
    if (!text) return;
    question.value = "";
    const answer = node("p", { class: "sm helpanswer", text: t("help.ask.thinking") });
    thread.append(node("div", { class: "askturn" }, [node("p", { class: "sm askquestion", text }), answer]));
    try {
      // Grounded in what Help would show here, built off-screen.
      const sections = await helpSections({ screen, task });
      const helpText = sections
        .flatMap((section) => [...section.querySelectorAll("h4, p, .helpactiontitle")])
        .map((n) => n.textContent)
        .join("\n");
      const response = await fetch("/api/help/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: text,
          screen: task ? "viewer" : screen,
          taskId: task?.id,
          helpText,
          locale: currentLocale(),
        }),
      });
      const result = await response.json().catch(() => ({}));
      answer.textContent = response.ok && result.answer ? result.answer : t("help.ask.failed");
    } catch {
      answer.textContent = t("help.ask.failed");
    }
  };
  askButton.addEventListener("click", ask);
  question.addEventListener("keydown", (event) => {
    // Enter asks; Shift+Enter is a new line.
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      ask();
    }
  });

  openPanel(
    "ask",
    "ask.title",
    node("div", { class: "helpbody" }, [
      node("p", { class: "sm", text: t("ask.intro") }),
      thread,
      node("section", { class: "helpsection helpask" }, [question, askButton]),
      node("p", { class: "sm muted", text: t("help.ask.disclaimer") }),
    ])
  );
  question.focus();
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
