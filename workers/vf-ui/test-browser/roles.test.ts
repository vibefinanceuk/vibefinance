import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Who can do what, where, and up to how much — decisions 0319, 0326.
 *
 * **Read-only half, decision 0319**, and now the write half too:
 * creating a role and editing what an existing one grants, gated to
 * `Admin.RoleManagement`.
 */

function mountShell() {
  document.body.innerHTML = `<main id="shell"></main><main id="viewer" hidden></main>`;
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
    "nav.roles": "Roles",
    "roles.subtitle": "Who can do what, where, and up to how much",
    "roles.units": "Org units",
    "roles.nounits": "No org units configured yet.",
    "roles.kind": "Kind",
    "roles.roles": "Roles",
    "roles.norolesconfigured": "No roles configured yet.",
    "roles.permissions": "Permissions",
    "roles.nopermissions": "No permissions granted.",
    "roles.people": "People",
    "roles.nopeople": "No people configured yet.",
    "roles.assignments": "Roles held",
    "roles.limits": "Approval limits",
    "roles.noassignments": "Holds no role.",
    "roles.nolimits": "No limit set.",
    "roles.everywhere": "everywhere",
    "roles.loadfailed": "We could not load this screen. Try again in a moment.",
    "roles.roleid": "Role ID",
    "roles.roleidhelp": "A short, permanent identifier. Cannot be changed later.",
    "roles.rolename": "Name",
    "roles.create": "Create",
    "roles.save": "Save",
    "roles.edit": "Edit role",
    "roles.changefailed": "Could not save the role. Please try again.",
    "action.newrole": "New role",
    "action.close": "Close",
    "column.unit": "Unit",
    "column.role": "Role",
    "column.person": "Person",
  },
};

function stubFetch(routes: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url).split("?")[0];
      const key = init?.method && init.method !== "GET" ? `${init.method} ${path}` : path;
      if (key in routes) {
        const value = routes[key];
        if (value && typeof value === "object" && "status" in (value as object)) {
          return value as Response;
        }
        return { ok: true, json: async () => value } as Response;
      }
      throw new Error(`no stub for ${key}`);
    })
  );
}

beforeEach(() => {
  mountShell();
  vi.unstubAllGlobals();
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const EMPTY = { units: [], users: [], roles: [], assignments: [], authorityLimits: [], knownPermissions: [] };

async function openRoles(body: unknown) {
  stubFetch({ "/api/ui-strings": STRINGS, "/api/org/overview": body });
  const { loadStrings } = await import("/strings.js");
  await loadStrings();
  const { open } = await import("/roles.js");
  await open();
}

/**
 * **The write-enabled path — decision 0326.** Real usage always
 * reaches a screen through `start()` first, which is what actually
 * populates `me` — the same gap `rules.test.ts` already found and
 * fixed for itself: calling `roles.js`'s own `open()` directly skips
 * `start()` entirely, so `me` stays `null` and `hasMyPermission`
 * returns `false` for everything, same as somebody holding nothing.
 */
async function openRolesAs(permissions: string[], body: unknown, extraRoutes: Record<string, unknown> = {}) {
  stubFetch({
    "/api/ui-strings": STRINGS,
    "/api/whoami": { id: "u-dan", name: "Dan", permissions },
    "/api/tasks": { tasks: [], counts: {} },
    "/api/org/overview": body,
    ...extraRoutes,
  });
  const { loadStrings } = await import("/strings.js");
  await loadStrings();
  const { start } = await import("/tasks.js");
  await start();
  const { open } = await import("/roles.js");
  await open();
}

describe("the screen opens at all", () => {
  it("renders into the shell", async () => {
    await openRoles(EMPTY);
    expect(document.getElementById("shell")?.textContent).toContain("Roles");
  });

  it("shows a real error, and keeps the nav reachable, when the load fails (decision 0322)", async () => {
    /**
     * **Reported live**: "the Roles menu option does not launch
     * anything." `open()` used to return silently on a failed
     * request, leaving `#shell` exactly as it was — a click that
     * visibly did nothing.
     */
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const path = String(url).split("?")[0];
        if (path === "/api/ui-strings") return { ok: true, json: async () => STRINGS } as Response;
        if (path === "/api/org/overview") return { ok: false, status: 500, json: async () => ({}) } as Response;
        throw new Error(`no stub for ${path}`);
      })
    );

    const { loadStrings } = await import("/strings.js");
    await loadStrings();
    const { open } = await import("/roles.js");
    await open();

    const shell = document.getElementById("shell");
    expect(shell?.textContent).toContain("We could not load this screen");
    expect(shell?.querySelector(".nav")).not.toBeNull();
  });
});

describe("org units", () => {
  it("shows a top-level unit with no indent", async () => {
    await openRoles({ ...EMPTY, units: [{ id: "u1", name: "Acme Group", kind: "legal_entity", parentUnitId: null }] });

    const cell = document.querySelector(".panel td span") as HTMLElement;
    expect(cell.style.paddingLeft).toBe("0px");
    expect(cell.textContent).toBe("Acme Group");
  });

  it("indents a child unit beneath its own parent", async () => {
    await openRoles({
      ...EMPTY,
      units: [
        { id: "u1", name: "Acme Group", kind: "legal_entity", parentUnitId: null },
        { id: "u2", name: "Acme France", kind: "legal_entity", parentUnitId: "u1" },
      ],
    });

    const cells = [...document.querySelectorAll(".panel")[0].querySelectorAll("td span")];
    const france = cells.find((c) => c.textContent === "Acme France") as HTMLElement;
    expect(france.style.paddingLeft).toBe("20px");
  });

  it("shows the empty message when no units are configured", async () => {
    await openRoles(EMPTY);
    expect(document.getElementById("shell")?.textContent).toContain("No org units configured yet.");
  });
});

describe("roles and their permissions", () => {
  it("joins a role's own permissions into one readable list", async () => {
    await openRoles({ ...EMPTY, roles: [{ id: "r1", name: "AP Manager", permissions: ["AP.Approve", "AP.Review"] }] });

    expect(document.getElementById("shell")?.textContent).toContain("AP.Approve, AP.Review");
  });

  it("shows a role with no permissions distinctly, not as an empty cell", async () => {
    await openRoles({ ...EMPTY, roles: [{ id: "r1", name: "Empty Role", permissions: [] }] });

    expect(document.getElementById("shell")?.textContent).toContain("No permissions granted.");
  });
});

describe("people, their role assignments, and their own approval limits", () => {
  const PEOPLE_BODY = {
    ...EMPTY,
    users: [{ id: "usr1", email: "alice@acme.com", name: "Alice", unitId: null, status: "active" }],
    assignments: [
      { userId: "usr1", userName: "Alice", roleId: "r1", roleName: "AP Manager", unitId: "u1", unitName: "Acme France", grantedAt: "" },
    ],
    authorityLimits: [{ userId: "usr1", userName: "Alice", currency: "EUR", maxAmount: 5000 }],
  };

  it("shows a person's own assignment, named to a real unit", async () => {
    await openRoles(PEOPLE_BODY);
    expect(document.getElementById("shell")?.textContent).toContain("AP Manager — Acme France");
  });

  it("shows an unscoped assignment as held everywhere, not blank", async () => {
    await openRoles({
      ...PEOPLE_BODY,
      assignments: [
        { userId: "usr1", userName: "Alice", roleId: "r1", roleName: "AP Manager", unitId: null, unitName: null, grantedAt: "" },
      ],
    });
    expect(document.getElementById("shell")?.textContent).toContain("AP Manager — everywhere");
  });

  it("shows a person's own approval limit", async () => {
    await openRoles(PEOPLE_BODY);
    expect(document.getElementById("shell")?.textContent).toContain("EUR 5000");
  });

  it("shows a person holding no role and no limit distinctly, not blank cells", async () => {
    await openRoles({ ...EMPTY, users: [{ id: "usr1", email: "bob@acme.com", name: "Bob", unitId: null, status: "active" }] });

    const text = document.getElementById("shell")?.textContent ?? "";
    expect(text).toContain("Holds no role.");
    expect(text).toContain("No limit set.");
  });

  it("does not borrow one person's own limit for another with the same role", async () => {
    // **The operator's own confirmation**: an approval limit belongs
    // to the person, not the role they hold — two people holding the
    // same role can carry different limits, or none at all.
    await openRoles({
      ...EMPTY,
      users: [
        { id: "usr1", email: "alice@acme.com", name: "Alice", unitId: null, status: "active" },
        { id: "usr2", email: "bob@acme.com", name: "Bob", unitId: null, status: "active" },
      ],
      assignments: [
        { userId: "usr1", userName: "Alice", roleId: "r1", roleName: "AP Manager", unitId: null, unitName: null, grantedAt: "" },
        { userId: "usr2", userName: "Bob", roleId: "r1", roleName: "AP Manager", unitId: null, unitName: null, grantedAt: "" },
      ],
      authorityLimits: [{ userId: "usr1", userName: "Alice", currency: "EUR", maxAmount: 5000 }],
    });

    const bobRow = [...document.querySelectorAll("tr")].find((r) => r.textContent?.includes("Bob"));
    expect(bobRow?.textContent).toContain("No limit set.");
    expect(bobRow?.textContent).not.toContain("5000");
  });
});

describe("write controls are gated to Admin.RoleManagement — decision 0326", () => {
  const ONE_ROLE = { ...EMPTY, roles: [{ id: "r1", name: "AP Manager", permissions: ["AP.Approve"] }] };

  it("shows no New role button without the permission", async () => {
    await openRolesAs(["AP.Dashboard"], ONE_ROLE);
    const shell = document.getElementById("shell");
    expect([...(shell?.querySelectorAll("button") ?? [])].some((b) => b.textContent?.includes("New role"))).toBe(
      false
    );
  });

  it("a role row does nothing on click without the permission", async () => {
    await openRolesAs(["AP.Dashboard"], ONE_ROLE);
    const row = [...document.querySelectorAll("tr")].find((r) => r.textContent?.includes("AP Manager"));
    row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(document.querySelector(".backdrop")).toBeNull();
  });

  it("shows a New role button when holding Admin.RoleManagement", async () => {
    await openRolesAs(["Admin.RoleManagement"], ONE_ROLE);
    const shell = document.getElementById("shell");
    expect([...(shell?.querySelectorAll("button") ?? [])].some((b) => b.textContent?.includes("New role"))).toBe(
      true
    );
  });

  it("opens the edit form when clicking a role, holding the permission", async () => {
    await openRolesAs(["Admin.RoleManagement"], ONE_ROLE);
    const row = [...document.querySelectorAll("tr")].find((r) => r.textContent?.includes("AP Manager"));
    row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(document.querySelector(".backdrop")).not.toBeNull();
    expect(document.body.textContent).toContain("Edit role");
  });
});

describe("creating a role — decision 0326", () => {
  const KNOWN = ["AP.Approve", "AP.Review", "Admin.RoleManagement"];

  it("opens a fresh form with every known permission unchecked", async () => {
    await openRolesAs(["Admin.RoleManagement"], { ...EMPTY, knownPermissions: KNOWN });
    const button = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("New role"));
    button?.click();

    expect(document.body.textContent).toContain("New role");
    const boxes = [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    expect(boxes).toHaveLength(3);
    expect(boxes.every((b) => !b.checked)).toBe(true);
  });

  it("groups permissions by their own category", async () => {
    await openRolesAs(["Admin.RoleManagement"], { ...EMPTY, knownPermissions: KNOWN });
    const button = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("New role"));
    button?.click();

    const groupHeadings = [...document.querySelectorAll(".permissiongroup h4")].map((h) => h.textContent);
    expect(groupHeadings).toEqual(["AP", "Admin"]);
  });

  it("posts the entered id, name, and checked permissions, then reloads", async () => {
    await openRolesAs(["Admin.RoleManagement"], { ...EMPTY, knownPermissions: KNOWN }, {
      "POST /api/org/roles": { ok: true, json: async () => ({}) },
    });

    const button = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("New role"));
    button?.click();

    const idInput = document.querySelector<HTMLInputElement>(".editgrid input") as HTMLInputElement;
    const nameInput = document.querySelectorAll<HTMLInputElement>(".editgrid input")[1];
    idInput.value = "new-role";
    nameInput.value = "New Role";
    const approveBox = [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find(
      (b) => b.nextElementSibling?.textContent === "AP.Approve"
    ) as HTMLInputElement;
    approveBox.checked = true;

    const submit = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Create"));
    await submit?.click();
    await new Promise((r) => setTimeout(r, 0));

    const calls = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const postCall = calls.find(([url, init]) => url === "/api/org/roles" && (init as RequestInit)?.method === "POST");
    const posted = JSON.parse((postCall?.[1] as RequestInit).body as string);
    expect(posted).toEqual({ id: "new-role", name: "New Role", permissions: ["AP.Approve"] });

    // The popout closed — proof the success path ran, not just that
    // the request was sent.
    expect(document.querySelector(".backdrop")).toBeNull();
  });

  it("shows the real error and leaves the form open when the request fails", async () => {
    await openRolesAs(["Admin.RoleManagement"], { ...EMPTY, knownPermissions: KNOWN }, {
      "POST /api/org/roles": { ok: false, status: 422, json: async () => ({ error: "not a real permission" }) },
    });

    const button = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("New role"));
    button?.click();
    const idInput = document.querySelector<HTMLInputElement>(".editgrid input") as HTMLInputElement;
    idInput.value = "new-role";

    const submit = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Create"));
    await submit?.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(document.querySelector(".backdrop")).not.toBeNull();
    expect(document.body.textContent).toContain("not a real permission");
  });

  it("closes without saving anything", async () => {
    await openRolesAs(["Admin.RoleManagement"], { ...EMPTY, knownPermissions: KNOWN });
    const button = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("New role"));
    button?.click();
    expect(document.querySelector(".backdrop")).not.toBeNull();

    const close = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Close"));
    close?.click();
    expect(document.querySelector(".backdrop")).toBeNull();
  });
});

describe("editing an existing role — decision 0326", () => {
  const EXISTING_ROLE = { id: "r1", name: "AP Manager", permissions: ["AP.Approve"] };
  const KNOWN = ["AP.Approve", "AP.Review"];

  function openEditForm() {
    const row = [...document.querySelectorAll("tr")].find((r) => r.textContent?.includes("AP Manager"));
    row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  }

  it("pre-fills the role's own name and checks its own held permissions only", async () => {
    await openRolesAs(["Admin.RoleManagement"], { ...EMPTY, roles: [EXISTING_ROLE], knownPermissions: KNOWN });
    openEditForm();

    const nameInput = document.querySelectorAll<HTMLInputElement>(".editgrid input")[1];
    expect(nameInput.value).toBe("AP Manager");

    const approveBox = [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find(
      (b) => b.nextElementSibling?.textContent === "AP.Approve"
    ) as HTMLInputElement;
    const reviewBox = [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find(
      (b) => b.nextElementSibling?.textContent === "AP.Review"
    ) as HTMLInputElement;
    expect(approveBox.checked).toBe(true);
    expect(reviewBox.checked).toBe(false);
  });

  it("shows the role's own id, disabled — not editable through this form", async () => {
    await openRolesAs(["Admin.RoleManagement"], { ...EMPTY, roles: [EXISTING_ROLE], knownPermissions: KNOWN });
    openEditForm();

    const idInput = document.querySelector<HTMLInputElement>(".editgrid input") as HTMLInputElement;
    expect(idInput.value).toBe("r1");
    expect(idInput.disabled).toBe(true);
  });

  it("PUTs the edited name and full replaced permission list to the role's own id", async () => {
    await openRolesAs(["Admin.RoleManagement"], { ...EMPTY, roles: [EXISTING_ROLE], knownPermissions: KNOWN }, {
      "PUT /api/org/roles/r1": { ok: true, json: async () => ({}) },
    });
    openEditForm();

    const nameInput = document.querySelectorAll<HTMLInputElement>(".editgrid input")[1];
    nameInput.value = "AP Manager, Renamed";
    const reviewBox = [...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].find(
      (b) => b.nextElementSibling?.textContent === "AP.Review"
    ) as HTMLInputElement;
    reviewBox.checked = true;

    const submit = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Save"));
    await submit?.click();
    await new Promise((r) => setTimeout(r, 0));

    const calls = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const putCall = calls.find(([url, init]) => url === "/api/org/roles/r1" && (init as RequestInit)?.method === "PUT");
    const body = JSON.parse((putCall?.[1] as RequestInit).body as string);
    expect(body).toEqual({ name: "AP Manager, Renamed", permissions: ["AP.Approve", "AP.Review"] });
  });
});
