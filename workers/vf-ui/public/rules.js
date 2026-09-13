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

/**
 * A row in the rules table — decision 0310, reported live: "update
 * the Rules table, so that the look and feel is the same as other
 * tables in the solution... Documents, and Tasks pages."
 *
 * **A real `<table>`, not decision 0154's own card list.** The whole
 * row is the click target and `.rulestate` sits in its own column,
 * the same shape decisions 0287 and 0288 already gave Documents and
 * Tasks — one family of list across the app, not three different
 * ideas of what a row is.
 */
function ruleRow(rule) {
  const row = el("tr", { class: "clickable" }, [
    el("td", {}, [
      /**
       * **Named where it has a name, decision 0266, unchanged.** A
       * list of ten rules reads as ten sentences otherwise, and a
       * name is what a person actually scans for. The sentence stays
       * underneath, muted, for the rule nobody has named yet and for
       * whoever wants to confirm what a named one actually does.
       */
      el("div", { text: rule.name ?? rule.sourceText ?? "" }),
      ...(rule.name ? [el("div", { class: "sm muted", text: rule.sourceText ?? "" })] : []),
    ]),
    el("td", {}, [
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
    ]),
  ]);
  // **The sentence is the way in, decision 0155, unchanged** — opening
  // a rule is the first thing anybody wants to do with a row, and a
  // whole clickable row (decisions 0287, 0288) is that gesture without
  // needing a link styled apart from the rest of the cell.
  row.onclick = () => openRule(rule.id);
  return row;
}

function render() {
  const shell = document.getElementById("shell");
  if (!shell) return;

  const stage = stages.find((s) => s.id === chosen);

  shell.replaceChildren(
    frame(
      el("div", {}, [
        /**
         * **Create rule, top right, decision 0309** — reported live:
         * "there is a create rule button beneath the table of rules.
         * Please can you move this button to the top right of the
         * page, to the left of the Night / Day button (with the
         * horizontal line as a break)." Passed into `topbar()`'s own
         * `right` array, the same mechanism decisions 0298, 0303, and
         * 0305 already used to move a screen's own action there —
         * `right` renders before `moodPicker`, so this lands left of
         * Night/Day, and decision 0304's own boundary line appears
         * beside it automatically, since `right` is no longer empty.
         *
         * **Same icon and label as before** (`compile`, `rules.new`),
         * rebuilt as `.actionlink` — the shape every other topbar
         * button already uses — rather than the standalone
         * `<button class="primary">` a footer row could afford but a
         * compact row of icon-and-label buttons cannot.
         *
         * **Still every stage's own button, decision 0154's own
         * reasoning unchanged** — writing the first rule at a stage
         * creates the rule set, so the button was never conditional
         * on a stage already having one; in the topbar it is, if
         * anything, more obviously that: present regardless of which
         * stage is even selected, not folded into one panel among
         * several.
         */
        topbar(t("nav.rules"), t("rules.subtitle"), [
          el(
            "button",
            { class: "actionlink", title: t("rules.new"), onclick: () => compose(stage) },
            [icon("compile"), el("span", { text: t("rules.new") })]
          ),
        ]),
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
            ? el("div", { class: "tablewrap" }, [
                el("table", {}, [
                  el("thead", {}, [
                    el("tr", {}, [
                      el("th", { text: t("column.rule") }),
                      el("th", { text: t("column.status") }),
                    ]),
                  ]),
                  el("tbody", {}, rules.map(ruleRow)),
                ]),
              ])
            : el("p", { class: "muted", text: t("rules.empty") }),
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
