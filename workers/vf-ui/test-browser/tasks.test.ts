import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The task list — decisions 0103, 0138, 0142.
 *
 * **Opening a document is navigation, not an action.** Whether somebody
 * may look at a task is decided by the task being theirs; what they may
 * *do* is decided by the actions it reports, and what they may *edit*
 * by field visibility at that stage.
 */

function mountShell() {
  document.body.innerHTML = `<main id="shell"></main><main id="viewer" hidden></main>`;
}

function stubFetch(routes: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const path = String(url).split("?")[0];
      if (!(path in routes)) throw new Error(`no stub for ${path}`);
      return { ok: true, json: async () => routes[path] } as Response;
    })
  );
}

const STRINGS = {
  locale: "en",
  strings: {
    "nav.tasks": "Tasks",
    "nav.sources": "Sources",
    "nav.dashboard": "Dashboard",
    "nav.suppliers": "Suppliers",
    "nav.rules": "Rules",
    "nav.documents": "Documents",
    "nav.vibeap": "Vibe AP",
    "nav.collapse": "Collapse the menu",
    "nav.expand": "Expand the menu",
    "tasks.stage": "Stage",
    "tasks.line": "line",
    "tasks.supplier": "Supplier",
    "tasks.amount": "Amount",
    "tasks.waiting": "Waiting",
    "tasks.owner": "Owner",
    "tasks.signout": "Sign out",
    "tasks.allstages": "All stages",
    "tasks.everything": "Everything",
    "tasks.mine": "Mine",
    "tasks.available": "Available",
    "tasks.locked": "Locked",
    "tasks.empty": "Nothing here",
    "tasks.nodocument": "No document",
    "tasks.notkeyed": "Not keyed",
    "action.complete": "Complete",
    "action.return": "Return",
    "action.key": "Key",
    "mood.label": "Mood",
    "mood.day": "Day time",
    "mood.night": "Night time",
  },
};

/**
 * Every permission the nav's own decision-0276 mapping checks for —
 * used so tests about navigation, task keying, and the brand mark
 * continue to see every screen, the same way they did before that
 * mapping existed. Tests about the permission gate itself grant a
 * narrower, deliberately incomplete list instead.
 */
const ALL_NAV_PERMISSIONS = [
  "AP.Dashboard",
  "AP.TaskView",
  "Admin.Configure",
  "AP.Supplier",
  "Admin.RuleManagement",
  "AP.Review",
];

const APPROVAL_TASK = {
  id: "t-approve",
  stageId: "approval",
  stageName: "Approval",
  ownership: "mine",
  createdAt: "2026-09-01 09:00:00",
  // **No `key`.** An approval task never offers it, which is why
  // opening had to stop depending on it.
  actions: ["complete", "return"],
  subject: { type: "invoice", id: "inv-9", supplierName: "Munch GmbH", totalWithVat: 1200 },
};

async function openList(tasks: unknown[]) {
  stubFetch({
    "/api/ui-strings": STRINGS,
    "/api/whoami": { id: "u-dan", name: "Dan", permissions: ALL_NAV_PERMISSIONS },
    "/api/tasks": { tasks, counts: {} },
    // The other screens fetch their own data on arrival — decision
    // 0191's test navigates between them.
    "/api/sources": { sources: [] },
    "/api/processes": { processes: [] },
    "/api/rules": { rules: [] },
    "/api/rules/stages": { stages: [] },
    "/api/documents": { documents: [], searched: 0 },
    "/api/field-visibility": { fields: [], derived: {} },
    /**
     * **This test only ever passed because another file's stub leaked
     * in** — decision 0232.
     *
     * `vi.stubGlobal` is not undone between files, and until every one
     * of them cleaned up, the viewer tests' `fetch` was still installed
     * when this ran. It knew this path; this file did not.
     *
     * So the navigation was never tested against this file's own stub,
     * and *"reaches Tasks from Documents"* went green on somebody
     * else's fixture.
     */
    "/api/invoices/inv-1/document-url": { url: null },
    "/api/invoices/inv-1/progress": { inProcess: false, stages: [] },
    "/api/suppliers": { suppliers: [], lastLoad: null, fedByLoad: false },
    "/api/org/units": { units: [] },
    // **A screen this test now visits** (decision 0244): the navigation
    // covers every tab, and My work was added by decision 0242.
    "/api/dashboard": { cards: [], usingDefault: true },
  });

  const { loadStrings } = await import("/strings.js");
  await loadStrings();
  const { start } = await import("/tasks.js");
  await start();
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  mountShell();
  vi.resetModules();
  // **Cleared for every test, not just this file's own.** localStorage
  // is a real browser global jsdom backs for the whole run, unlike
  // `vi.stubGlobal`'s own state — decision 0274's nav-fold and
  // Vibe-AP-group state both live there now, and a test that sets one
  // must not leak it into the next.
  localStorage.clear();
});

/**
 * **A stub that outlives its file** — decision 0227, applied to every
 * file rather than the one that had the symptom.
 *
 * `vi.stubGlobal` is not undone between files, so whichever ran next
 * inherited this one's `fetch` — and failed **depending on the order
 * the two were scheduled in**.
 */
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("opening a task that cannot be keyed (decision 0142)", () => {
  it("makes the document itself clickable", async () => {
    // **A row names a document**, and looking at one is the first thing
    // anybody wants to do with it. Making that a button among the
    // actions would put navigation where decisions live.
    await openList([APPROVAL_TASK]);

    const link = document.querySelector("button.subjectlink");
    expect(link?.textContent).toBe("Munch GmbH");
  });

  it("offers no disabled buttons", async () => {
    // **Every action works now** (decision 0138). The row listed three
    // and disabled the rest, which was true until the proxy carried
    // them and three routes accepted a session.
    await openList([APPROVAL_TASK]);

    const disabled = [...document.querySelectorAll("td button[disabled]")];
    expect(disabled).toHaveLength(0);
  });

  it("shows the actions the task reports, and no others", async () => {
    await openList([APPROVAL_TASK]);
    const labels = [...document.querySelectorAll("button.act")].map((b) => b.textContent);
    expect(labels).toEqual(["Complete", "Return"]);
  });

  it("does not offer a link for a task with no document", async () => {
    // A task about nothing has nothing to open.
    await openList([{ ...APPROVAL_TASK, subject: null }]);
    expect(document.querySelector("button.subjectlink")).toBeNull();
  });
});

describe("the brand mark (decision 0145)", () => {
  it("sits at the head of the column, above the navigation", async () => {
    // **It sat at the foot first**, on my argument that the top of a
    // sidebar is where somebody looks to move. The operator wanted it
    // at the top, which is the conventional place and the one people
    // look for when orienting themselves rather than navigating —
    // small enough that it does not compete.
    await openList([APPROVAL_TASK]);

    const children = [...(document.querySelector(".nav")?.children ?? [])];
    const firstLink = children.findIndex((c) => c.tagName === "A");
    const mark = children.findIndex((c) => c.classList.contains("brandmark"));

    expect(mark).toBeLessThan(firstLink);
  });

  it("is small enough not to compete with the entries", async () => {
    // A mark at the head of a column orients; one that fills it
    // announces. 84px against a 190px column.
    const css = (await import("virtual:stylesheets")).default["index.html"];
    const rule = css.slice(css.indexOf(".brandmark {"));
    expect(rule).toContain("max-width: 84px");
  });

  it("ships both a dark and a light mark", async () => {
    // **The navy wordmark all but vanishes** on the night surface:
    // #001842 against #0d1626 is a difference of value nobody can read.
    await openList([APPROVAL_TASK]);

    expect(document.querySelector("img.brandmark.dark")).not.toBeNull();
    expect(document.querySelector("img.brandmark.light")).not.toBeNull();
  });

  it("announces nothing to a screen reader", async () => {
    // The name is already in the page title, and "VibeFinance logo"
    // before every navigation is noise rather than information.
    await openList([APPROVAL_TASK]);

    const mark = document.querySelector("img.brandmark") as HTMLImageElement;
    expect(mark.alt).toBe("");
  });
});

describe("the flat nav, permission-filtered (decisions 0274 and 0276)", () => {
  function collapseToggle() {
    return document.querySelector(".navcollapsetoggle") as HTMLButtonElement;
  }
  function frameEl() {
    return document.querySelector(".frame") as HTMLElement;
  }

  it("lists every screen flat, Dashboard first, when every permission is held", async () => {
    /**
     * **The group is gone, decision 0276** — reported live: "I've
     * decided that the sub menu, entitled 'Vibe AP' looks bad... I'd
     * like to revert that change, so that no sub menu exists and the
     * menu items beneath it are always displayed." No `.navgroup`,
     * `.navgrouphead`, or `.navgroupchildren` exists anywhere now.
     */
    await openList([APPROVAL_TASK]);

    expect(document.querySelector(".navgroup")).toBeNull();
    expect(document.querySelector(".navgrouphead")).toBeNull();

    const labels = [...document.querySelectorAll(".navitem")].map((a) => a.textContent);
    expect(labels).toEqual(["Dashboard", "Tasks", "Sources", "Suppliers", "Rules", "Documents"]);
  });

  it("gives every real nav item an icon", async () => {
    await openList([APPROVAL_TASK]);

    const items = [...document.querySelectorAll(".navitem")];
    expect(items).toHaveLength(6);
    for (const item of items) {
      expect(item.querySelector("svg")).not.toBeNull();
    }
  });

  it("carries the optical-centring shift on Tasks and Rules (decision 0277)", async () => {
    /**
     * **Reported live**: "the border on the right of the icons seems
     * larger than that of the left." Checked with an SVG geometry
     * library, not eyeballed: every icon's bounding box was already
     * exactly centred, but Tasks and Rules each concentrate their ink
     * on one side of that box (small, dense shapes on the left; long,
     * sparse lines and curves on the right), pulling the eye's actual
     * centre of mass left of the geometric one — 2.33 units for
     * Tasks, 1.96 for Rules, in a 24-wide box. A `<g transform>` wrap
     * shifts each just enough to bring the ink-weighted centroid back
     * to true centre; confirmed by re-running the same calculation
     * against the shifted geometry, not assumed from the shift alone.
     *
     * This only checks the fix is still present, not that the numbers
     * are still exactly correct — the geometric proof lives in the
     * commit that made this change, not in a browser test that would
     * need to reimplement an SVG path-length calculation to verify.
     */
    await openList([APPROVAL_TASK]);

    const items = [...document.querySelectorAll(".navitem")];
    const tasksSvg = items.find((i) => i.textContent?.includes("Tasks"))?.querySelector("svg");
    const rulesSvg = items.find((i) => i.textContent?.includes("Rules"))?.querySelector("svg");

    expect(tasksSvg?.querySelector('g[transform*="translate"]')).not.toBeNull();
    expect(rulesSvg?.querySelector('g[transform*="translate"]')).not.toBeNull();
  });

  it("starts with the nav open, showing the full mark and every label", async () => {
    await openList([APPROVAL_TASK]);

    expect(frameEl().classList.contains("collapsed")).toBe(false);
    expect(document.querySelector(".navlabel")).not.toBeNull();
  });

  it("folds the whole nav to icons on the collapse toggle, and back", async () => {
    await openList([APPROVAL_TASK]);

    collapseToggle().click();
    expect(frameEl().classList.contains("collapsed")).toBe(true);
    expect(collapseToggle().getAttribute("aria-label")).toBe("Expand the menu");

    collapseToggle().click();
    expect(frameEl().classList.contains("collapsed")).toBe(false);
    expect(collapseToggle().getAttribute("aria-label")).toBe("Collapse the menu");
  });

  it("remembers the fold across a fresh render", async () => {
    await openList([APPROVAL_TASK]);
    collapseToggle().click();
    expect(frameEl().classList.contains("collapsed")).toBe(true);

    await openList([APPROVAL_TASK]);
    expect(frameEl().classList.contains("collapsed")).toBe(true);
  });

  it("hides labels and the full logo when folded, showing the V mark instead", async () => {
    // **Read from the real stylesheet**, this app's established
    // pattern for a CSS effect these tests do not otherwise render —
    // checking the class is present proves the toggle worked; this
    // proves the toggle actually hides what it claims to.
    const css = (await import("virtual:stylesheets")).default["index.html"];
    const rule = css.slice(css.indexOf(".frame.collapsed .navlabel"), css.indexOf(".frame.collapsed .navlabel") + 250);
    expect(rule).toContain("display: none");

    const markRule = css.slice(css.indexOf(".frame.collapsed .navmark"), css.indexOf(".frame.collapsed .navmark") + 60);
    expect(markRule).toContain("display: block");
  });

  it("puts the nav item in a real flex container, not one that lost to .nav a", async () => {
    /**
     * **The actual bug, decision 0278.** Reported live: an icon in the
     * folded nav sat well left of centre despite `justify-content:
     * center` existing exactly for this case. Confirmed with a real
     * specificity calculator, not eyeballed: `.nav a` computes to
     * (0,1,1) — the element selector "a" counts — against `.navitem`
     * alone at (0,1,0). `.nav a`'s own `display: block` was winning
     * over `.navitem`'s `display: flex` the whole time, which meant
     * every flex property on it — `align-items`, `gap`, and the
     * collapsed override's own `justify-content: center` — had no
     * flex container to act on. The exact same class of mistake as
     * decision 0275's brandmark fix, on a different property.
     *
     * Fixed by scoping the rule as `.nav .navitem`, reaching (0,2,0) —
     * clearly ahead of `.nav a`'s (0,1,1), not merely tied to it and
     * left to source order.
     */
    const css = (await import("virtual:stylesheets")).default["index.html"];
    // The bare, losing selector must be gone, not just superseded —
    // leaving both would tempt a future edit to "simplify" back to it.
    expect(css).not.toContain("\n  .navitem {");
    expect(css).toContain(".nav .navitem {");
  });

  it("hides the full logo at a specificity that actually beats the mood rules", async () => {
    /**
     * **Reported live**: a screenshot of the folded nav showed the
     * full "Vibe finance" wordmark still sitting above the "V" mark,
     * not replaced by it.
     *
     * `.frame.collapsed .brandmark { display: none; }` — three
     * class-level selectors — lost every time to whichever mood rule
     * was active, e.g. `:root[data-mood="day"] .brandmark.dark {
     * display: block; }`, which carries four. CSS does not care which
     * rule comes later in the file when one has lower specificity;
     * jsdom applies no CSS at all, so no test caught this before a
     * real screenshot did.
     *
     * Confirmed with an actual specificity calculator (the `specificity`
     * npm package), not eyeballed: the old three-class rule computed
     * to {A:0,B:3,C:0} against the mood rules' {A:0,B:4,C:0}. The fix
     * names `.dark` and `.light` explicitly to tie at four, so this
     * test checks for exactly that — a rule this specific existing,
     * later in the file than the mood rules it has to beat.
     */
    const css = (await import("virtual:stylesheets")).default["index.html"];

    const dayIndex = css.indexOf(':root[data-mood="day"] .brandmark.dark');
    const nightIndex = css.indexOf(':root[data-mood="night"] .brandmark.light');
    const fixIndex = css.indexOf(".frame.collapsed .brandmark.dark");
    expect(dayIndex).toBeGreaterThan(-1);
    expect(nightIndex).toBeGreaterThan(-1);
    expect(fixIndex).toBeGreaterThan(-1);

    // Tied specificity is broken by source order — this rule has to
    // come after both of the ones it is competing with.
    expect(fixIndex).toBeGreaterThan(dayIndex);
    expect(fixIndex).toBeGreaterThan(nightIndex);

    // The light variant needs the same treatment, for the same reason.
    expect(css.slice(fixIndex, fixIndex + 120)).toContain(".frame.collapsed .brandmark.light");
  });

  it("navigating to another screen does not collapse the toggle back to closed", async () => {
    // Toggling the nav must not depend on which screen is open, since
    // nothing about `frame()`'s own call site changes when it does.
    //
    // **Waits for the real thing, not a tick** — decision 0249's own
    // lesson, found again: a fixed `setTimeout(r, 0)` here left
    // `go("dashboard")`'s own async chain (a dynamic import, then a
    // fetch) still in flight when this test completed, and it bled
    // into whichever test ran next rather than this one failing.
    await openList([APPROVAL_TASK]);
    collapseToggle().click();
    expect(frameEl().classList.contains("collapsed")).toBe(true);

    const dashboardLink = [...document.querySelectorAll(".nav a")].find(
      (a) => a.textContent === "Dashboard"
    ) as HTMLElement;
    dashboardLink.click();
    for (let i = 0; i < 100; i++) {
      if (document.querySelector(".nav a.on")?.textContent === "Dashboard") break;
      await new Promise((r) => setTimeout(r, 10));
    }

    expect(document.querySelector(".frame")?.classList.contains("collapsed")).toBe(true);
  });

  it("hides a nav item when the required permission is missing", async () => {
    /**
     * **The actual new behaviour, decision 0276** — the operator's own
     * instruction to underpin the nav with real permissions. Rules
     * requires Admin.RuleManagement; a person without it should never
     * see the nav item at all, not just be refused after clicking it.
     */
    stubFetch({
      "/api/ui-strings": STRINGS,
      "/api/whoami": {
        id: "u-dan",
        name: "Dan",
        permissions: ALL_NAV_PERMISSIONS.filter((p) => p !== "Admin.RuleManagement"),
      },
      "/api/tasks": { tasks: [APPROVAL_TASK], counts: {} },
      "/api/sources": { sources: [] },
      "/api/processes": { processes: [] },
      "/api/rules": { rules: [] },
      "/api/rules/stages": { stages: [] },
      "/api/dashboard": { cards: [], usingDefault: true },
    });
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { start } = await import("/tasks.js");
    await start();

    const labels = [...document.querySelectorAll(".navitem")].map((a) => a.textContent);
    expect(labels).not.toContain("Rules");
    expect(labels).toEqual(["Dashboard", "Tasks", "Sources", "Suppliers", "Documents"]);
  });

  it("shows nothing but the logo for a person with none of the six permissions", async () => {
    // An account with no AP role assigned yet is a real, expected
    // state — not a bug to guard against with a fallback screen.
    stubFetch({
      "/api/ui-strings": STRINGS,
      "/api/whoami": { id: "u-dan", name: "Dan", permissions: [] },
      "/api/tasks": { tasks: [APPROVAL_TASK], counts: {} },
    });
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { start } = await import("/tasks.js");
    await start();

    expect(document.querySelectorAll(".navitem")).toHaveLength(0);
    expect(document.querySelector("img.brandmark")).not.toBeNull();
  });

  it("shows exactly the items each permission unlocks, one at a time", async () => {
    const cases: [string, string][] = [
      ["AP.Dashboard", "Dashboard"],
      ["AP.TaskView", "Tasks"],
      ["Admin.Configure", "Sources"],
      ["AP.Supplier", "Suppliers"],
      ["Admin.RuleManagement", "Rules"],
      ["AP.Review", "Documents"],
    ];
    for (const [permission, label] of cases) {
      stubFetch({
        "/api/ui-strings": STRINGS,
        "/api/whoami": { id: "u-dan", name: "Dan", permissions: [permission] },
        "/api/tasks": { tasks: [], counts: {} },
      });
      const { loadStrings } = await import("/strings.js");
      await loadStrings();
      const { start } = await import("/tasks.js");
      await start();

      const labels = [...document.querySelectorAll(".navitem")].map((a) => a.textContent);
      expect(labels, `permission ${permission}`).toEqual([label]);
    }
  });
});

describe("the nav stays pinned to the browser window, not the page (decision 0281)", () => {
  /**
   * **Reported live**: "align the side panel bottom, with the bottom
   * of the browser size. this will ensure that user, and instance are
   * always visible, and not hidden from view." `.nav` was a grid cell
   * that stretched to match `.main`'s own height, so on a page tall
   * enough to scroll, `.who` (signed-in name and environment) could
   * sit far below the visible window rather than at the bottom of it.
   *
   * jsdom applies no CSS, so these read the real stylesheet text
   * rather than assert a scroll position no test here can produce.
   */
  it("pins the nav to the viewport with an explicit, non-stretched height", async () => {
    const css = (await import("virtual:stylesheets")).default["index.html"];
    const rule = css.slice(css.indexOf(".nav {\n    display: flex;"), css.indexOf(".nav .who { margin-top: auto; }"));

    expect(rule).toContain("position: sticky");
    expect(rule).toContain("top: 0");
    expect(rule).toContain("height: 100vh");
    // Without this, the grid's own default stretch would override the
    // explicit height above with the row's taller one regardless.
    expect(rule).toContain("align-self: start");
  });

  it("undoes the sticky sidebar once the nav becomes a horizontal bar on a narrow screen", async () => {
    const css = (await import("virtual:stylesheets")).default["index.html"];
    const mediaStart = css.indexOf("@media (max-width: 1100px)");
    const mediaBlock = css.slice(mediaStart, css.indexOf("}", css.indexOf("}", css.indexOf("}", mediaStart) + 1) + 1) + 1);

    expect(mediaBlock).toContain("position: static");
    expect(mediaBlock).toContain("height: auto");
  });
});

describe("a task about one line (decision 0183)", () => {
  /**
   * A stage scoped `per_line` raises one task per invoice line, so an
   * eight-line invoice produces eight rows naming the same supplier,
   * the same amount and the same stage.
   *
   * **Eight identical rows teach somebody the list is broken.**
   */
  it("names the line beside the supplier", async () => {
    await openList([
      { ...APPROVAL_TASK, lineNumber: 3 },
    ]);
    expect(document.body.textContent).toContain("line 3");
  });

  it("says nothing where a task is about the whole document", async () => {
    await openList([APPROVAL_TASK]);
    expect(document.body.textContent).not.toContain("line ");
  });
});

describe("every screen can reach every other (decision 0191)", () => {
  /**
   * **Tasks was unreachable from Sources, Rules and Documents.**
   *
   * `go("tasks")` called `loadTasks()` alone, which fetches and updates
   * the table — right when Tasks is already on screen, and nothing at
   * all when it is not. The other three branches each rebuild the
   * shell; this one assumed it was already rendered, which was true
   * when it was the only screen.
   */
  /**
   * **Wait for the screen, not for a duration** — decision 0249.
   *
   * This slept 40ms after each click, which is a guess about how long a
   * dynamic import and two stubbed fetches take. **It was enough alone
   * and not enough in a full run**, so the test failed depending on
   * what else was running — reported three times as a mystery, twice
   * papered over, and recorded as not understood in decision 0244.
   *
   * A fixed sleep in an async test is a race with a number on it.
   */
  async function until(condition: () => boolean, what: string) {
    for (let i = 0; i < 100; i++) {
      if (condition()) return;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`waited a second and ${what} never happened`);
  }

  const highlighted = () => document.querySelector(".nav a.on")?.textContent;

  async function navigateFrom(screen: string) {
    await openList([APPROVAL_TASK]);

    const link = [...document.querySelectorAll(".nav a")].find(
      (a) => a.textContent === screen
    ) as HTMLElement;
    link.click();
    await until(() => highlighted() === screen, `${screen} never became current`);

    const back = [...document.querySelectorAll(".nav a")].find(
      (a) => a.textContent === "Tasks"
    ) as HTMLElement;
    back.click();
    await until(() => highlighted() === "Tasks", "Tasks never became current again");
  }

  it("reaches Tasks from Sources", async () => {
    await navigateFrom("Sources");
    expect(document.querySelector(".nav a.on")?.textContent).toBe("Tasks");
  });

  it("reaches Tasks from Rules", async () => {
    await navigateFrom("Rules");
    expect(document.querySelector(".nav a.on")?.textContent).toBe("Tasks");
  });

  it("reaches Tasks from Documents", async () => {
    await navigateFrom("Documents");
    expect(document.querySelector(".nav a.on")?.textContent).toBe("Tasks");
  });

  it("puts the task table back, not just the navigation", async () => {
    // **The whole point**: marking the entry without rebuilding the
    // screen is what made this look like a dead link.
    await navigateFrom("Rules");
    expect(document.querySelector("table")).not.toBeNull();
  });
});

describe("the ownership dropdown shows the filter in force (decision 0256)", () => {
  /**
   * **Reported by using it.** Clicking a dashboard card opened the task
   * list correctly filtered to *mine*, and the dropdown kept reading
   * *Everything* — so five items on screen looked like all of them
   * when a filter was hiding the rest.
   *
   * Decision 0254 fixed exactly this for the stage select and left
   * `ownership` with the same fault: `value` was set at construction,
   * before any `option` existed for it to bind to.
   */
  it("reads mine when opened filtered to mine", async () => {
    /**
     * **`openTasksFiltered` is only ever called from a running
     * dashboard**, where `start()` has already populated the signed-in
     * user. Calling it cold — as the first version of this test did —
     * hits a null `me` that never occurs in real use.
     *
     * `start()` first, as the app itself always does.
     */
    stubFetch({
      "/api/ui-strings": STRINGS,
      "/api/whoami": { id: "u-dan", name: "Dan", permissions: ALL_NAV_PERMISSIONS },
      "/api/tasks": { tasks: [], counts: {} },
      "/api/dashboard": { cards: [], usingDefault: true },
    });

    mountShell();
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { start, openTasksFiltered } = await import("/tasks.js");
    await start();
    await openTasksFiltered({ stage: "approval", ownership: "mine" });

    const selects = document.querySelectorAll(".filters select");
    const ownership = selects[1] as HTMLSelectElement;

    expect(ownership.value).toBe("mine");
  });

  it("reads the stage the same way, unaffected by this fix", async () => {
    /**
     * Decision 0254's fix, still standing. The stage select only ever
     * offers stages it has **seen** in real rows (`knownStages`), so a
     * task at Approval must be in the stub for that option to exist —
     * unlike ownership, whose four options are fixed and always
     * present.
     */
    stubFetch({
      "/api/ui-strings": STRINGS,
      "/api/whoami": { id: "u-dan", name: "Dan", permissions: ALL_NAV_PERMISSIONS },
      // The file's own complete fixture, already at approval/mine.
      "/api/tasks": { tasks: [APPROVAL_TASK], counts: {} },
      "/api/dashboard": { cards: [], usingDefault: true },
    });

    mountShell();
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { start, openTasksFiltered } = await import("/tasks.js");
    await start();
    await openTasksFiltered({ stage: "approval", ownership: "mine" });

    const stages = document.querySelectorAll(".filters select")[0] as HTMLSelectElement;
    expect(stages.value).toBe("approval");
  });

  it("reads everything when opened with no filter", async () => {
    // The default case must not regress: an empty filter is a real
    // value, not the absence of one.
    stubFetch({
      "/api/ui-strings": STRINGS,
      "/api/whoami": { id: "u-dan", name: "Dan", permissions: ALL_NAV_PERMISSIONS },
      "/api/tasks": { tasks: [], counts: {} },
    });

    mountShell();
    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { start } = await import("/tasks.js");
    await start();

    const ownership = document.querySelectorAll(".filters select")[1] as HTMLSelectElement;
    expect(ownership.value).toBe("");
  });
});
