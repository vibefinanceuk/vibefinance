import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Process management — decision 0349. "Adding stages to a process,
 * and version control."
 */

function mountShell() {
  document.body.innerHTML = `<main id="shell"></main><main id="viewer" hidden></main>`;
}

function stubFetch(
  routes: Record<string, unknown>,
  posted: string[] = [],
  deleted: string[] = [],
  puts: { path: string; body: unknown }[] = []
) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url).split("?")[0];
      if (init?.method === "POST") posted.push(path);
      if (init?.method === "DELETE") deleted.push(path);
      if (init?.method === "PUT") puts.push({ path, body: init.body ? JSON.parse(String(init.body)) : null });
      if (!(path in routes)) throw new Error(`no stub for ${path}`);
      const value = routes[path];
      if (value && typeof value === "object" && "ok" in (value as Record<string, unknown>)) {
        return value as Response;
      }
      return { ok: true, json: async () => value } as Response;
    })
  );
}

const STRINGS = {
  locale: "en",
  strings: {
    "nav.tasks": "Tasks",
    "nav.dashboard": "Dashboard",
    "nav.processes": "Processes",
    "processes.title": "Processes",
    "processes.subtitle": "Stages, in order, and how a process changes shape",
    "processes.new": "New process",
    "processes.name": "Name",
    "processes.id": "ID",
    "processes.version": "Version",
    "processes.stages": "stages",
    "processes.empty": "No processes configured.",
    "processes.v": "v",
    "processes.live": "live",
    "processes.draft": "Draft",
    "processes.draftnote": "In-flight invoices stay on the live version.",
    "processes.addstage": "Add stage",
    "processes.removestage": "Remove from draft",
    "processes.scope": "Evaluated",
    "processes.scopeheader": "Once per invoice",
    "processes.scopeline": "Once per line",
    "processes.automatic": "Automatic",
    "processes.needidandname": "Give it an ID and a name.",
    "processes.savefailed": "Could not save. Please try again.",
    "action.newprocess": "New process",
    "action.addstage": "Add stage",
    "action.startdraft": "New draft",
    "action.publish": "Publish",
    "action.discard": "Discard",
    "action.create": "Create",
    "action.close": "Close",
  },
};

const PROCESSES_LIST = [{ id: "p1", name: "Standard AP", version: 1, stageCount: 2 }];

const DETAIL_NO_DRAFT = {
  id: "p1",
  name: "Standard AP",
  version: 1,
  stages: [
    { id: "s1", name: "Received", sequence: 1, ruleSetId: null, ruleSetName: null, evaluationScope: "header" },
    { id: "s2", name: "Approval", sequence: 2, ruleSetId: "rs1", ruleSetName: "AP Approval", evaluationScope: "header" },
  ],
  draft: null,
};

const DETAIL_WITH_DRAFT = {
  ...DETAIL_NO_DRAFT,
  draft: {
    version: 2,
    stages: [
      ...DETAIL_NO_DRAFT.stages,
      { id: "s3", name: "Coding", sequence: 3, ruleSetId: null, ruleSetName: null, evaluationScope: "line" },
    ],
  },
};

function baseRoutes(permissions: string[]) {
  return {
    "/api/ui-strings": STRINGS,
    "/api/whoami": { id: "u-dan", name: "Dan", permissions },
    "/api/tasks": { tasks: [], counts: {} },
    "/api/processes": { processes: PROCESSES_LIST },
  };
}

async function open(
  extra: Record<string, unknown> = {},
  permissions: string[] = ["Admin.Configure"],
  posted: string[] = [],
  deleted: string[] = [],
  puts: { path: string; body: unknown }[] = []
) {
  stubFetch({ ...baseRoutes(permissions), ...extra }, posted, deleted, puts);
  const { loadStrings } = await import("/strings.js");
  await loadStrings();
  const { start } = await import("/tasks.js");
  await start();
  const { open: openProcesses } = await import("/processes.js");
  await openProcesses();
}

beforeEach(() => {
  mountShell();
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the process list", () => {
  it("lists every process with its own live version and stage count", async () => {
    await open();
    expect(document.body.textContent).toContain("Standard AP");
    expect(document.body.textContent).toContain("v1");
    expect(document.body.textContent).toContain("2");
  });

  it("shows an empty message when no processes exist", async () => {
    await open({ "/api/processes": { processes: [] } });
    expect(document.body.textContent).toContain("No processes configured.");
  });

  it("shows a New process action holding Admin.Configure", async () => {
    await open();
    expect([...document.querySelectorAll("button")].some((b) => b.textContent?.includes("New process"))).toBe(true);
  });

  it("hides the New process action without Admin.Configure", async () => {
    await open({}, ["AP.Dashboard"]);
    expect([...document.querySelectorAll("button")].some((b) => b.textContent?.includes("New process"))).toBe(false);
  });
});

describe("selecting a process, no draft", () => {
  async function openAndSelect(posted: string[] = []) {
    await open({ "/api/processes/p1": DETAIL_NO_DRAFT }, ["Admin.Configure"], posted);
    const row = [...document.querySelectorAll("tr")].find((r) => r.textContent?.includes("Standard AP"));
    row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
  }

  it("shows the live stages in sequence, each with its own rule set or Automatic", async () => {
    await openAndSelect();
    expect(document.body.textContent).toContain("Received");
    expect(document.body.textContent).toContain("Automatic");
    expect(document.body.textContent).toContain("Approval");
    expect(document.body.textContent).toContain("AP Approval");
  });

  it("shows no draft section at all when none exists", async () => {
    await openAndSelect();
    expect(document.body.textContent).not.toContain("Draft");
  });

  it("shows an Add stage action, holding Admin.Configure", async () => {
    await openAndSelect();
    expect([...document.querySelectorAll("button")].some((b) => b.textContent?.includes("Add stage"))).toBe(true);
  });

  /**
   * **The gap reported live — decision 0353**: "It seems that I
   * cannot modify an existing process?" Only Add stage existed
   * before this; someone who only wants to reorder or remove
   * something had no way in without adding a stage nobody wanted.
   */
  it("shows a New draft action too, holding Admin.Configure", async () => {
    await openAndSelect();
    expect([...document.querySelectorAll("button")].some((b) => b.textContent?.includes("New draft"))).toBe(true);
  });

  it("hides New draft without Admin.Configure, the same as Add stage", async () => {
    await open({ "/api/processes/p1": DETAIL_NO_DRAFT }, ["AP.Dashboard"]);
    const row = [...document.querySelectorAll("tr")].find((r) => r.textContent?.includes("Standard AP"));
    row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
    expect([...document.querySelectorAll("button")].some((b) => b.textContent?.includes("New draft"))).toBe(false);
  });

  it("clicking New draft calls the real start-draft route", async () => {
    const posted: string[] = [];
    await open(
      { "/api/processes/p1": DETAIL_NO_DRAFT, "/api/processes/p1/draft": { id: "p1", draft: { version: 2, stages: DETAIL_NO_DRAFT.stages } } },
      ["Admin.Configure"],
      posted
    );
    const row = [...document.querySelectorAll("tr")].find((r) => r.textContent?.includes("Standard AP"));
    row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));

    const startButton = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("New draft")) as HTMLButtonElement;
    startButton.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(posted).toContain("/api/processes/p1/draft");
  });

  /**
   * **The structural half of the same request — decision 0354**:
   * "please could the New Draft and Add stage button be moved in to
   * the card above, to be consistent with other screens." Confirmed
   * directly, not just that the buttons exist somewhere: they sit in
   * the same `.cardhead` as the panel's own heading, the shape every
   * other screen's own "New X" action already uses.
   */
  it("puts New draft and Add stage in the same .cardhead as the panel's own heading, not a separate row beneath it", async () => {
    await openAndSelect();
    // Two .cardhead elements exist now: the process list's own ("New
    // process") and the detail panel's own — find the right one by
    // its own heading text, not just the first .cardhead on the page.
    const cardhead = [...document.querySelectorAll(".panel .cardhead")].find((c) => c.querySelector("h3")?.textContent?.includes("Standard AP"));
    expect(cardhead).not.toBeUndefined();
    const buttonTexts = [...(cardhead?.querySelectorAll("button") ?? [])].map((b) => b.textContent);
    expect(buttonTexts.some((t) => t?.includes("New draft"))).toBe(true);
    expect(buttonTexts.some((t) => t?.includes("Add stage"))).toBe(true);
  });
});

describe("selecting a process with a draft", () => {
  async function openAndSelect(
    permissions: string[] = ["Admin.Configure"],
    posted: string[] = [],
    deleted: string[] = [],
    puts: { path: string; body: unknown }[] = []
  ) {
    await open({ "/api/processes/p1": DETAIL_WITH_DRAFT }, permissions, posted, deleted, puts);
    const row = [...document.querySelectorAll("tr")].find((r) => r.textContent?.includes("Standard AP"));
    row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));
  }

  it("shows both the live version and the draft, distinctly", async () => {
    await openAndSelect();
    expect(document.body.textContent).toContain("Draft");
    expect(document.body.textContent).toContain("Coding");
  });

  it("offers Publish and Discard, holding Admin.Configure", async () => {
    await openAndSelect();
    const buttons = [...document.querySelectorAll("button")].map((b) => b.textContent);
    expect(buttons.some((t) => t?.includes("Publish"))).toBe(true);
    expect(buttons.some((t) => t?.includes("Discard"))).toBe(true);
  });

  it("hides Publish, Discard, and Add stage without Admin.Configure", async () => {
    await openAndSelect(["AP.Dashboard"]);
    const buttons = [...document.querySelectorAll("button")].map((b) => b.textContent);
    expect(buttons.some((t) => t?.includes("Publish"))).toBe(false);
    expect(buttons.some((t) => t?.includes("Discard"))).toBe(false);
    expect(buttons.some((t) => t?.includes("Add stage"))).toBe(false);
  });

  it("publishing calls the real publish route", async () => {
    const posted: string[] = [];
    await openAndSelect(["Admin.Configure"], posted);
    const publishButton = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Publish")) as HTMLButtonElement;
    publishButton.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(posted).toContain("/api/processes/p1/publish");
  });

  it("discarding calls the real discard route", async () => {
    const deleted: string[] = [];
    await openAndSelect(["Admin.Configure"], [], deleted);
    const discardButton = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Discard")) as HTMLButtonElement;
    discardButton.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(deleted).toContain("/api/processes/p1/draft");
  });

  it("removing a draft stage calls the real remove route, naming the stage", async () => {
    const deleted: string[] = [];
    await openAndSelect(["Admin.Configure"], [], deleted);
    const removeButtons = [...document.querySelectorAll(".process .stage button")] as HTMLButtonElement[];
    // The third stage, Coding, is the one only the draft carries.
    removeButtons[removeButtons.length - 1].click();
    await new Promise((r) => setTimeout(r, 0));
    expect(deleted).toContain("/api/processes/p1/draft/stages/s3");
  });

  describe("drag-to-reorder — decision 0352", () => {
    /**
     * **Reported live**: "I like the drag to re-order, if that is
     * possible?" Confirmed as a genuine, working feature, not just a
     * visual affordance.
     */
    function draftStages(): HTMLElement[] {
      // Two `.process` blocks render: the live version's own, and the
      // draft's own. The draft is the second.
      const blocks = [...document.querySelectorAll(".process")];
      return [...blocks[blocks.length - 1].querySelectorAll(".stage")] as HTMLElement[];
    }

    it("marks the draft's own stages draggable, and the live version's own not", async () => {
      await openAndSelect();
      const blocks = [...document.querySelectorAll(".process")];
      const liveStages = [...blocks[0].querySelectorAll(".stage")] as HTMLElement[];
      const draft = draftStages();

      expect(liveStages.every((s) => s.getAttribute("draggable") !== "true")).toBe(true);
      expect(draft.every((s) => s.getAttribute("draggable") === "true")).toBe(true);
    });

    it("dropping the first stage onto the last sends the whole new order to the real reorder route", async () => {
      const puts: { path: string; body: unknown }[] = [];
      await openAndSelect(["Admin.Configure"], [], [], puts);

      const stages = draftStages();
      expect(stages).toHaveLength(3); // s1 Received, s2 Approval, s3 Coding

      stages[0].dispatchEvent(new Event("dragstart", { bubbles: true }));
      stages[2].dispatchEvent(new Event("dragover", { bubbles: true, cancelable: true }));
      stages[2].dispatchEvent(new Event("drop", { bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 0));

      expect(puts).toHaveLength(1);
      expect(puts[0].path).toBe("/api/processes/p1/draft/stages");
      // Forward drag (index 0 -> 2): lands just AFTER the target,
      // matching "drop it on the last one" reading as "move to the end."
      expect(puts[0].body).toEqual({ orderedStageIds: ["s2", "s3", "s1"] });
    });

    it("dropping the last stage onto the first lands it just BEFORE the target — the opposite direction, on purpose", async () => {
      const puts: { path: string; body: unknown }[] = [];
      await openAndSelect(["Admin.Configure"], [], [], puts);

      const stages = draftStages();
      stages[2].dispatchEvent(new Event("dragstart", { bubbles: true }));
      stages[0].dispatchEvent(new Event("dragover", { bubbles: true, cancelable: true }));
      stages[0].dispatchEvent(new Event("drop", { bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 0));

      expect(puts).toHaveLength(1);
      expect(puts[0].body).toEqual({ orderedStageIds: ["s3", "s1", "s2"] });
    });

    it("dropping a stage on itself is a no-op — no request sent at all", async () => {
      const puts: { path: string; body: unknown }[] = [];
      await openAndSelect(["Admin.Configure"], [], [], puts);

      const stages = draftStages();
      stages[0].dispatchEvent(new Event("dragstart", { bubbles: true }));
      stages[0].dispatchEvent(new Event("dragover", { bubbles: true, cancelable: true }));
      stages[0].dispatchEvent(new Event("drop", { bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 0));

      expect(puts).toHaveLength(0);
    });

    it("without Admin.Configure, the draft's own stages are not draggable at all", async () => {
      await openAndSelect(["AP.Dashboard"]);
      const draft = draftStages();
      expect(draft.every((s) => s.getAttribute("draggable") !== "true")).toBe(true);
    });
  });
});

describe("creating a new process", () => {
  it("posts the entered id and name", async () => {
    const posted: string[] = [];
    await open({ "/api/processes/p1": DETAIL_NO_DRAFT }, ["Admin.Configure"], posted);
    const button = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("New process")) as HTMLButtonElement;
    button.click();
    (document.querySelectorAll(".popout input")[0] as HTMLInputElement).value = "p2";
    (document.querySelectorAll(".popout input")[1] as HTMLInputElement).value = "Expense";
    const submit = [...document.querySelectorAll(".popout button")].find((b) => b.textContent?.includes("Create")) as HTMLButtonElement;
    submit.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(posted).toContain("/api/processes");
  });

  it("shows a real inline error and leaves the form open when the id or name is missing", async () => {
    await open();
    const button = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("New process")) as HTMLButtonElement;
    button.click();
    const submit = [...document.querySelectorAll(".popout button")].find((b) => b.textContent?.includes("Create")) as HTMLButtonElement;
    submit.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(document.querySelector(".backdrop")).not.toBeNull();
    expect(document.body.textContent).toContain("Give it an ID and a name");
  });
});

describe("adding a stage to a draft", () => {
  it("posts to the draft-stages route with the chosen evaluation scope", async () => {
    const posted: string[] = [];
    await open({ "/api/processes/p1": DETAIL_NO_DRAFT }, ["Admin.Configure"], posted);
    const row = [...document.querySelectorAll("tr")].find((r) => r.textContent?.includes("Standard AP"));
    row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 0));

    const addButton = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Add stage")) as HTMLButtonElement;
    addButton.click();
    (document.querySelectorAll(".popout input")[0] as HTMLInputElement).value = "s3";
    (document.querySelectorAll(".popout input")[1] as HTMLInputElement).value = "Coding";
    const submit = [...document.querySelectorAll(".popout button")].find((b) => b.textContent?.includes("Create")) as HTMLButtonElement;
    submit.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(posted).toContain("/api/processes/p1/draft/stages");
  });
});
