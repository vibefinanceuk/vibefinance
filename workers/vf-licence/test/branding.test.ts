import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleCreateCustomer } from "../src/customers-route.js";
import { setBranding, loadBranding, handleBrandingStylesheet, DEFAULT_BRANDING } from "../src/branding.js";

beforeEach(async () => {
  await applyTestSchema();
  await handleCreateCustomer(env.CONTROL_DB, { id: "acme", name: "Acme" });
});

describe("a customer's livery", () => {
  it("defaults for a customer who never set one — no row required", async () => {
    expect(await loadBranding(env.CONTROL_DB, "acme")).toEqual(DEFAULT_BRANDING);
  });

  it("stores what the operator set", async () => {
    await setBranding(env.CONTROL_DB, "acme", { brandBar: "#123456", brandName: "Acme Finance" });
    const branding = await loadBranding(env.CONTROL_DB, "acme");
    expect(branding.brandBar).toBe("#123456");
    expect(branding.brandName).toBe("Acme Finance");
  });

  it("keeps the default for anything not set", async () => {
    // A customer who set only their bar colour keeps the rest.
    await setBranding(env.CONTROL_DB, "acme", { brandBar: "#123456" });
    const branding = await loadBranding(env.CONTROL_DB, "acme");
    expect(branding.brandChip).toBe(DEFAULT_BRANDING.brandChip);
  });

  it("replaces rather than accumulating", async () => {
    await setBranding(env.CONTROL_DB, "acme", { brandBar: "#123456" });
    await setBranding(env.CONTROL_DB, "acme", { brandBar: "#abcdef" });
    const count = await env.CONTROL_DB.prepare("SELECT count(*) AS n FROM customer_branding").first<{ n: number }>();
    expect(count?.n).toBe(1);
    expect((await loadBranding(env.CONTROL_DB, "acme")).brandBar).toBe("#abcdef");
  });

  it("404s a customer that does not exist", async () => {
    expect((await setBranding(env.CONTROL_DB, "nobody", { brandBar: "#123456" })).status).toBe(404);
  });
});

describe("branding cannot rewrite a screen", () => {
  it("refuses a colour that would close the CSS rule", async () => {
    // These values are interpolated into a stylesheet the browser
    // executes. `red; } body { display: none` would close the rule and
    // open another.
    const result = await setBranding(env.CONTROL_DB, "acme", { brandBar: "red; } body { display: none" });
    expect(result.status).toBe(422);
  });

  it("refuses a colour name rather than a hex value", async () => {
    expect((await setBranding(env.CONTROL_DB, "acme", { brandFill: "rebeccapurple" })).status).toBe(422);
  });

  it("refuses a brand name carrying a quote", async () => {
    // Same reasoning, different alphabet: the name is written into a
    // CSS string.
    const result = await setBranding(env.CONTROL_DB, "acme", { brandName: 'Acme" ; body{display:none} "' });
    expect(result.status).toBe(422);
  });

  it("refuses a brand name carrying a brace or semicolon", async () => {
    for (const name of ["Acme}", "Acme;", "Acme<script>"]) {
      expect((await setBranding(env.CONTROL_DB, "acme", { brandName: name })).status).toBe(422);
    }
  });

  it("stores nothing when it refuses", async () => {
    await setBranding(env.CONTROL_DB, "acme", { brandBar: "red; }" });
    const count = await env.CONTROL_DB.prepare("SELECT count(*) AS n FROM customer_branding").first<{ n: number }>();
    expect(count?.n).toBe(0);
  });
});

describe("the stylesheet the UI fetches", () => {
  it("is CSS, not JSON — so it applies before the first paint", async () => {
    const response = await handleBrandingStylesheet(env.CONTROL_DB, "acme");
    expect(response.headers.get("Content-Type")).toContain("text/css");
  });

  it("carries the five brand tokens and nothing structural", async () => {
    // Branding reaches tokens only, so a customer cannot break a
    // screen. Spacing and type scale are not theirs to set.
    const css = await (await handleBrandingStylesheet(env.CONTROL_DB, "acme")).text();
    for (const token of ["--brand-bar", "--brand-fill", "--brand-chip", "--brand-chip-text", "--brand-name"]) {
      expect(css).toContain(token);
    }
    expect(css).not.toContain("--surface");
    expect(css).not.toContain("--radius");
  });

  it("serves the default for a customer nobody has heard of", async () => {
    // A login screen that fails to render because somebody mistyped a
    // query parameter is worse than one that looks generic.
    const css = await (await handleBrandingStylesheet(env.CONTROL_DB, "no-such-customer")).text();
    expect(css).toContain(DEFAULT_BRANDING.brandBar);
  });

  it("serves the default before any customer is named", async () => {
    // The very first paint of a login screen.
    const css = await (await handleBrandingStylesheet(env.CONTROL_DB, null)).text();
    expect(css).toContain(DEFAULT_BRANDING.brandName);
  });

  it("is cacheable but not for long", async () => {
    // Long enough that every page load does not hit the control plane;
    // short enough that a livery change appears without a redeploy.
    const response = await handleBrandingStylesheet(env.CONTROL_DB, "acme");
    expect(response.headers.get("Cache-Control")).toContain("max-age=300");
  });
});
