import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **The first screen after signing in — decision 0594.** Reported live:
 * an administrator whose role held configuration permissions only (the
 * AP ones removed from Administrator (Global)) signed in to a blank page.
 * Without `AP.Dashboard` the app fell back to Tasks, which needs
 * `AP.TaskView`; refused, nothing at all was drawn, not even the menu.
 */

const STRINGS = {
  locale: "en",
  strings: {
    "nav.access": "Access",
    "nav.tasks": "Tasks",
    "nav.routemonitor": "Route monitor",
    "roles.subtitle": "Who can do what, where, and up to how much",
    "tasks.nothingopen": "Nothing here is open to you yet. Ask an administrator to give you a role.",
    "tasks.loadfailed": "The tasks could not be loaded.",
  },
};

type Seen = string[];
function stub(seen: Seen, permissions: string[], extra: Record<string, unknown> = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const path = String(url).split("?")[0];
      seen.push(path);
      if (path === "/api/ui-strings") return { ok: true, json: async () => STRINGS } as Response;
      if (path === "/api/whoami") return { ok: true, json: async () => ({ id: "u-new", name: "New admin", permissions }) } as Response;
      if (path in extra) return { ok: true, json: async () => extra[path] } as Response;
      // What a person without the permission is told.
      return { ok: false, status: 403, json: async () => ({ error: "forbidden" }) } as Response;
    })
  );
}

async function signIn() {
  const { loadStrings } = await import("/strings.js");
  await loadStrings();
  const { start } = await import("/tasks.js");
  return start();
}

beforeEach(() => {
  document.body.innerHTML = `<main id="shell"></main><main id="viewer" hidden></main>`;
  vi.resetModules();
});
afterEach(() => vi.unstubAllGlobals());

describe("the first screen after signing in — decision 0594", () => {
  it("opens Access for an administrator who holds configuration permissions only, never a blank page", async () => {
    const seen: Seen = [];
    stub(seen, ["Admin.Configure", "Admin.UserManagement", "Admin.RoleManagement"], {
      "/api/org/overview": { units: [], users: [], roles: [], assignments: [], authorityLimits: [], knownPermissions: [] },
      "/api/org/teams": { teams: [] },
      "/api/org/users/invitations": { invitations: [] },
    });
    expect(await signIn()).toBe(true);
    expect(seen).not.toContain("/api/tasks");
    expect(document.querySelector(".topbar h2")?.textContent).toBe("Access");
    expect(document.querySelector(".navitem.on")?.textContent).toBe("Access");
  });

  it("opens the first screen in the menu a person may open, such as the Route monitor", async () => {
    const seen: Seen = [];
    stub(seen, ["Integration.Monitor"], { "/api/route-messages": { messages: [], sources: [], destinations: [], total: 0, counts: {} }, "/api/route-alerts": { alerts: [] } });
    await signIn();
    expect(seen).not.toContain("/api/tasks");
    expect(document.querySelector(".navitem.on")?.textContent).toBe("Route monitor");
  });

  it("says nothing is open yet, with the menu frame, for someone holding no screen at all", async () => {
    stub([], []);
    await signIn();
    expect(document.getElementById("nothing-open")?.textContent).toBe("Nothing here is open to you yet. Ask an administrator to give you a role.");
    expect(document.querySelector(".frame")).not.toBeNull();
  });

  it("still opens Tasks for someone who may see it, and says so when its list cannot be loaded", async () => {
    stub([], ["AP.TaskView"]);
    await signIn();
    expect(document.querySelector(".navitem.on")?.textContent).toBe("Tasks");
    expect(document.getElementById("shell")?.textContent).toContain("The tasks could not be loaded.");
  });
});
