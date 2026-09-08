import { t } from "/strings.js";
import { el, frame, topbar, setCurrentScreen } from "/tasks.js";
import { icon } from "/icons.js";
import { readback, useFieldDescriptions } from "/readback.js";

/**
 * One rule, opened — decision 0155.
 *
 * The list says what exists; this says **what it does, which version is
 * running, and what happened before**. Somebody asking *"why did this
 * change"* needs to see that v2 replaced v1 and when.
 *
 * Three things it offers, all asked for: **pause** (and resume),
 * **compile a new version**, and the version number itself.
 */

let rule = null;
let stage = null;

function note(message) {
  const box = document.getElementById("rule-note");
  if (box) box.textContent = message;
}

/**
 * Pause it, or start it again.
 *
 * **Pausing is not unapproving.** The version keeps its approval and
 * its confirmed examples, so resuming needs no second trip through the
 * activation gate (decision 0034) — that gate exists to prove somebody
 * read the rule, and they did.
 */
async function setEnabled(enabled) {
  const response = await fetch(`/api/rules/${encodeURIComponent(rule.id)}/enabled`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    note(body.error ?? t("rules.failed"));
    return;
  }

  await load(rule.id);
  render();
}

async function newVersion() {
  const { openCompose } = await import("/compose.js");
  // **Carried in, so the box starts from what exists.** Rewriting a
  // rule from a blank page invites somebody to lose a clause they meant
  // to keep.
  await openCompose(
    { ...stage, ruleSetId: rule.ruleSetId },
    { ruleId: rule.id, sourceText: rule.versions[0]?.sourceText ?? "" }
  );
}

async function load(ruleId) {
  const response = await fetch(`/api/rules/${encodeURIComponent(ruleId)}`);
  if (!response.ok) return false;
  rule = await response.json();
  return true;
}

/** One version, with what it says and where it stands. */
function versionPanel(version, isLatest) {
  const parts = [
    el("div", { class: "versionhead" }, [
      el("h3", { text: t("rule.version").replace("{n}", String(version.version)) }),
      ...(version.isLive
        ? [el("span", { class: "rulestate live" }, [icon("complete"), el("span", { text: t("rulestate.live") })])]
        : version.approvedAt
          ? [el("span", { class: "rulestate paused" }, [icon("paused"), el("span", { text: t("rulestate.paused") })])]
          : [
              el("span", {
                class: "rulestate awaiting_confirmation",
                text:
                  version.examplesTotal > 0
                    ? `${version.examplesTotal - version.examplesConfirmed} ${t("rulestate.awaiting_confirmation").toLowerCase()}`
                    : t("rulestate.draft"),
              }),
            ]),
    ]),
    // The sentence somebody wrote, first — it is what they recognise.
    el("p", { class: "said", text: version.sourceText }),
  ];

  // **The read-back, only for the version being looked at.** Every
  // version rendered in full would bury the current one.
  if (isLatest && version.conditions) {
    parts.push(readback(version.conditions, version.actions ?? []));
  }

  if (version.approvedAt) {
    parts.push(
      el("p", {
        class: "sm muted",
        text: t("rule.approvedby")
          .replace("{who}", version.approvedBy ?? "")
          .replace("{when}", version.approvedAt),
      })
    );
  }

  return el("div", { class: "panel" }, parts);
}

function render() {
  const shell = document.getElementById("shell");
  if (!shell) return;

  shell.replaceChildren(
    frame(
      el("div", {}, [
        topbar(t("rule.title"), rule.stageName ?? ""),

        el("div", { class: "gate" }, [
          // **The word the list already uses.** "Deactivate" and
          // "pause" are the same act, and an interface with two names
          // for one thing is an interface somebody has to learn twice.
          el(
            "button",
            { onclick: () => setEnabled(!rule.enabled) },
            [
              icon(rule.enabled ? "paused" : "complete"),
              el("span", { text: rule.enabled ? t("rule.pause") : t("rule.resume") }),
            ]
          ),
          el("button", { onclick: newVersion }, [
            icon("compile"),
            el("span", { text: t("rule.newversion") }),
          ]),
          el("span", { class: "why", text: rule.enabled ? t("rule.running") : t("rule.notrunning") }),
        ]),

        ...rule.versions.map((version, index) => versionPanel(version, index === 0)),

        el("div", { class: "problem", id: "rule-note", role: "status" }),
      ])
    )
  );
}

export async function openRule(ruleId, forStage) {
  setCurrentScreen("rules");
  stage = forStage;

  try {
    const response = await fetch("/api/field-visibility");
    if (response.ok) useFieldDescriptions((await response.json()).fields);
  } catch {
    // The read-back falls back to Business Term ids.
  }

  if (!(await load(ruleId))) {
    note(t("rules.failed"));
    return;
  }

  render();
}
