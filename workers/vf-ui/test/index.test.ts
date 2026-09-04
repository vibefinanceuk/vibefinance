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

  it("carries the configured licence API", async () => {
    // If this were baked into the JavaScript, moving to a custom domain
    // would mean rebuilding the UI (decision 0099).
    const body = await (await SELF.fetch("https://ui.example.com/config.js")).text();
    expect(body).toContain("vf-licence");
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
    const html = await (await SELF.fetch("https://ui.example.com/")).text();
    const brandLink = html.indexOf('id="brand"');
    const script = html.indexOf("signin.js");
    expect(brandLink).toBeGreaterThan(-1);
    expect(brandLink).toBeLessThan(script);
  });

  it("carries no hardcoded API address in the markup", async () => {
    const html = await (await SELF.fetch("https://ui.example.com/")).text();
    expect(html).not.toContain("workers.dev");
  });
});
