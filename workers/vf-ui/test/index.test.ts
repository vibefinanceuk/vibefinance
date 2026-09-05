import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("configuration is injected, not compiled in", () => {
  it("serves the API address as a script", async () => {
    // A <script src> rather than JSON fetched at startup, so the value
    // is present before any code needs it.
    const res = await SELF.fetch("https://ui.example.com/config.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("javascript");
    expect(await res.text()).toContain("window.VF_CONFIG");
  });

  it("no longer carries an API address at all", async () => {
    // Since decision 0102 the browser talks only to this origin, so
    // there is nothing to tell it. The mechanism stays because a UI
    // needs to know things; the value went away.
    const body = await (await SELF.fetch("https://ui.example.com/config.js")).text();
    expect(body).not.toContain("workers.dev");
  });

  it("is not cached — a stale copy sends a browser to the wrong API", async () => {
    const res = await SELF.fetch("https://ui.example.com/config.js");
    expect(res.headers.get("Cache-Control")).toContain("no-store");
  });

  it("is valid JavaScript, not concatenated strings", async () => {
    // The value comes from deployment configuration rather than a user,
    // but a URL interpolated raw into JavaScript is a shape of mistake
    // worth not making at all.
    const body = await (await SELF.fetch("https://ui.example.com/config.js")).text();
    expect(() => new Function(`const window = {}; ${body}`)()).not.toThrow();
  });
});

describe("serving the interface", () => {
  it("serves the sign-in page at the root", async () => {
    const res = await SELF.fetch("https://ui.example.com/");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Sign in");
  });

  it("answers an unknown path with the page, not a 404", async () => {
    // A path this Worker does not recognise may be a route the page
    // does.
    const res = await SELF.fetch("https://ui.example.com/queue/validation");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
  });

  it("falls back to the page for any path Cloudflare did not match", async () => {
    /**
     * **Static assets are not served in this test environment** — every
     * request reaches the Worker and takes the fallback. So this cannot
     * assert that `/tokens.css` serves the stylesheet; only that an
     * unmatched path yields the page.
     *
     * Worth stating because the previous version of this test claimed
     * to check the stylesheet and **passed for the wrong reason**: the
     * fallback returned `index.html`, which happened to contain
     * `--brand-bar` in its own styles. Changing that one variable made
     * it fail and revealed the test had never checked what it said.
     *
     * Asset serving is Cloudflare's, configured in `wrangler.jsonc` and
     * verified by `wrangler deploy --dry-run` reporting the files it
     * read.
     */
    const res = await SELF.fetch("https://ui.example.com/tokens.css");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
  });
});

describe("the page loads its livery as a stylesheet", () => {
  it("links branding before any script runs", async () => {
    // Both stylesheets apply before the first paint. Fetching branding
    // as JSON and setting variables in script would mean a visible
    // flash of the wrong colours (decision 0096).
    // Against whichever script the page loads first, rather than a
    // named one — the entry point changed from signin.js to boot.js
    // when the Task Manager landed (decision 0103), and a test naming
    // the file fails on a rename while the property still holds.
    const html = await (await SELF.fetch("https://ui.example.com/")).text();
    const brandLink = html.indexOf('id="brand"');
    const firstScript = html.indexOf("<script type=\"module\"");
    expect(brandLink).toBeGreaterThan(-1);
    expect(firstScript).toBeGreaterThan(-1);
    expect(brandLink).toBeLessThan(firstScript);
  });

  it("carries no hardcoded API address in the markup", async () => {
    const html = await (await SELF.fetch("https://ui.example.com/")).text();
    expect(html).not.toContain("workers.dev");
  });
});


describe("the proxy is an allow-list, not a forwarder (decision 0102)", () => {
  /**
   * A proxy that forwards whatever it is given forwards routes nobody
   * has thought about — and this project found three write routes above
   * an admin gate (0097) by exactly that inattention. Adding a path is
   * a deliberate act.
   */
  it("refuses a path nobody listed", async () => {
    const res = await SELF.fetch("https://ui.example.com/api/customers", { method: "POST" });
    expect(res.status).toBe(404);
  });

  it("refuses an admin path outright", async () => {
    // vf-licence protects these itself, and a proxy that offered them a
    // route would be relying on that rather than deciding.
    for (const path of ["/api/credentials", "/api/access", "/api/branding/acme"]) {
      const res = await SELF.fetch(`https://ui.example.com${path}`, { method: "POST" });
      expect(res.status, path).toBe(404);
    }
  });

  it("answers an unknown API path with JSON, not the page", async () => {
    // Falling through to index.html would return HTML to something
    // expecting JSON.
    const res = await SELF.fetch("https://ui.example.com/api/nonsense");
    expect(res.headers.get("Content-Type")).toContain("json");
  });

  it("refuses a proxied instance path with no session", async () => {
    const res = await SELF.fetch("https://ui.example.com/api/whoami");
    expect(res.status).toBe(401);
  });
});

describe("signing out", () => {
  it("clears the cookie", async () => {
    const res = await SELF.fetch("https://ui.example.com/api/sign-out", { method: "POST" });
    expect(res.status).toBe(200);
    expect(res.headers.get("Set-Cookie")).toContain("Max-Age=0");
  });
});

describe("the token never reaches the page (decision 0102)", () => {
  /**
   * The property this whole change exists for, and it had no test until
   * a fail-watch showed nothing caught the token being returned
   * alongside the cookie.
   *
   * The sign-in path itself cannot be exercised here — it needs
   * `vf-licence` to answer — so this tests the step that decides what
   * the page sees. A function that can be tested is better than a
   * property that cannot.
   */
  it("removes the token from what the page receives", async () => {
    const { visibleToPage } = await import("../src/index.js");
    const upstream = {
      token: "a.real.token",
      expiresAt: "2026-09-05T00:00:00.000Z",
      environmentId: "Acme-production",
      instanceUrl: "https://vf-app.example.com",
    };

    const visible = visibleToPage(upstream);
    expect(visible).not.toHaveProperty("token");
    expect(JSON.stringify(visible)).not.toContain("a.real.token");
  });

  it("keeps everything else, including fields nobody anticipated", async () => {
    // Removed by name rather than by an allow-list, so a new field
    // vf-licence adds reaches the page without a change here.
    const { visibleToPage } = await import("../src/index.js");
    const visible = visibleToPage({
      token: "secret",
      environmentId: "Acme-production",
      lastSignedInAt: "2026-09-04T16:45:12.000Z",
      somethingAddedLater: 42,
    });

    expect(visible.environmentId).toBe("Acme-production");
    expect(visible.lastSignedInAt).toBe("2026-09-04T16:45:12.000Z");
    expect(visible.somethingAddedLater).toBe(42);
  });
});

describe("the task list is reachable, and only what it needs", () => {
  it("proxies the list itself", async () => {
    // Refused for want of a session, not for want of a route — which
    // is the distinction being asserted.
    const res = await SELF.fetch("https://ui.example.com/api/tasks");
    expect(res.status).toBe(401);
  });

  it("proxies claiming and releasing", async () => {
    for (const path of ["/api/tasks/abc/claim", "/api/tasks/abc/release"]) {
      const res = await SELF.fetch(`https://ui.example.com${path}`, { method: "POST" });
      expect(res.status, path).toBe(401);
    }
  });

  it("does not proxy a task path nobody listed", async () => {
    // The point of a list rather than a prefix: /tasks/:id/anything is
    // not automatically reachable because /tasks is.
    const res = await SELF.fetch("https://ui.example.com/api/tasks/abc/complete", { method: "POST" });
    expect(res.status).toBe(404);
  });
});

describe("the page decides which screen to show (decision 0103)", () => {
  it("ships both views, and shows NEITHER until it knows", async () => {
    // The session survives a refresh (decision 0102), and until now
    // nothing asked -- so a reload rendered an empty sign-in form while
    // the session was perfectly alive.
    //
    // **Both start hidden.** Showing the sign-in form by default meant
    // it painted on every refresh and vanished when /api/whoami
    // answered, which looks like a session failing and recovering.
    const html = await (await SELF.fetch("https://ui.example.com/")).text();
    expect(html).toContain('id="signin-view" hidden');
    expect(html).toContain('id="shell" hidden');
  });

  it("loads a boot script rather than the sign-in form directly", async () => {
    const html = await (await SELF.fetch("https://ui.example.com/")).text();
    expect(html).toContain("boot.js");
  });
});

describe("the Validation viewer's routes (decision 0106)", () => {
  it("proxies keying and the document URL", async () => {
    // Refused for want of a session, not for want of a route.
    for (const [method, path] of [
      ["POST", "/api/invoices/inv-1/key"],
      ["POST", "/api/invoices/inv-1/document-url"],
    ] as [string, string][]) {
      const res = await SELF.fetch(`https://ui.example.com${path}`, { method });
      expect(res.status, path).toBe(401);
    }
  });

  it("does not proxy an invoice path nobody listed", async () => {
    // Still a list rather than a prefix: /invoices/:id/anything is not
    // reachable merely because two of its siblings are.
    const res = await SELF.fetch("https://ui.example.com/api/invoices/inv-1/document", {
      method: "POST",
    });
    expect(res.status).toBe(404);
  });

  it("ships the viewer hidden alongside the list", async () => {
    const html = await (await SELF.fetch("https://ui.example.com/")).text();
    expect(html).toContain('id="viewer" hidden');
  });
});
