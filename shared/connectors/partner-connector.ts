import type { ConnectorAuthType, ConnectorDefinition } from "./library.js";
import { listsInOutbound, validateOutboundMapping, type OutboundMapping } from "./outbound-mapping.js";

/**
 * **A partner's connector — decision 0595**, step 2 of slice 4 of the
 * connector framework.
 *
 * What a partner submits from a Destination in its sandbox, for
 * VibeFinance to review (step 3) and its linked customers to add (step
 * 4): the way it sends and signs in, which of those a customer may not
 * change, where the target's reference is, and its outbound mapping.
 *
 * - **Never the address or a secret.** Each customer sends to its own
 *   ERP and signs in with its own credentials.
 * - **Look-up lists by name.** A list is the customer's own (company →
 *   business unit, say): the mapping names it, and each customer fills in
 *   a list of that name. In the sandbox a mapping holds list ids; the
 *   definition holds their names.
 */

export const PARTNER_CONNECTOR_SCHEMA = "vibefinance.connector.v1";
const AUTH_TYPES: ConnectorAuthType[] = ["none", "api_key_header", "bearer", "basic", "oauth2_client_credentials"];

export interface PartnerConnectorDefinition {
  schema: typeof PARTNER_CONNECTOR_SCHEMA;
  direction: "destination";
  routeId: "https-out";
  transport: "https";
  settings: {
    defaults: {
      method: "POST" | "PUT";
      format: "vf_json" | "csv" | "mapped";
      auth: { type: ConnectorAuthType; header?: string };
      referencePath: string | null;
    };
    fixed: Array<"method" | "format">;
    authTypes: ConnectorAuthType[];
  };
  /** Present when the format is `mapped`; its look-up lists named by list name. */
  outboundMapping: OutboundMapping | null;
  /** The look-up lists the mapping reads, by name: each customer fills one in. */
  lookupLists: string[];
  /** Where the target documents its API, for whoever sets it up. */
  vendorDocs: string | null;
}

/** Why a definition cannot be submitted, or null where it can. */
export function validatePartnerDefinition(input: unknown): string | null {
  const d = input as PartnerConnectorDefinition;
  if (!d || typeof d !== "object") return "a connector is an object";
  if (d.schema !== PARTNER_CONNECTOR_SCHEMA) return `the schema is ${PARTNER_CONNECTOR_SCHEMA}`;
  if (d.direction !== "destination" || d.routeId !== "https-out" || d.transport !== "https") return "a partner connector is an HTTPS out Destination";
  const s = d.settings;
  if (!s || !s.defaults) return "a connector has settings";
  if (s.defaults.method !== "POST" && s.defaults.method !== "PUT") return "the method is POST or PUT";
  if (!["vf_json", "csv", "mapped"].includes(s.defaults.format)) return "the format is vf_json, csv or mapped";
  if (!s.defaults.auth || !AUTH_TYPES.includes(s.defaults.auth.type)) return "say how it signs in";
  if (s.defaults.auth.type === "api_key_header" && !/^[A-Za-z0-9-]{1,64}$/.test(s.defaults.auth.header ?? "")) return "name the header the key goes in";
  if (s.defaults.referencePath !== null && (typeof s.defaults.referencePath !== "string" || !/^\$(\.[A-Za-z0-9_-]+|\[\d+\])+$/.test(s.defaults.referencePath))) {
    return "the reference is a path such as $.id";
  }
  if (!Array.isArray(s.fixed) || s.fixed.some((f) => f !== "method" && f !== "format")) return "only the method and format can be fixed";
  if (!Array.isArray(s.authTypes) || s.authTypes.length === 0 || s.authTypes.some((a) => !AUTH_TYPES.includes(a))) return "allow at least one way of signing in";
  if (!s.authTypes.includes(s.defaults.auth.type)) return "the way it signs in must be one it allows";
  if (s.defaults.format === "mapped") {
    if (!d.outboundMapping) return "a connector that sends its own layout carries its outbound mapping";
    const invalid = validateOutboundMapping(d.outboundMapping);
    if (invalid) return `its outbound mapping: ${invalid}`;
    const named = listsInOutbound(d.outboundMapping);
    const missing = named.filter((n) => !(d.lookupLists ?? []).includes(n));
    if (missing.length > 0) return `its mapping reads look-up lists it does not name: ${missing.join(", ")}`;
  } else if (d.outboundMapping) {
    return "only a connector sending its own layout carries a mapping";
  }
  if (!Array.isArray(d.lookupLists) || d.lookupLists.some((n) => typeof n !== "string" || !n.trim())) return "look-up lists are named";
  if (d.vendorDocs !== null && (typeof d.vendorDocs !== "string" || !/^https:\/\//.test(d.vendorDocs))) return "the vendor's documentation is an https:// address";
  // Never a secret or an address: there is nowhere in the shape to put one, and nothing else is accepted.
  const known = new Set(["schema", "direction", "routeId", "transport", "settings", "outboundMapping", "lookupLists", "vendorDocs"]);
  const extra = Object.keys(d).find((k) => !known.has(k));
  if (extra) return `a connector does not carry ${extra}`;
  return null;
}

/** A mapping's look-up list ids, swapped for names (sandbox → definition) or names for ids (definition → customer). */
export function renameLists(mapping: OutboundMapping, rename: (list: string) => string): OutboundMapping {
  const copy = structuredClone(mapping);
  for (const f of [...copy.invoice, ...copy.lines.fields, ...copy.distributions.fields]) {
    for (const step of f.fx) {
      if (step.fn === "look_up" && step.args) step.args = { ...step.args, list: rename(String(step.args.list)) };
    }
  }
  return copy;
}

/** The library id of a partner's connector: never one of the standard ids. */
export const partnerLibraryId = (connectorId: string) => `partner:${connectorId}`;

/**
 * **A partner's approved connector as a library entry — decision 0601.**
 * Step 4 of slice 4: it is listed, added and upgraded as a standard one
 * is, labelled with its partner, carrying its mapping and the look-up
 * lists it needs by name.
 */
export function partnerLibraryEntry(
  meta: { connectorId: string; version: number; name: string; description: string; partner: { id: string; name: string }; offered: boolean },
  d: PartnerConnectorDefinition
): ConnectorDefinition {
  return {
    id: partnerLibraryId(meta.connectorId),
    version: meta.version,
    direction: "destination",
    publisher: "partner",
    partner: meta.partner,
    name: meta.name,
    description: meta.description,
    status: meta.offered ? "available" : "withdrawn",
    categories: ["partner"],
    routeId: "https-out",
    transport: "https",
    formats: [d.settings.defaults.format],
    multiple: true,
    settings: {
      defaults: { ...d.settings.defaults, auth: { ...d.settings.defaults.auth } },
      fixed: [...d.settings.fixed],
      authTypes: [...d.settings.authTypes],
    },
    outboundMapping: d.outboundMapping,
    lookupLists: [...d.lookupLists],
    ...(d.vendorDocs ? { vendorDocs: d.vendorDocs } : {}),
  };
}
