import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * In-app Help — decision 0518. A side panel: written help for the
 * screen, and — with a task open — each of the person's own actions
 * with the live reasons the server gives for them, then a question box
 * answered by `/api/help/ask`.
 */

const STRINGS = {
  locale: "en",
  strings: {
    "help.title": "Help",
    "help.aboutpage": "About this page",
    "help.atstage": "At {stage}: your actions",
    "help.noactions": "Nothing to do.",
    "help.screen.tasks": "Every task you can see.",
    "help.screen.viewer": "One invoice, and the task you have on it.",
    "help.action.complete": "Finish your work at this stage.",
    "help.action.route_to_approver": "Choose who should approve this invoice.",
    "help.action.return": "Send the invoice back.",
    "help.reason.limit_insufficient": "Your limit ({currency} {limit}) does not cover {currency} {amount}.",
    "help.reason.return_targets": "You can return this invoice to: {stages}.",
    "help.ask.heading": "Ask a question",
    "help.ask.placeholder": "Ask",
    "help.ask.button": "Ask",
    "help.ask.thinking": "Thinking…",
    "help.ask.failed": "Sorry.",
    "help.ask.disclaimer": "AI answers.",
    "action.route_to_approver": "Route To Approver",
    "action.return": "Return",
    "action.close": "Close",
    "ask.title": "Ask",
    "ask.intro": "Ask anything about this page.",
  },
};

const TASK = { id: "t-1", stageId: "approval", stageName: "Approval", actions: ["route_to_approver", "return"] };

function stub(routes: Record<string, unknown>, bodies: { path: string; body: unknown }[] = []) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url).split("?")[0];
      if (init?.body) bodies.push({ path, body: JSON.parse(String(init.body)) });
      if (!(path in routes)) throw new Error(`no stub for ${path}`);
      return { ok: true, json: async () => routes[path] } as Response;
    })
  );
}

async function loadStrings() {
  const { loadStrings } = await import("/strings.js");
  await loadStrings();
}

const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  document.body.innerHTML = "";
  vi.resetModules();
});
afterEach(() => vi.unstubAllGlobals());

describe("the Help panel (decision 0518)", () => {
  it("without a task, shows only the current page's help — and no question box, which moved to Ask (decision 0519)", async () => {
    stub({ "/api/ui-strings": STRINGS });
    await loadStrings();
    const { openHelp } = await import("/help.js");
    await openHelp({ screen: "tasks", task: null });

    const panel = document.querySelector(".helppanel") as HTMLElement;
    expect(panel).not.toBeNull();
    expect(panel.textContent).toContain("Every task you can see.");
    expect(panel.querySelector(".helpactions")).toBeNull();
    expect(panel.querySelector("textarea")).toBeNull();
  });

  it("with a task, lists the person's own actions and the live reason for each, placeholders filled", async () => {
    stub({
      "/api/ui-strings": STRINGS,
      "/api/help/tasks/t-1": {
        stage: { id: "approval", name: "Approval" },
        approvalMode: "manual",
        reasons: [
          { action: "route_to_approver", code: "limit_insufficient", params: { limit: 1000, amount: 3000, currency: "EUR" } },
          { action: "return", code: "return_targets", params: { stages: "Coding, Validation" } },
        ],
      },
    });
    await loadStrings();
    const { openHelp } = await import("/help.js");
    await openHelp({ screen: "tasks", task: TASK });

    const panel = document.querySelector(".helppanel") as HTMLElement;
    expect(panel.textContent).toContain("One invoice, and the task you have on it.");
    expect(panel.querySelector(".helpsection h4:nth-of-type(1)")).not.toBeNull();
    expect([...panel.querySelectorAll("h4")].map((h) => h.textContent)).toContain("At Approval: your actions");

    const items = [...panel.querySelectorAll(".helpaction")] as HTMLElement[];
    expect(items.map((i) => i.getAttribute("data-action"))).toEqual(["route_to_approver", "return"]);
    expect(items[0].textContent).toContain("Choose who should approve this invoice.");
    expect(items[0].querySelector(".helpwhy")?.textContent).toBe(
      `Your limit (EUR ${(1000).toLocaleString()}) does not cover EUR ${(3000).toLocaleString()}.`
    );
    expect(items[1].querySelector(".helpwhy")?.textContent).toBe("You can return this invoice to: Coding, Validation.");
  });

  it("Ask is its own panel: posts the question, task, locale and Help's own text for this task, and shows the answer under the question (decision 0519)", async () => {
    const bodies: { path: string; body: unknown }[] = [];
    stub(
      {
        "/api/ui-strings": STRINGS,
        "/api/help/tasks/t-1": { stage: { id: "approval", name: "Approval" }, approvalMode: "manual", reasons: [] },
        "/api/help/ask": { answer: "Because your limit is too low." },
      },
      bodies
    );
    await loadStrings();
    const { openAsk } = await import("/help.js");
    openAsk({ screen: "tasks", task: TASK });

    const panel = document.querySelector(".helppanel.askpanel") as HTMLElement;
    expect(panel).not.toBeNull();
    expect(panel.querySelector("h3")?.textContent).toBe("Ask");
    expect(panel.querySelector(".helpactions")).toBeNull();

    (panel.querySelector("textarea") as HTMLTextAreaElement).value = "Why can't I complete?";
    (panel.querySelector(".helpask button") as HTMLButtonElement).click();
    for (let i = 0; i < 4; i++) await settle();

    const posted = bodies.find((b) => b.path === "/api/help/ask")?.body as Record<string, string>;
    expect(posted.question).toBe("Why can't I complete?");
    expect(posted.taskId).toBe("t-1");
    expect(posted.screen).toBe("viewer");
    expect(posted.locale).toBe("en");
    expect(posted.helpText).toContain("Choose who should approve this invoice.");
    expect(panel.querySelector(".askquestion")?.textContent).toBe("Why can't I complete?");
    expect(panel.querySelector(".helpanswer")?.textContent).toBe("Because your limit is too low.");
    expect((panel.querySelector("textarea") as HTMLTextAreaElement).value).toBe("");
  });

  it("Help and Ask share one slot: opening one closes the other, and each toggles itself (decision 0519)", async () => {
    stub({ "/api/ui-strings": STRINGS });
    await loadStrings();
    const { toggleHelp, toggleAsk } = await import("/help.js");
    toggleHelp({ screen: "tasks", task: null });
    await settle();
    toggleAsk({ screen: "tasks", task: null });
    expect(document.querySelectorAll(".helppanel")).toHaveLength(1);
    expect(document.querySelector(".askpanel")).not.toBeNull();
    toggleAsk({ screen: "tasks", task: null });
    expect(document.querySelector(".helppanel")).toBeNull();
  });

  it("toggles closed from the same button, and closes on Escape", async () => {
    stub({ "/api/ui-strings": STRINGS });
    await loadStrings();
    const { toggleHelp } = await import("/help.js");
    toggleHelp({ screen: "tasks", task: null });
    await settle();
    expect(document.querySelector(".helppanel")).not.toBeNull();
    toggleHelp({ screen: "tasks", task: null });
    expect(document.querySelector(".helppanel")).toBeNull();

    toggleHelp({ screen: "tasks", task: null });
    await settle();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(document.querySelector(".helppanel")).toBeNull();
  });
});
