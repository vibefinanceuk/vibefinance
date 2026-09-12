import { t } from "/strings.js";
import { el, frame, topbar, setCurrentScreen } from "/tasks.js";
import { icon } from "/icons.js";
import { processRow } from "/process-row.js";

/**
 * What rules exist, and where they run — decision 0149.
 *
 * **The screen somebody arrives at.** Most visits are to see what is
 * running rather than to write something new: nobody asks *"what rules
 * exist"*, they ask *"why did this invoice get held"*, and the answer
 * is found at the stage it was held at.
 *
 * So the **stage organises the page**. The process is shown as a
 * sequence, because a rule fires at a stage and what it can test
 * depends on what has already happened to the document by then — an
 * invoice at Received has not been keyed, so a rule there testing the
 * total is silently dead.
 */

let stages = [];
let rules = [];
let chosen = null;

async function load() {
  const [stagesResponse, rulesResponse] = await Promise.all([
    fetch("/api/rules/stages"),
    fetch(`/api/rules${chosen ? `?stage=${encodeURIComponent(chosen)}` : ""}`),
  ]);

  if (!stagesResponse.ok || !rulesResponse.ok) return false;

  stages = (await stagesResponse.json()).stages ?? [];
  rules = (await rulesResponse.json()).rules ?? [];

  // The first stage that actually carries rules, so somebody arriving
  // lands somewhere with something on it rather than on an empty one.
  if (!chosen && stages.length > 0) {
    chosen = (stages.find((s) => s.ruleCount > 0) ?? stages[0]).id;
    return load();
  }

  return true;
}

function note(message) {
  const box = document.getElementById("rules-note");
  if (box) box.textContent = message;
}

async function openRule(ruleId) {
  const stage = stages.find((s) => s.id === chosen);
  const { openRule: go } = await import("/rule.js");
  await go(ruleId, stage);
}

async function compose(stage) {
  let ruleSetId = stage.ruleSetId;

  // **Created on the way in**, not on every stage up front: a stage
  // with no rules needs no rule set, and seeding one everywhere leaves
  // empty sets nothing references (decision 0154).
  if (!ruleSetId) {
    const response = await fetch(
      `/api/rules/stages/${encodeURIComponent(stage.id)}/rule-set`,
      { method: "POST" }
    );
    if (!response.ok) {
      note(t("rules.failed"));
      return;
    }
    ruleSetId = (await response.json()).ruleSetId;
  }

  const { openCompose } = await import("/compose.js");
  await openCompose({ ...stage, ruleSetId });
}

function ruleRow(rule) {
  // **A card each** — decision 0154. A list of sentences separated by a
  // hairline reads as prose; somebody scanning for one rule among ten
  // needs them to be objects.
  return el("div", { class: "rule" }, [
    el("div", { class: "what" }, [
      // **The sentence is the way in** — decision 0155. A rule row
      // names a rule, and opening one is the first thing anybody wants
      // to do with it; a separate "open" button would put navigation
      // where the rule itself is.
      // **Named where it has a name, decision 0266** — a list of ten
      // rules reads as ten sentences otherwise, and a name is what a
      // person actually scans for. The sentence stays underneath,
      // muted, for the rule nobody has named yet and for whoever wants
      // to confirm what a named one actually does.
      el("button", {
        class: "rulelink",
        text: rule.name ?? rule.sourceText ?? "",
        onclick: () => openRule(rule.id),
      }),
      ...(rule.name ? [el("div", { class: "sm muted", text: rule.sourceText ?? "" })] : []),
    ]),
    el("div", { class: `rulestate ${rule.state}` }, [
      // Live and paused carry a mark; a draft does not, because
      // "nothing is happening" needs no symbol.
      ...(rule.state === "live" || rule.state === "paused"
        ? [icon(rule.state === "live" ? "complete" : "paused")]
        : []),
      el("span", {
        text:
          rule.state === "awaiting_confirmation" && rule.awaiting
            ? `${rule.awaiting} ${t("rulestate.awaiting_confirmation").toLowerCase()}`
            : t(`rulestate.${rule.state}`),
      }),
    ]),
  ]);
}

function render() {
  const shell = document.getElementById("shell");
  if (!shell) return;

  const stage = stages.find((s) => s.id === chosen);

  shell.replaceChildren(
    frame(
      el("div", {}, [
        topbar(t("nav.rules"), t("rules.subtitle")),
        el("div", { class: "panel" }, [
          processRow(
            // The line beneath each chevron, built here rather than at
            // load: `t()` needs the strings, and a detail computed
            // before they arrive is a detail built from nothing.
            stages.map((stage) => ({
              ...stage,
              detail:
                stage.ruleCount > 0 ? String(stage.ruleCount) : t("rules.norules"),
            })),
            chosen,
            (id) => {
              chosen = id;
              open();
            }
          ),
        ]),
        el("div", { class: "panel" }, [
          el("h3", { text: stage ? stage.name : t("rules.atstage") }),
          el("p", { class: "sm muted", text: t("rules.order") }),
          rules.length > 0
            ? el("div", { class: "rules" }, rules.map(ruleRow))
            : el("p", { class: "muted", text: t("rules.empty") }),
          /**
           * **At every stage** — decision 0154.
           *
           * This appeared only where a stage already had a rule set,
           * which meant rules could be added only where rules already
           * existed. A stage that had never had one never could.
           *
           * Writing the first rule at a stage now creates the rule set,
           * so the button belongs everywhere a rule could run.
           */
          el("div", { class: "newrule" }, [
            el("button", { class: "primary", onclick: () => compose(stage) }, [
              icon("compile"),
              el("span", { text: t("rules.new") }),
            ]),
          ]),
        ]),
        el("div", { class: "problem", id: "rules-note", role: "status" }),
      ])
    )
  );
}

export async function open() {
  setCurrentScreen("rules");
  if (!(await load())) {
    note(t("rules.failed"));
    return;
  }
  render();
}
