import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Where invoices arrive — decision 0126.
 *
 * The first configuration screen: everything a customer has configured
 * so far has been `curl`, which suits an operator and not the
 * administrator decision 0117 gives them.
 */

function mountShell() {
  document.body.innerHTML = `<main id="shell"></main><main id="viewer" hidden></main>`;
}

function stubFetch(routes: Record<string, unknown>, posted: string[] = []) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url).split("?")[0];
      if (init?.method === "POST") posted.push(path);
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
    "sources.subtitle": "Where invoices arrive",
    "sources.name": "Source",
    "sources.mechanism": "Arrives by",
    "sources.process": "Process",
    "sources.address": "Address",
    "sources.claim": "Create address",
    "sources.empty": "No sources configured.",
    "routing.not_configured": "Not receiving yet",
    "routing.active": "Receiving",
  },
};

const SOURCES = (sources: unknown[]) => ({
  "/api/ui-strings": STRINGS,
  "/api/sources": { sources },
});

async function open(sources: unknown[], extra: Record<string, unknown> = {}, posted: string[] = []) {
  stubFetch({ ...SOURCES(sources), ...extra }, posted);
  const { loadStrings } = await import("/strings.js");
  await loadStrings();
  const { openSources } = await import("/sources.js");
  await openSources();
}

beforeEach(() => {
  mountShell();
  vi.resetModules();
});

describe("the sources screen", () => {
  it("offers an address for an email source that has none", async () => {
    await open([{ id: "s-1", name: "AP Mailbox", mechanism: "email", processId: "ap", emailAddress: null }]);
    const buttons = [...document.querySelectorAll("button")].map((b) => b.textContent);
    expect(buttons).toContain("Create address");
  });

  it("asks for nothing when creating one", async () => {
    // **Generated, not chosen.** A customer picking a local part would
    // collide with another customer they have never heard of, so the
    // button takes no input at all.
    const posted: string[] = [];
    await open(
      [{ id: "s-1", name: "AP Mailbox", mechanism: "email", processId: "ap", emailAddress: null }],
      {
        "/api/sources/s-1/email": {
          emailAddress: "ap-mailbox.acme@vibefinance.com",
          routing: "not_configured",
          detail: "the address is reserved",
        },
      },
      posted
    );

    expect(document.querySelector("input")).toBeNull();
    (document.querySelector("button") as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 0));
    expect(posted).toContain("/api/sources/s-1/email");
  });

  it("shows an address that exists, with whether mail is arriving", async () => {
    // **The routing state is shown, not hidden.** An address that
    // looked live while nothing delivered to it would send somebody to
    // tell their suppliers an address that swallows invoices.
    await open([
      {
        id: "s-1",
        name: "AP Mailbox",
        mechanism: "email",
        processId: "ap",
        emailAddress: "ap-mailbox.acme@vibefinance.com",
        emailRouting: "not_configured",
      },
    ]);

    expect(document.body.textContent).toContain("ap-mailbox.acme@vibefinance.com");
    expect(document.body.textContent).toContain("Not receiving yet");
  });

  it("offers nothing for a source that does not receive by email", async () => {
    // An address means nothing to an SFTP feed, and an empty cell says
    // that better than a disabled button.
    await open([{ id: "s-2", name: "Nightly feed", mechanism: "sftp", processId: "ap", emailAddress: null }]);
    expect([...document.querySelectorAll("button")].map((b) => b.textContent)).not.toContain(
      "Create address"
    );
  });

  it("says so plainly when nothing is configured", async () => {
    await open([]);
    expect(document.body.textContent).toContain("No sources configured");
  });

  it("puts a second entry in the navigation", async () => {
    // The frame has carried one since decision 0108, which existed so
    // later screens would sit inside it rather than be retrofitted.
    await open([]);
    const nav = [...document.querySelectorAll(".nav a")].map((a) => a.textContent);
    expect(nav).toContain("Tasks");
    expect(nav).toContain("Sources");
  });

  it("marks which screen you are on", async () => {
    await open([]);
    const on = document.querySelector(".nav a.on");
    expect(on?.textContent).toBe("Sources");
  });
});
