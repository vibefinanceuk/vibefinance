import { t } from "/strings.js";
import { el, frame, topbar, setCurrentScreen } from "/tasks.js";
import { icon } from "/icons.js";
import { readback, useFieldDescriptions, exampleFacts } from "/readback.js";

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

/**
 * The examples waiting on somebody, for the version that has them —
 * decision 0157.
 *
 * **The detail screen showed a count and no way to act on it.** Decision
 * 0153 put confirmation on the compose screen, immediately after
 * compiling; navigating away stranded the rule, and the list said
 * *"2 to confirm"* with nowhere to do it.
 *
 * Reported exactly that way: *"which now says in the list 2 to confirm,
 * but I cannot see what to confirm when navigating to the rule."*
 */
let examples = [];

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

  // **Only for a version that has not been activated.** An approved
  // version's examples were confirmed once and are history; loading
  // them would invite somebody to confirm what is already running.
  const pending = rule.versions.find((v) => !v.approvedAt && v.examplesTotal > 0);
  examples = pending ? await loadExamples(rule.id, pending.version) : [];

  return true;
}

async function loadExamples(ruleId, version) {
  const response = await fetch(
    `/api/rules/${encodeURIComponent(ruleId)}/versions/${version}/examples`
  );
  return response.ok ? (await response.json()).examples ?? [] : [];
}

async function confirmExample(exampleId) {
  const response = await fetch(`/api/rules/examples/${encodeURIComponent(exampleId)}/confirm`, {
    method: "POST",
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    note(body.error ?? t("rules.failed"));
    return;
  }

  await load(rule.id);
  render();
}

async function activate(version) {
  const response = await fetch(
    `/api/rules/${encodeURIComponent(rule.id)}/versions/${version}/activate`,
    { method: "POST" }
  );

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    note(body.error ?? t("rules.failed"));
    return;
  }

  await load(rule.id);
  render();
}

/**
 * One worked example, as decision 0153 renders them.
 *
 * **In plain terms, not `expectMatch: true`.** Somebody confirming is
 * being asked to agree that an outcome is right, and a boolean beside
 * a JSON blob is not something anybody can agree with.
 */
/**
 * The conditions of the version being confirmed — decision 0159.
 *
 * The examples belong to one version, and it is that version's rule
 * that decides which facts are decisive.
 */
function pendingConditions() {
  return rule?.versions.find((v) => !v.approvedAt && v.examplesTotal > 0)?.conditions;
}

function exampleRow(example) {
  return el("div", { class: "example" }, [
    el("div", {
      class: `verdict ${example.expectMatch ? "fires" : "quiet"}`,
      text: example.expectMatch ? t("compose.fires") : t("compose.quiet"),
    }),
    el("div", { class: "body" }, [
      exampleFacts(example.invoice ?? {}, pendingConditions()),
    ]),
    el(
      "div",
      {},
      example.confirmedBy
        ? [el("span", { class: "confirmed", text: t("compose.confirmed") })]
        : [el("button", { text: t("compose.confirm"), onclick: () => confirmExample(example.id) })]
    ),
  ]);
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

/**
 * Give a rule a name, or change it — decision 0266.
 *
 * **`window.prompt`, matching `sources.js`'s own rename** — the same
 * established, minimal pattern, not a second way to do the same kind
 * of thing. No recompile, no new version: this touches nothing but the
 * name.
 */
async function rename() {
  const name = window.prompt(t("rule.rename"), rule.name ?? "");
  if (name === null || name.trim() === "") return;

  const response = await fetch(`/api/rules/${encodeURIComponent(rule.id)}/name`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: name.trim() }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    note(body.error ?? t("rules.failed"));
    return;
  }

  await load(rule.id);
  render();
}

function render() {
  const shell = document.getElementById("shell");
  if (!shell) return;

  const outstanding = examples.filter((e) => !e.confirmedBy).length;
  const pendingVersion = rule.versions.find((v) => !v.approvedAt && v.examplesTotal > 0);

  shell.replaceChildren(
    frame(
      el("div", {}, [
        topbar(t("rule.title"), rule.stageName ?? ""),

        /**
         * **The rule's own name, or an invitation to give it one** —
         * decision 0266. Not folded into the topbar's title, which
         * belongs to the screen ("Rule") rather than to this one rule.
         */
        el("div", { class: "rulenamerow" }, [
          rule.name
            ? el("h2", { class: "rulename", text: rule.name })
            : el("span", { class: "muted", text: t("rule.unnamed") }),
          el("button", { class: "sm", onclick: rename, text: rule.name ? t("rule.rename") : t("rule.namethis") }),
        ]),

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

        /**
         * The examples, and the gate — decision 0157.
         *
         * Above the versions, because **this is what somebody came to
         * do**: a rule saying *"2 to confirm"* is a rule waiting on a
         * person, and the history can wait its turn.
         */
        ...(examples.length > 0
          ? [
              el("div", { class: "panel" }, [
                el("h3", { text: t("compose.examples") }),
                el("p", { class: "sm muted", text: t("compose.examplesnote") }),
                ...examples.map(exampleRow),
              ]),
              el("div", { class: "gate" }, [
                el(
                  "button",
                  {
                    class: "primary",
                    onclick: () => activate(pendingVersion.version),
                    ...(outstanding > 0 ? { disabled: "disabled" } : {}),
                  },
                  [icon("activate"), el("span", { text: t("compose.activate") })]
                ),
                el("span", {
                  class: "why",
                  text:
                    outstanding > 0
                      ? t("compose.confirmfirst").replace("{n}", String(outstanding))
                      : t("compose.allconfirmed"),
                }),
              ]),
            ]
          : []),

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
    if (response.ok) {
      const body = await response.json();
      // **Both**: the keyed fields, and the derived ones the platform
      // computes (decision 0159). A rule can test either.
      useFieldDescriptions(body.fields, body.derived);
    }
  } catch {
    // The read-back falls back to Business Term ids.
  }

  if (!(await load(ruleId))) {
    note(t("rules.failed"));
    return;
  }

  render();
}
