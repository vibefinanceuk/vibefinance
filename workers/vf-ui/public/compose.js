import { t } from "/strings.js";
import { el, frame, topbar, setCurrentScreen } from "/tasks.js";
import { icon } from "/icons.js";
import { readback, useFieldDescriptions, exampleFacts } from "/readback.js";

/**
 * Writing a rule — decision 0153.
 *
 * **The product's actual claim.** A customer writes a sentence and gets
 * an enforced rule; until now that was a `curl`, which meant only the
 * operator could do it — and the whole argument for the closed
 * vocabulary (decision 0031) is that it is safe to hand to a customer.
 *
 * Five steps with a real gate in the middle: write, read back, confirm
 * every worked example, activate. The gate is decision 0034's, and it
 * is the reason this is a flow rather than a form.
 */

let stage = null;
let compiled = null;
let examples = [];
let refusal = null;
let revising = null;

function note(message) {
  const box = document.getElementById("compose-note");
  if (box) box.textContent = message;
}

/**
 * Compile the sentence.
 *
 * **A refusal is an answer, not a failure** (decision 0033). The model
 * declining to express something is the vocabulary boundary doing its
 * job, and a screen that treats it as an error teaches somebody to
 * distrust a working system.
 */
async function compile() {
  const sourceText = document.getElementById("sentence").value.trim();
  if (sourceText === "") {
    note(t("compose.needsentence"));
    return;
  }

  compiled = null;
  refusal = null;
  examples = [];
  note(t("compose.compiling"));

  const response = await fetch("/api/rules/compile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ruleSetId: stage.ruleSetId,
      sourceText,
      // Present only when revising, so the route makes a new version
      // rather than a new rule.
      ...(revising?.ruleId ? { ruleId: revising.ruleId } : {}),
      // Only meaningful on creation — decision 0266. A recompile
      // ignores this field regardless, but not sending it while
      // revising keeps the request honest about what it is asking for.
      ...(!revising && document.getElementById("rule-name")?.value.trim()
        ? { name: document.getElementById("rule-name").value.trim() }
        : {}),
    }),
  });

  const body = await response.json();

  if (body.status === "refused") {
    refusal = body.reason;
    render();
    return;
  }

  if (!response.ok) {
    note(body.error ?? t("compose.failed"));
    return;
  }

  compiled = body;
  await loadExamples();
  render();
}

async function loadExamples() {
  const response = await fetch(
    `/api/rules/${encodeURIComponent(compiled.ruleId)}/versions/${compiled.version}/examples`
  );
  examples = response.ok ? (await response.json()).examples ?? [] : [];
}

/**
 * Confirm one example.
 *
 * **A named person confirms it** (decision 0034), derived from the
 * authenticated caller rather than sent — the discipline decision 0010
 * proves with a spoofed-identity test.
 */
async function confirmExample(exampleId) {
  const response = await fetch(`/api/rules/examples/${encodeURIComponent(exampleId)}/confirm`, {
    method: "POST",
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    note(body.error ?? t("compose.failed"));
    return;
  }

  await loadExamples();
  render();
}

async function activate() {
  const response = await fetch(
    `/api/rules/${encodeURIComponent(compiled.ruleId)}/versions/${compiled.version}/activate`,
    { method: "POST" }
  );

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    note(body.error ?? t("compose.failed"));
    return;
  }

  // The rule is live, so this screen has nothing left to say about it.
  const { open } = await import("/rules.js");
  await open();
}

/**
 * One worked example.
 *
 * **In plain terms, not `expectMatch: true`.** Somebody confirming a
 * batch is being asked to agree that an outcome is right, and a boolean
 * beside a JSON blob is not something anybody can agree with.
 */
function exampleRow(example) {
  const fires = example.expectMatch;

  return el("div", { class: "example" }, [
    el("div", {
      class: `verdict ${fires ? "fires" : "quiet"}`,
      text: fires ? t("compose.fires") : t("compose.quiet"),
    }),
    el("div", { class: "body" }, [
      exampleFacts(example.invoice ?? {}, compiled?.conditions),
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

/** A box with room to write in, holding whatever it starts from. */
function textarea(value) {
  const node = el("textarea", { id: "sentence", rows: "6" });
  node.value = value;
  return node;
}

/**
 * A rule's own name, entered only when writing a new one — decision
 * 0266.
 *
 * **Absent while revising.** The name lives on the rule itself, not on
 * a version, and a recompile never touches it (`compile-route.ts`
 * ignores whatever this would send) — showing an input that has no
 * effect would be worse than not offering it, the same argument
 * decision 0142 already made for Save on a read-only form.
 */
function nameInput() {
  const node = el("input", { id: "rule-name", type: "text", placeholder: t("compose.nameplaceholder") });
  return node;
}

function render() {
  const shell = document.getElementById("shell");
  if (!shell) return;

  const outstanding = examples.filter((e) => !e.confirmedBy).length;
  const panels = [];
  const startingFrom = revising?.sourceText ?? "";

  // 1. The sentence.
  panels.push(
    el("div", { class: "panel" }, [
      el("h3", { text: t("compose.write") }),
      // **Room to write in** — decision 0154. Three rows made a rule look
      // like a search box, and a rule is a sentence somebody thinks about.
      // **Starts from what exists when revising** — decision 0155.
      // Rewriting a rule from a blank page invites somebody to lose a
      // clause they meant to keep.
      textarea(startingFrom),
      // **A name, only for a brand new rule** — decision 0266.
      ...(revising
        ? []
        : [
            el("label", { class: "sm muted", for: "rule-name", text: t("compose.namelabel") }),
            nameInput(),
          ]),
      el("div", { class: "composebar" }, [
        el("button", { class: "primary", onclick: compile }, [
          icon("compile"),
          el("span", { text: t("compose.compile") }),
        ]),
        el("span", { class: "sm muted", text: t("compose.plain") }),
      ]),
    ])
  );

  // 2a. Refused — an answer, in warning rather than alarm.
  if (refusal) {
    panels.push(
      el("div", { class: "panel" }, [
        el("h3", { text: t("compose.cannot") }),
        el("div", { class: "refusal" }, [el("div", { text: refusal })]),
        el("p", { class: "sm muted", text: t("compose.nothingsaved") }),
      ])
    );
  }

  // 2b. What it understood.
  if (compiled) {
    panels.push(
      el("div", { class: "panel" }, [
        el("h3", { text: t("compose.willdo") }),
        readback(compiled.conditions, compiled.actions),
        el("p", { class: "sm muted", text: t("readback.check") }),
      ])
    );

    // 3. The evidence.
    panels.push(
      el("div", { class: "panel" }, [
        el("h3", { text: t("compose.examples") }),
        el("p", { class: "sm muted", text: t("compose.examplesnote") }),
        ...examples.map(exampleRow),
      ])
    );

    // 4. The gate.
    panels.push(
      el("div", { class: "gate" }, [
        el(
          "button",
          {
            class: "primary",
            onclick: activate,
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
      ])
    );
  }

  shell.replaceChildren(
    frame(
      el("div", {}, [
        topbar(
          revising ? t("compose.newversion") : t("compose.title"),
          stage?.name ?? ""
        ),
        ...panels,
        el("div", { class: "problem", id: "compose-note", role: "status" }),
      ])
    )
  );
}

export async function openCompose(forStage, existing = null) {
  setCurrentScreen("rules");
  stage = forStage;
  compiled = null;
  refusal = null;
  examples = [];
  /**
   * A new version of an existing rule — decision 0155.
   *
   * **The box starts from what exists.** Rewriting a rule from a blank
   * page invites somebody to lose a clause they meant to keep, and the
   * compile route already accepts a `ruleId` to produce a v2 rather
   * than a new rule (decision 0014).
   */
  revising = existing;

  // The field descriptions the read-back needs, from the same route the
  // keying screen uses — one vocabulary, not two (decision 0031).
  try {
    const response = await fetch("/api/field-visibility");
    if (response.ok) {
      const body = await response.json();
      // **Both**: the keyed fields, and the derived ones the platform
      // computes (decision 0159). A rule can test either.
      useFieldDescriptions(body.fields, body.derived);
    }
  } catch {
    // The read-back falls back to Business Term ids, which is worse and
    // not wrong.
  }

  render();
}
