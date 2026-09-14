import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Who can do what, where, and up to how much — decision 0319.
 *
 * **The first, read-only half of a role-management screen.** Every
 * write this data needs already exists as its own route; this makes
 * the result of them visible, which today requires reading the
 * database directly.
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
    "column.unit": "Unit",
    "column.role": "Role",
    "column.person": "Person",
  },
};

function stubFetch(body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const path = String(url).split("?")[0];
      if (path === "/api/ui-strings") return { ok: true, json: async () => STRINGS } as Response;
      if (path === "/api/org/overview") return { ok: true, json: async () => body } as Response;
      throw new Error(`no stub for ${path}`);
    })
  );
}

beforeEach(() => {
  mountShell();
  vi.unstubAllGlobals();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const EMPTY = { units: [], users: [], roles: [], assignments: [], authorityLimits: [] };

async function openRoles(body: unknown) {
  stubFetch(body);
  const { loadStrings } = await import("/strings.js");
  await loadStrings();
  const { open } = await import("/roles.js");
  await open();
}

describe("the screen opens at all", () => {
  it("renders into the shell", async () => {
    await openRoles(EMPTY);
    expect(document.getElementById("shell")?.textContent).toContain("Roles");
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
