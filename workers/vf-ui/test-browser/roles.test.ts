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
    "roles.role": "Role",
    "roles.org": "Organisation",
    "roles.assign": "Assign",
    "roles.remove": "Remove",
    "roles.assignfailed": "Could not assign the role. Please try again.",
    "roles.revokefailed": "Could not remove the role. Please try again.",
    "roles.currentassignments": "Current assignments",
    "roles.newassignment": "New assignment",
    "action.newperson": "New person",
    "action.create": "Create",
    "action.assign": "Assign",
    "action.done": "Done",
    "roles.personname": "Name",
    "roles.personemail": "Email",
    "roles.personorg": "Organisation",
    "roles.limitcurrency": "Currency",
    "roles.limitamount": "Approval limit",
    "roles.apikeywarning": "This key is shown only once. Copy it now — it cannot be recovered later.",
    "roles.apikey": "API key",
    "roles.done": "Done",
    "roles.createpersonfailed": "Could not create the person. Please try again.",
    "action.newrole": "New role",
    "action.close": "Close",
    "action.save": "Save",
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
        // Already response-shaped — either an explicit status (an
        // error stub) or an explicit ok (a success stub written the
        // same way). Checking only "status" missed the second case
        // and double-wrapped it, so response.json() on a plain
        // { ok: true, json: async () => body } stub returned the
        // stub object itself instead of the body it wrapped.
        if (value && typeof value === "object" && ("status" in (value as object) || "ok" in (value as object))) {
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

    const close = [...document.querySelectorAll<HTMLButtonElement>(".popout .cardhead button")].find((b) =>
      b.textContent?.includes("Close")
    );
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

describe("assigning and revoking a role for one person — decision 0327", () => {
  const ALICE = { id: "usr1", email: "alice@acme.com", name: "Alice", unitId: null, status: "active" };
  const ROLES = [
    { id: "r1", name: "AP Manager", permissions: ["AP.Approve"] },
    { id: "r2", name: "AP Validator", permissions: ["AP.Validate"] },
  ];
  const ONE_UNIT = { id: "acme-fr", name: "Acme France", kind: "legal_entity", parentUnitId: null };

  function baseBody() {
    return { ...EMPTY, users: [ALICE], roles: ROLES, units: [ONE_UNIT] };
  }

  it("does not open on click without Admin.UserManagement", async () => {
    await openRolesAs(["AP.Dashboard"], baseBody());
    const row = [...document.querySelectorAll("tr")].find((r) => r.textContent?.includes("Alice"));
    row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(document.querySelector(".backdrop")).toBeNull();
  });

  it("opens on click holding Admin.UserManagement, showing the person's own name", async () => {
    await openRolesAs(["Admin.UserManagement"], baseBody());
    const row = [...document.querySelectorAll("tr")].find((r) => r.textContent?.includes("Alice"));
    row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(document.querySelector(".backdrop")).not.toBeNull();
    expect(document.querySelector(".popout h3")?.textContent).toBe("Alice");
  });

  it("offers every known role and every visible org, with Everywhere as an option", async () => {
    await openRolesAs(["Admin.UserManagement"], baseBody());
    const row = [...document.querySelectorAll("tr")].find((r) => r.textContent?.includes("Alice"));
    row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const selects = document.querySelectorAll("select");
    const roleOptions = [...selects[0].querySelectorAll("option")].map((o) => o.textContent);
    const orgOptions = [...selects[1].querySelectorAll("option")].map((o) => o.textContent);
    expect(roleOptions).toEqual(["AP Manager", "AP Validator"]);
    expect(orgOptions).toEqual(["everywhere", "Acme France"]);
  });

  it("posts the chosen role and org, then reloads", async () => {
    await openRolesAs(["Admin.UserManagement"], baseBody(), {
      "POST /api/org/users/usr1/roles": { ok: true, json: async () => ({}) },
    });
    const row = [...document.querySelectorAll("tr")].find((r) => r.textContent?.includes("Alice"));
    row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const [roleSelect, orgSelect] = document.querySelectorAll<HTMLSelectElement>("select");
    roleSelect.value = "r2";
    orgSelect.value = "acme-fr";

    const submit = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Assign"));
    await submit?.click();
    await new Promise((r) => setTimeout(r, 0));

    const calls = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const postCall = calls.find(
      ([url, init]) => url === "/api/org/users/usr1/roles" && (init as RequestInit)?.method === "POST"
    );
    const body = JSON.parse((postCall?.[1] as RequestInit).body as string);
    expect(body).toEqual({ roleId: "r2", unitId: "acme-fr" });
    expect(document.querySelector(".backdrop")).toBeNull();
  });

  it("posts a null unitId for Everywhere, left as the default choice", async () => {
    await openRolesAs(["Admin.UserManagement"], baseBody(), {
      "POST /api/org/users/usr1/roles": { ok: true, json: async () => ({}) },
    });
    const row = [...document.querySelectorAll("tr")].find((r) => r.textContent?.includes("Alice"));
    row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const submit = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Assign"));
    await submit?.click();
    await new Promise((r) => setTimeout(r, 0));

    const calls = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const postCall = calls.find(
      ([url, init]) => url === "/api/org/users/usr1/roles" && (init as RequestInit)?.method === "POST"
    );
    const body = JSON.parse((postCall?.[1] as RequestInit).body as string);
    expect(body.unitId).toBeNull();
  });

  it("shows the real error and leaves the form open when assigning fails", async () => {
    await openRolesAs(["Admin.UserManagement"], baseBody(), {
      "POST /api/org/users/usr1/roles": {
        ok: false,
        status: 409,
        json: async () => ({ error: "already has that role" }),
      },
    });
    const row = [...document.querySelectorAll("tr")].find((r) => r.textContent?.includes("Alice"));
    row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const submit = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Assign"));
    await submit?.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(document.querySelector(".backdrop")).not.toBeNull();
    expect(document.body.textContent).toContain("already has that role");
  });

  it("lists a person's own current assignments, each with a Remove control", async () => {
    await openRolesAs(["Admin.UserManagement"], {
      ...baseBody(),
      assignments: [
        { userId: "usr1", userName: "Alice", roleId: "r1", roleName: "AP Manager", unitId: "acme-fr", unitName: "Acme France", grantedAt: "" },
      ],
    });
    const row = [...document.querySelectorAll("tr")].find((r) => r.textContent?.includes("Alice"));
    row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(document.querySelector(".assignmentrow")?.textContent).toContain("AP Manager — Acme France");
    expect(document.querySelector(".assignmentrow")?.textContent).toContain("Remove");
  });

  it("DELETEs with the assignment's own unitId as a query parameter, never a body", async () => {
    await openRolesAs(
      ["Admin.UserManagement"],
      {
        ...baseBody(),
        assignments: [
          { userId: "usr1", userName: "Alice", roleId: "r1", roleName: "AP Manager", unitId: "acme-fr", unitName: "Acme France", grantedAt: "" },
        ],
      },
      { "DELETE /api/org/users/usr1/roles/r1": { ok: true, json: async () => ({}) } }
    );
    const row = [...document.querySelectorAll("tr")].find((r) => r.textContent?.includes("Alice"));
    row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const remove = [...document.querySelectorAll("button")].find((b) => b.textContent === "Remove");
    await remove?.click();
    await new Promise((r) => setTimeout(r, 0));

    const calls = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const deleteCall = calls.find(([_url, init]) => (init as RequestInit)?.method === "DELETE");
    expect(deleteCall?.[0]).toBe("/api/org/users/usr1/roles/r1?unitId=acme-fr");
    expect((deleteCall?.[1] as RequestInit | undefined)?.body).toBeUndefined();
    expect(document.querySelector(".backdrop")).toBeNull();
  });

  it("omits the unitId query param entirely for an everywhere assignment", async () => {
    await openRolesAs(
      ["Admin.UserManagement"],
      {
        ...baseBody(),
        assignments: [
          { userId: "usr1", userName: "Alice", roleId: "r1", roleName: "AP Manager", unitId: null, unitName: null, grantedAt: "" },
        ],
      },
      { "DELETE /api/org/users/usr1/roles/r1": { ok: true, json: async () => ({}) } }
    );
    const row = [...document.querySelectorAll("tr")].find((r) => r.textContent?.includes("Alice"));
    row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const remove = [...document.querySelectorAll("button")].find((b) => b.textContent === "Remove");
    await remove?.click();
    await new Promise((r) => setTimeout(r, 0));

    const calls = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const deleteCall = calls.find(([_url, init]) => (init as RequestInit)?.method === "DELETE");
    expect(deleteCall?.[0]).toBe("/api/org/users/usr1/roles/r1");
  });

  it("shows the real error and keeps the assignment listed when revoking fails", async () => {
    await openRolesAs(
      ["Admin.UserManagement"],
      {
        ...baseBody(),
        assignments: [
          { userId: "usr1", userName: "Alice", roleId: "r1", roleName: "AP Manager", unitId: "acme-fr", unitName: "Acme France", grantedAt: "" },
        ],
      },
      {
        "DELETE /api/org/users/usr1/roles/r1": {
          ok: false,
          status: 403,
          json: async () => ({ error: "you do not administer acme-fr" }),
        },
      }
    );
    const row = [...document.querySelectorAll("tr")].find((r) => r.textContent?.includes("Alice"));
    row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const remove = [...document.querySelectorAll("button")].find((b) => b.textContent === "Remove");
    await remove?.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(document.querySelector(".backdrop")).not.toBeNull();
    expect(document.body.textContent).toContain("you do not administer acme-fr");
  });
});

describe("creating a person — decision 0328", () => {
  const ONE_UNIT = { id: "acme-fr", name: "Acme France", kind: "legal_entity", parentUnitId: null };

  function baseBody() {
    return { ...EMPTY, units: [ONE_UNIT] };
  }

  it("shows no New person button without Admin.UserManagement", async () => {
    await openRolesAs(["AP.Dashboard"], baseBody());
    const shell = document.getElementById("shell");
    expect([...(shell?.querySelectorAll("button") ?? [])].some((b) => b.textContent?.includes("New person"))).toBe(
      false
    );
  });

  it("shows a New person button when holding Admin.UserManagement", async () => {
    await openRolesAs(["Admin.UserManagement"], baseBody());
    const shell = document.getElementById("shell");
    expect([...(shell?.querySelectorAll("button") ?? [])].some((b) => b.textContent?.includes("New person"))).toBe(
      true
    );
  });

  it("posts the entered name, email, and org, then shows the returned key", async () => {
    await openRolesAs(["Admin.UserManagement"], baseBody(), {
      "POST /api/org/users": {
        ok: true,
        json: async () => ({ id: "usr1", name: "Alice", email: "alice@acme.com", apiKey: "vf_live_secret123" }),
      },
    });
    const button = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("New person"));
    button?.click();

    const inputs = document.querySelectorAll<HTMLInputElement>(".editgrid input");
    const orgSelect = document.querySelector<HTMLSelectElement>("select") as HTMLSelectElement;
    inputs[0].value = "Alice";
    inputs[1].value = "alice@acme.com";
    orgSelect.value = "acme-fr";

    const submit = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Create"));
    await submit?.click();
    await new Promise((r) => setTimeout(r, 0));

    const calls = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const postCall = calls.find(([url, init]) => url === "/api/org/users" && (init as RequestInit)?.method === "POST");
    const body = JSON.parse((postCall?.[1] as RequestInit).body as string);
    expect(body.name).toBe("Alice");
    expect(body.email).toBe("alice@acme.com");
    expect(body.unitId).toBe("acme-fr");

    // The key is shown, not the form fields anymore.
    const keyInput = document.querySelector<HTMLInputElement>(".apikeydisplay");
    expect(keyInput?.value).toBe("vf_live_secret123");
    expect(document.body.textContent).toContain("shown only once");
    expect(document.querySelectorAll(".editgrid input")).toHaveLength(0);
  });

  it("sets an authority limit when a currency and amount are given", async () => {
    await openRolesAs(["Admin.UserManagement"], baseBody(), {
      "POST /api/org/users": {
        ok: true,
        json: async () => ({ id: "usr1", name: "Alice", email: "alice@acme.com", apiKey: "vf_live_secret123" }),
      },
      "POST /api/org/users/usr1/authority-limits": { ok: true, json: async () => ({}) },
    });
    const button = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("New person"));
    button?.click();

    const inputs = document.querySelectorAll<HTMLInputElement>(".editgrid input");
    inputs[0].value = "Alice";
    inputs[1].value = "alice@acme.com";
    inputs[2].value = "EUR";
    inputs[3].value = "5000";

    const submit = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Create"));
    await submit?.click();
    await new Promise((r) => setTimeout(r, 0));

    const calls = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const limitCall = calls.find(([url]) => url === "/api/org/users/usr1/authority-limits");
    const body = JSON.parse((limitCall?.[1] as RequestInit).body as string);
    expect(body).toEqual({ currency: "EUR", maxAmount: 5000 });
  });

  it("does not set an authority limit when left blank", async () => {
    await openRolesAs(["Admin.UserManagement"], baseBody(), {
      "POST /api/org/users": {
        ok: true,
        json: async () => ({ id: "usr1", name: "Alice", email: "alice@acme.com", apiKey: "vf_live_secret123" }),
      },
    });
    const button = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("New person"));
    button?.click();

    const inputs = document.querySelectorAll<HTMLInputElement>(".editgrid input");
    inputs[0].value = "Alice";
    inputs[1].value = "alice@acme.com";

    const submit = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Create"));
    await submit?.click();
    await new Promise((r) => setTimeout(r, 0));

    const calls = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls;
    const limitCall = calls.find(([url]) => url === "/api/org/users/usr1/authority-limits");
    expect(limitCall).toBeUndefined();
  });

  it("shows the real error and leaves the form open when creation fails", async () => {
    await openRolesAs(["Admin.UserManagement"], baseBody(), {
      "POST /api/org/users": {
        ok: false,
        status: 403,
        json: async () => ({ error: "you may only create a person within an org you administer" }),
      },
    });
    const button = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("New person"));
    button?.click();

    const submit = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Create"));
    await submit?.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(document.querySelector(".backdrop")).not.toBeNull();
    expect(document.body.textContent).toContain("you may only create a person within an org you administer");
  });

  it("Done closes the form and reloads", async () => {
    await openRolesAs(["Admin.UserManagement"], baseBody(), {
      "POST /api/org/users": {
        ok: true,
        json: async () => ({ id: "usr1", name: "Alice", email: "alice@acme.com", apiKey: "vf_live_secret123" }),
      },
    });
    const button = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("New person"));
    button?.click();

    const submit = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Create"));
    await submit?.click();
    await new Promise((r) => setTimeout(r, 0));

    const done = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Done"));
    await done?.click();
    await new Promise((r) => setTimeout(r, 0));

    expect(document.querySelector(".backdrop")).toBeNull();
  });
});

describe("popout action row — decision 0329, corrected", () => {
  /**
   * **Both Save/Create/Assign and Close together, top right** —
   * corrected after a first attempt put only Close in the header and
   * left the primary action at the bottom: "I wanted the same as the
   * supplier pop-out." Every popout's own `.cardhead` now holds the
   * title and both actions, the same `.statebuttons` shape decision
   * 0306 already gives the supplier popout.
   */
  const ONE_ROLE = { id: "r1", name: "AP Manager", permissions: ["AP.Approve"] };
  const ONE_UNIT = { id: "acme-fr", name: "Acme France", kind: "legal_entity", parentUnitId: null };
  const ALICE = { id: "usr1", email: "alice@acme.com", name: "Alice", unitId: null, status: "active" };

  it("the role popout's own Save and Close sit together in the header, both with an icon", async () => {
    await openRolesAs(["Admin.RoleManagement"], { ...EMPTY, roles: [ONE_ROLE], knownPermissions: [] });
    const row = [...document.querySelectorAll("tr")].find((r) => r.textContent?.includes("AP Manager"));
    row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const stateButtons = document.querySelector(".popout .cardhead .statebuttons");
    const buttons = [...(stateButtons?.querySelectorAll("button") ?? [])];
    expect(buttons).toHaveLength(2);
    expect(buttons.some((b) => b.textContent?.includes("Save"))).toBe(true);
    expect(buttons.some((b) => b.textContent?.includes("Close"))).toBe(true);
    expect(buttons.every((b) => b.querySelector("svg"))).toBe(true);
    // Nothing left at the bottom of the popout, outside the header.
    expect(document.querySelectorAll(".popout > .statebuttons")).toHaveLength(0);
  });

  it("the new-role popout shows Create rather than Save", async () => {
    await openRolesAs(["Admin.RoleManagement"], { ...EMPTY, knownPermissions: [] });
    const button = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("New role"));
    button?.click();

    const stateButtons = document.querySelector(".popout .cardhead .statebuttons");
    const buttons = [...(stateButtons?.querySelectorAll("button") ?? [])];
    expect(buttons.some((b) => b.textContent?.includes("Create"))).toBe(true);
  });

  it("the assign popout's own Assign and Close sit together in the header, both with an icon", async () => {
    await openRolesAs(["Admin.UserManagement"], {
      ...EMPTY,
      users: [ALICE],
      roles: [ONE_ROLE],
      units: [ONE_UNIT],
    });
    const row = [...document.querySelectorAll("tr")].find((r) => r.textContent?.includes("Alice"));
    row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    const stateButtons = document.querySelector(".popout .cardhead .statebuttons");
    const buttons = [...(stateButtons?.querySelectorAll("button") ?? [])];
    expect(buttons).toHaveLength(2);
    expect(buttons.some((b) => b.textContent?.includes("Assign"))).toBe(true);
    expect(buttons.some((b) => b.textContent?.includes("Close"))).toBe(true);
    expect(buttons.every((b) => b.querySelector("svg"))).toBe(true);
  });

  it("the new-person popout's own Create and Close sit together in the header", async () => {
    await openRolesAs(["Admin.UserManagement"], { ...EMPTY, units: [ONE_UNIT] });
    const button = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("New person"));
    button?.click();

    const stateButtons = document.querySelector(".popout .cardhead .statebuttons");
    const buttons = [...(stateButtons?.querySelectorAll("button") ?? [])];
    expect(buttons).toHaveLength(2);
    expect(buttons.some((b) => b.textContent?.includes("Create"))).toBe(true);
    expect(buttons.some((b) => b.textContent?.includes("Close"))).toBe(true);
  });

  it("the one-time key view's own Done sits in the header, with no Close beside it", async () => {
    await openRolesAs(["Admin.UserManagement"], { ...EMPTY, units: [ONE_UNIT] }, {
      "POST /api/org/users": {
        ok: true,
        json: async () => ({ id: "usr1", name: "Alice", email: "a@b.com", apiKey: "vf_live_secret123" }),
      },
    });
    const button = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("New person"));
    button?.click();
    const submit = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Create"));
    await submit?.click();
    await new Promise((r) => setTimeout(r, 0));

    const stateButtons = document.querySelector(".popout .cardhead .statebuttons");
    const buttons = [...(stateButtons?.querySelectorAll("button") ?? [])];
    expect(buttons).toHaveLength(1);
    expect(buttons[0].textContent).toContain("Done");
    expect(buttons[0].querySelector("svg")).not.toBeNull();
  });
});
