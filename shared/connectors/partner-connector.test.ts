import { describe, expect, it } from "vitest";
import { PARTNER_CONNECTOR_SCHEMA, renameLists, validatePartnerDefinition, type PartnerConnectorDefinition } from "./partner-connector.js";
import { standardOutboundMapping } from "./outbound-mapping.js";

/** **A partner's connector — decision 0595.** What can be submitted, and nothing else. */

const mapping = () => {
  const m = standardOutboundMapping();
  m.invoice.push({ target: "BusinessUnit", source: "company", fx: [{ fn: "look_up", args: { list: "Business units", otherwise: "refuse" } }] });
  return m;
};
const good = (): PartnerConnectorDefinition => ({
  schema: PARTNER_CONNECTOR_SCHEMA,
  direction: "destination",
  routeId: "https-out",
  transport: "https",
  settings: { defaults: { method: "POST", format: "mapped", auth: { type: "oauth2_client_credentials" }, referencePath: "$.InvoiceId" }, fixed: ["method", "format"], authTypes: ["oauth2_client_credentials", "basic"] },
  outboundMapping: mapping(),
  lookupLists: ["Business units"],
  vendorDocs: "https://docs.oracle.com/x",
});

describe("a partner's connector — decision 0595", () => {
  it("accepts a whole definition", () => {
    expect(validatePartnerDefinition(good())).toBeNull();
    expect(validatePartnerDefinition({ ...good(), settings: { ...good().settings, defaults: { ...good().settings.defaults, format: "vf_json" } }, outboundMapping: null, lookupLists: [] })).toBeNull();
  });

  it("refuses what it cannot carry, in words", () => {
    const bad = (change: (d: PartnerConnectorDefinition & Record<string, unknown>) => void) => {
      const d = good() as PartnerConnectorDefinition & Record<string, unknown>;
      change(d);
      return validatePartnerDefinition(d);
    };
    expect(bad((d) => (d.url = "https://erp.acme.example"))).toBe("a connector does not carry url");
    expect(bad((d) => (d.secret = "x"))).toBe("a connector does not carry secret");
    expect(bad((d) => (d.settings.authTypes = ["basic"]))).toMatch(/must be one it allows/);
    expect(bad((d) => (d.lookupLists = []))).toMatch(/does not name: Business units/);
    expect(bad((d) => (d.outboundMapping = null))).toMatch(/carries its outbound mapping/);
    expect(bad((d) => (d.settings.fixed = ["url" as never]))).toMatch(/only the method and format/);
    expect(bad((d) => (d.vendorDocs = "http://x"))).toMatch(/https/);
    expect(bad((d) => (d.settings.defaults.referencePath = "id"))).toMatch(/\$\.id/);
  });

  it("swaps look-up list ids for names, and back", () => {
    const m = standardOutboundMapping();
    m.invoice.push({ target: "BU", source: "company", fx: [{ fn: "look_up", args: { list: "lst-123", otherwise: "keep" } }] });
    const named = renameLists(m, (id) => (id === "lst-123" ? "Business units" : id));
    expect(named.invoice.at(-1)!.fx[0].args).toEqual({ list: "Business units", otherwise: "keep" });
    expect(m.invoice.at(-1)!.fx[0].args!.list).toBe("lst-123");
  });
});
