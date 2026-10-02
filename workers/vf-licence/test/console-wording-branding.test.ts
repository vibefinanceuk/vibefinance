import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import worker, { isPrivileged, type Env } from "../src/index.js";
import { handleBulkUiStrings, handleSetUiString, missingPlaceholders, placeholdersOf } from "../src/ui-strings.js";
import { DEFAULT_BRANDING, handleGetBranding, setBranding } from "../src/branding.js";

/**
 * **Interface wording and Branding in the operator console — decision
 * 0604.** A translation keeps the English placeholders; the Branding
 * screen reads what a customer has set, and who set it.
 */

const db = () => env.CONTROL_DB;
const KEY = "k".repeat(48);
const asOperator = (path: string, init: RequestInit = {}) =>
  worker.fetch(
    new Request(`https://licence.example.com${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json", "Cf-Access-Authenticated-User-Email": "Dan@VibeFinance.example" },
    }),
    { ...env, ADMIN_API_KEY: KEY } as unknown as Env
  );

beforeEach(async () => {
  await applyTestSchema();
  await db().prepare("INSERT INTO customers (id, name) VALUES ('acme', 'Acme Ltd')").run();
  await db().prepare("DELETE FROM ui_strings WHERE key LIKE 'zz.%'").run();
  await db().prepare("INSERT INTO ui_strings (key, locale, value) VALUES ('zz.upgrade', 'en', 'Version {n} available for {name}'), ('zz.plain', 'en', 'Save')").run();
});

describe("a translation keeps the English placeholders — decision 0604", () => {
  it("finds the placeholders a value carries", () => {
    expect(placeholdersOf("Version {n} available for {name}, {n}")).toEqual(["n", "name"]);
    expect(missingPlaceholders("Version {n} for {name}", "Version {n}")).toEqual(["name"]);
    expect(missingPlaceholders("Save", "Speichern")).toEqual([]);
  });

  it("refuses a translation that drops one, one at a time or all at once, and takes one that keeps them in any order", async () => {
    expect(await handleSetUiString(db(), { key: "zz.upgrade", locale: "de", value: "Version verfügbar" })).toMatchObject({ status: 422, body: { reason: "placeholders", error: "the translation must keep {n}, {name}" } });
    expect(await handleSetUiString(db(), { key: "zz.upgrade", locale: "de", value: "Für {name}: Version {n} verfügbar" })).toMatchObject({ status: 200 });
    expect(await handleBulkUiStrings(db(), { locale: "fr", strings: { "zz.plain": "Enregistrer", "zz.upgrade": "Version disponible" } })).toMatchObject({ status: 422, body: { reason: "placeholders" } });
    expect(await db().prepare("SELECT count(*) AS n FROM ui_strings WHERE locale = 'fr' AND key LIKE 'zz.%'").first()).toEqual({ n: 0 });
    // English itself may change its own placeholders.
    expect(await handleSetUiString(db(), { key: "zz.upgrade", locale: "en", value: "Version {n} is available" })).toMatchObject({ status: 200 });
  });
});

describe("the Branding screen reads what is set — decision 0604", () => {
  it("shows the defaults until set, then what was set, when, and by whom", async () => {
    expect((await handleGetBranding(db(), "acme")).body).toEqual({
      customerId: "acme",
      customerName: "Acme Ltd",
      branding: { ...DEFAULT_BRANDING },
      set: { brandBar: null, brandFill: null, brandChip: null, brandChipText: null, brandName: null },
      defaults: DEFAULT_BRANDING,
      updatedAt: null,
      updatedBy: null,
    });
    await setBranding(db(), "acme", { brandFill: "#1d4ed8", brandName: "Acme Finance" }, "x");
    expect((await handleGetBranding(db(), "acme")).body).toMatchObject({
      branding: { brandFill: "#1d4ed8", brandName: "Acme Finance", brandBar: DEFAULT_BRANDING.brandBar },
      set: { brandFill: "#1d4ed8", brandName: "Acme Finance", brandBar: null },
      updatedBy: "x",
    });
    expect(await handleGetBranding(db(), "nobody")).toMatchObject({ status: 404 });
  });

  it("is the operator's, and records the operator Access verified as who set it", async () => {
    expect(isPrivileged("GET", "/branding/acme")).toBe(true);
    expect(isPrivileged("GET", "/branding/acme/tokens.css")).toBe(false);
    expect((await SELF.fetch("https://licence.example.com/branding/acme", { headers: { Authorization: "Bearer x" } })).status).toBe(401);
    expect((await asOperator("/branding/acme", { method: "PUT", body: JSON.stringify({ brandFill: "#7c3aed" }) })).status).toBe(200);
    const got = (await (await asOperator("/branding/acme")).json()) as { set: { brandFill: string }; updatedBy: string };
    expect(got).toMatchObject({ set: { brandFill: "#7c3aed" }, updatedBy: "dan@vibefinance.example" });
    expect((await asOperator("/ui-strings", { method: "PUT", body: JSON.stringify({ key: "zz.upgrade", locale: "de", value: "Version" }) })).status).toBe(422);
  });
});
