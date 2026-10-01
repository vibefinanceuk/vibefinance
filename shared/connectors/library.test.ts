import { describe, expect, it } from "vitest";
import { STANDARD_CONNECTORS, connectorOfInstance } from "./library.js";

/** **The standard connectors are consistent — decision 0589.** */
describe("the standard connector library", () => {
  it("has unique ids, and every available connector runs on a route", () => {
    const ids = STANDARD_CONNECTORS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of STANDARD_CONNECTORS.filter((x) => x.status === "available")) expect(c.routeId, c.id).not.toBeNull();
  });

  it("gives each HTTPS out connector settings whose default sign-in it allows, and fixes only what it defaults", () => {
    for (const c of STANDARD_CONNECTORS.filter((x) => x.routeId === "https-out")) {
      expect(c.settings, c.id).toBeDefined();
      expect(c.settings!.authTypes).toContain(c.settings!.defaults.auth?.type ?? "none");
      for (const key of c.settings!.fixed) expect(c.settings!.defaults[key], `${c.id} ${key}`).toBeDefined();
    }
  });

  it("gives every source connector its mechanism, and every standard route its own connector", () => {
    for (const c of STANDARD_CONNECTORS.filter((x) => x.direction === "source" && x.routeId)) expect(c.mechanism, c.id).toBeDefined();
    for (const route of ["email-in", "https-in", "file-import", "erp-csv", "https-out"]) {
      expect(connectorOfInstance(STANDARD_CONNECTORS, { route_id: route, connector_id: null })?.id).toBe(route);
    }
    expect(connectorOfInstance(STANDARD_CONNECTORS, { route_id: "https-out", connector_id: "automation-webhook" })?.id).toBe("automation-webhook");
  });
});
