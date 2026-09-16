import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `boot.js` — decision 0103, and decision 0360's own fix within it.
 *
 * **Reported live**: "It's initial width is narrow on the page
 * though. When I click tasks and then dashboard again, it resizes to
 * full width." `body`'s own default centres its content for the
 * sign-in form; `body.working` switches to the full-width layout the
 * signed-in app needs. Until this fix, the only place that ever added
 * it was `tasks.js`'s own `render()` — true only because `start()`
 * used to render Tasks unconditionally. Decision 0359 gave it a
 * second, equally valid destination (the Dashboard) that never
 * touched `body` at all, so anyone landing there first kept the
 * sign-in page's own centred, fit-content layout until some other
 * navigation happened to touch Tasks and add the class for the first
 * time.
 */

function mountBootDom() {
  document.body.innerHTML = `
    <main id="signin-view" hidden>
      <form id="signin">
        <input id="email" />
        <input id="password" />
        <select id="environment"></select>
        <button id="submit"></button>
        <p id="problem"></p>
        <a id="brand"></a>
        <span id="since"></span>
      </form>
    </main>
    <main id="shell" hidden>
      <span id="product"></span>
    </main>
  `;
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
    "product.name": "Vibe Finance",
    "nav.tasks": "Tasks",
    "nav.dashboard": "Dashboard",
  },
};

beforeEach(() => {
  mountBootDom();
  vi.resetModules();
});

describe("body's own working class, set once regardless of which screen renders first (decision 0360)", () => {
  async function waitForWorking() {
    for (let i = 0; i < 100; i++) {
      if (document.body.classList.contains("working")) return;
      await new Promise((r) => setTimeout(r, 10));
    }
  }

  it("is added when start() lands on the Dashboard, not only on Tasks", async () => {
    stubFetch({
      "/api/ui-strings": STRINGS,
      "/api/whoami": { id: "u-dan", name: "Dan", permissions: ["AP.Dashboard"] },
      "/api/dashboard": { cards: [], usingDefault: true },
    });

    await import("/boot.js");
    await waitForWorking();

    expect(document.body.classList.contains("working")).toBe(true);
  });

  it("is added just the same when start() falls back to Tasks", async () => {
    stubFetch({
      "/api/ui-strings": STRINGS,
      "/api/whoami": { id: "u-dan", name: "Dan", permissions: ["AP.TaskView"] },
      "/api/tasks": { tasks: [], counts: {} },
    });

    await import("/boot.js");
    await waitForWorking();

    expect(document.body.classList.contains("working")).toBe(true);
  });

  it("is not added when nobody is signed in, so the sign-in form stays centred", async () => {
    // /api/whoami answers ok: false for a signed-out visitor.
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const path = String(url).split("?")[0];
        if (path === "/api/ui-strings") return { ok: true, json: async () => STRINGS } as Response;
        if (path === "/api/whoami") return { ok: false, json: async () => ({}) } as Response;
        throw new Error(`no stub for ${path}`);
      })
    );

    await import("/boot.js");
    // Nothing here ever adds the class, so there is no positive event
    // to poll for — a fixed settle window is the right tool.
    await new Promise((r) => setTimeout(r, 50));

    expect(document.body.classList.contains("working")).toBe(false);
  });
});
