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
    "sources.new": "Add a source",
    "sources.create": "Create",
    "sources.needname": "Give the source a name.",
    "sources.nameexample": "AP Mailbox",
    "sources.noprocess": "A source belongs to a process, and none exists yet.",
    "sources.nostages": "no stages",
    "mechanism.email": "Email",
    "mechanism.https": "HTTPS",
    "mechanism.sftp": "SFTP",
    "mechanism.file_import": "File import",
    "mechanism.edi": "EDI",
    "sources.needletters": "The name needs at least one letter or number.",
    "sources.toolong": "That name is too long for an email address.",
    "sources.retire": "Retire",
    "sources.rename": "Rename",
    "sources.retired": "Retired",
  },
};

const SOURCES = (sources: unknown[], processes: unknown[] = [{ id: "ap", name: "Accounts Payable", stageCount: 3 }]) => ({
  "/api/ui-strings": STRINGS,
  "/api/sources": { sources },
  "/api/processes": { processes },
});

async function open(
  sources: unknown[],
  extra: Record<string, unknown> = {},
  posted: string[] = [],
  processes?: unknown[]
) {
  stubFetch({ ...SOURCES(sources, processes), ...extra }, posted);
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

    // **Narrowed by decision 0128.** This asserted the screen had no
    // input at all, which was true until the create form existed. The
    // claim is about the ADDRESS button: it takes no input, because a
    // customer picking a local part would collide with somebody they
    // have never heard of.
    const claim = [...document.querySelectorAll("button")].find(
      (b) => b.textContent === "Create address"
    ) as HTMLButtonElement;
    expect(claim.querySelector("input")).toBeNull();
    claim.click();
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

describe("creating a source (decision 0128)", () => {
  it("offers a name, a mechanism and a process", async () => {
    await open([]);
    expect(document.getElementById("new-name")).not.toBeNull();
    expect(document.getElementById("new-mechanism")).not.toBeNull();
    expect(document.getElementById("new-process")).not.toBeNull();
  });

  it("asks for no identifier", async () => {
    // **A person configuring where their invoices arrive should not be
    // inventing identifiers**, and every id this screen creates is one
    // nobody will ever type again.
    await open([]);
    const labels = [...document.querySelectorAll("label")].map((l) => l.textContent);
    expect(labels).not.toContain("id");
    expect(labels).not.toContain("ID");
  });

  it("names the mechanisms in words, not in the column's spelling", async () => {
    await open([]);
    const options = [...document.querySelectorAll("#new-mechanism option")].map((o) => o.textContent);
    expect(options).toContain("File import");
    expect(options).not.toContain("file_import");
  });

  it("marks a process that would do nothing with a document", async () => {
    // A process with no stages accepts documents and does nothing with
    // them -- worth seeing before pointing a source at it.
    await open([], {}, [], [{ id: "new", name: "Untouched", stageCount: 0 }]);
    const options = [...document.querySelectorAll("#new-process option")].map((o) => o.textContent);
    expect(options[0]).toContain("no stages");
  });

  it("offers no form at all when no process exists", async () => {
    // Said plainly rather than offering a form that cannot succeed.
    await open([], {}, [], []);
    expect(document.getElementById("new-name")).toBeNull();
    expect(document.body.textContent).toContain("none exists yet");
  });

  it("refuses to create one with no name", async () => {
    const posted: string[] = [];
    await open([], {}, posted);
    (document.querySelector("button.primary") as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 0));

    expect(posted).toHaveLength(0);
    expect(document.body.textContent).toContain("Give the source a name");
  });

  it("posts to the chosen process", async () => {
    const posted: string[] = [];
    await open(
      [],
      { "/api/processes/ap/sources": { id: "ap-mailbox", name: "AP Mailbox" } },
      posted
    );

    (document.getElementById("new-name") as HTMLInputElement).value = "AP Mailbox";
    (document.querySelector("button.primary") as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 0));

    expect(posted).toContain("/api/processes/ap/sources");
  });
});

describe("the screen says what the platform will accept (decision 0129)", () => {
  /**
   * **Said while somebody is still typing**, rather than after a source
   * exists that can never receive an invoice.
   */
  it("shows the identifier a name will become", async () => {
    // A name becomes a URL and an address, and somebody should see that
    // before it is permanent.
    await open([]);
    const input = document.getElementById("new-name") as HTMLInputElement;
    input.value = "AP Mailbox (UK)";
    input.dispatchEvent(new Event("input"));

    expect(document.getElementById("new-slug")?.textContent).toBe("ap-mailbox-uk");
  });

  it("folds accents in the preview too", async () => {
    await open([]);
    const input = document.getElementById("new-name") as HTMLInputElement;
    input.value = "Rechnungen für Köln";
    input.dispatchEvent(new Event("input"));

    expect(document.getElementById("new-slug")?.textContent).toBe("rechnungen-fur-koln");
  });

  it("refuses a name with no letters, before posting anything", async () => {
    const posted: string[] = [];
    await open([], {}, posted);
    (document.getElementById("new-name") as HTMLInputElement).value = "!!!";
    (document.querySelector("button.primary") as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 0));

    expect(posted).toHaveLength(0);
    expect(document.body.textContent).toContain("at least one letter");
  });

  it("refuses a name too long for an address", async () => {
    const posted: string[] = [];
    await open([], {}, posted);
    (document.getElementById("new-name") as HTMLInputElement).value = "A".repeat(80);
    (document.querySelector("button.primary") as HTMLButtonElement).click();
    await new Promise((r) => setTimeout(r, 0));

    expect(posted).toHaveLength(0);
    expect(document.body.textContent).toContain("too long");
  });
});

describe("retiring and renaming (decision 0130)", () => {
  const LIVE = [
    { id: "s-1", name: "AP Mailbox", mechanism: "email", processId: "ap", emailAddress: null, status: "active" },
  ];

  it("says Retire, not Delete", async () => {
    // **That is what usually happens**: a document that arrived through
    // a source carries its name, and rules reference that name.
    // Promising deletion and archiving instead is the mistake decision
    // 0078 records.
    await open(LIVE);
    const labels = [...document.querySelectorAll(".rowactions button")].map((b) => b.textContent);
    expect(labels).toContain("Retire");
    expect(labels).not.toContain("Delete");
  });

  it("offers renaming too", async () => {
    await open(LIVE);
    const labels = [...document.querySelectorAll(".rowactions button")].map((b) => b.textContent);
    expect(labels).toContain("Rename");
  });

  it("offers neither on one already retired", async () => {
    await open([{ ...LIVE[0], status: "retired" }]);
    expect(document.querySelectorAll(".rowactions button")).toHaveLength(0);
    expect(document.body.textContent).toContain("Retired");
  });

  it("lists a retired source rather than hiding it", async () => {
    // Somebody looking at where invoices arrive should see what stopped
    // as well as what runs.
    await open([{ ...LIVE[0], status: "retired" }]);
    expect(document.body.textContent).toContain("AP Mailbox");
    expect(document.querySelector("tr.retired")).not.toBeNull();
  });

  it("puts the form beside the list, not below it", async () => {
    await open(LIVE);
    expect(document.querySelector(".columns")).not.toBeNull();
    expect(document.querySelector(".newsource.stacked")).not.toBeNull();
  });
});
