import type { OutboundMapping } from "./outbound-mapping.js";
import { ORACLE_LISTS, oracleFusionPayablesMapping } from "./oracle-fusion-payables.js";
import { SAP_LISTS, sapS4hanaCloudMapping } from "./sap-s4hana-cloud.js";
import { INTACCT_BILL_URL, INTACCT_LISTS, INTACCT_TOKEN_URL, sageIntacctMapping } from "./sage-intacct.js";

/**
 * **The connector library — decision 0589**, slice 2 of the connector
 * framework (`claude/connector-framework-design.md`).
 *
 * A connector is a route definition written as data: which way it goes,
 * which route (and so which transport and engine) it runs on, what it
 * sends, how it may sign in, what it fills in for you and what it keeps
 * fixed. The transports are code (HTTPS out, the ERP CSV file, email in,
 * HTTPS in, AP upload); everything particular to one target is here.
 *
 * **Standard connectors ship with the platform**, here in `shared`, so
 * every instance runs exactly the definitions its code was built with
 * and they can never drift apart. Partner connectors, published from the
 * control plane, come in slice 4 and take the same shape.
 *
 * **Versioned.** A Destination records the connector and version it was
 * made from. A later version here is offered to it as an upgrade, which
 * applies what the connector fixes and leaves the customer's own
 * settings alone.
 *
 * Names and descriptions are interface strings: `connector.<id>.name`
 * and `connector.<id>.description`, in `vf-licence`.
 */

export type ConnectorDirection = "source" | "destination";
/** Decision 0601: "withdrawn", a partner connector no longer offered, kept for the Destinations made from it. */
export type ConnectorStatus = "available" | "planned" | "withdrawn";
export type ConnectorTransport = "email" | "https" | "upload" | "sftp" | "edi" | "file_download" | "peppol";
export type ConnectorCategory = "generic" | "erp" | "automation" | "partner";
export type ConnectorAuthType = "none" | "api_key_header" | "bearer" | "basic" | "oauth2_client_credentials";

/** What a connector sets on a Destination it makes: defaults the customer may change, and what is fixed. */
export interface ConnectorSettings {
  defaults: {
    /** Decision 0607: an address that is the same for every customer, such as Sage Intacct's. */
    url?: string;
    method?: "POST" | "PUT";
    /** "mapped": its own layout, from the outbound mapping it carries (a partner's, decision 0601). */
    format?: "vf_json" | "csv" | "mapped";
    /** Decision 0607: and, for OAuth, a token address that is the same for every customer. */
    auth?: { type: ConnectorAuthType; header?: string; tokenUrl?: string };
    referencePath?: string | null;
    /** Decision 0606: fetch a CSRF token first, as SAP's OData services need. */
    csrf?: boolean;
  };
  /** Settings the customer cannot change while using this connector: "method", "format". */
  fixed: Array<"method" | "format">;
  /** The ways of signing in it allows. */
  authTypes: ConnectorAuthType[];
}

export interface ConnectorDefinition {
  id: string;
  version: number;
  direction: ConnectorDirection;
  publisher: "standard" | "partner";
  /** Decision 0601: a partner's connector says whose it is, and carries its own name and description. */
  partner?: { id: string; name: string };
  name?: string;
  description?: string;
  /** Its outbound mapping, look-up lists named by list name, and the lists it reads (a partner's). */
  outboundMapping?: OutboundMapping | null;
  lookupLists?: string[];
  status: ConnectorStatus;
  categories: ConnectorCategory[];
  /** The route it runs on: its transport and engine. Null for one not built yet. */
  routeId: string | null;
  transport: ConnectorTransport;
  /** What it carries, as interface words: `connector.format.<f>`. */
  formats: string[];
  /** For a Source: the mechanism a source made from it receives by. */
  mechanism?: "email" | "https" | "file_import" | "sftp" | "edi";
  /** Whether a process may have more than one. */
  multiple: boolean;
  /** For an HTTPS out Destination. */
  settings?: ConnectorSettings;
  /** Where its target documents its API, for whoever sets it up. */
  vendorDocs?: string;
  /** Decision 0605: available, but not yet proven against the real system. */
  maturity?: "first_version";
}

const ALL_AUTH: ConnectorAuthType[] = ["none", "api_key_header", "bearer", "basic", "oauth2_client_credentials"];

export const STANDARD_CONNECTORS: ConnectorDefinition[] = [
  // --- Destinations -----------------------------------------------------------------
  {
    id: "https-out",
    version: 1,
    direction: "destination",
    publisher: "standard",
    status: "available",
    categories: ["generic"],
    routeId: "https-out",
    transport: "https",
    formats: ["vf_json", "csv"],
    multiple: true,
    settings: { defaults: { method: "POST", format: "vf_json", auth: { type: "none" }, referencePath: null }, fixed: [], authTypes: ALL_AUTH },
  },
  {
    id: "automation-webhook",
    version: 1,
    direction: "destination",
    publisher: "standard",
    status: "available",
    categories: ["automation"],
    routeId: "https-out",
    transport: "https",
    formats: ["vf_json"],
    multiple: true,
    // Zapier, Make and Power Automate all start a flow from a webhook that receives JSON.
    settings: { defaults: { method: "POST", format: "vf_json", auth: { type: "none" }, referencePath: null }, fixed: ["method", "format"], authTypes: ["none", "api_key_header"] },
  },
  {
    id: "erp-csv",
    version: 1,
    direction: "destination",
    publisher: "standard",
    status: "available",
    categories: ["generic", "erp"],
    routeId: "erp-csv",
    transport: "file_download",
    formats: ["csv"],
    multiple: false,
  },
  {
    // Decision 0605: the first ERP connector, built from Oracle's documented API; a first version.
    id: "oracle-fusion-payables",
    version: 1,
    direction: "destination",
    publisher: "standard",
    status: "available",
    maturity: "first_version",
    categories: ["erp"],
    routeId: "https-out",
    transport: "https",
    formats: ["oracle_invoice_json"],
    multiple: true,
    settings: {
      defaults: { method: "POST", format: "mapped", auth: { type: "basic" }, referencePath: "$.InvoiceId" },
      fixed: ["method", "format"],
      authTypes: ["basic", "oauth2_client_credentials"],
    },
    outboundMapping: oracleFusionPayablesMapping(),
    lookupLists: Object.values(ORACLE_LISTS),
    vendorDocs: "https://docs.oracle.com/en/cloud/saas/financials/25d/farfa/op-invoices-post.html",
  },
  {
    // Decision 0606: the second ERP connector, built from SAP's documented API; a first version.
    id: "sap-s4hana-cloud",
    version: 1,
    direction: "destination",
    publisher: "standard",
    status: "available",
    maturity: "first_version",
    categories: ["erp"],
    routeId: "https-out",
    transport: "https",
    formats: ["sap_supplier_invoice"],
    multiple: true,
    settings: {
      defaults: { method: "POST", format: "mapped", auth: { type: "basic" }, referencePath: "$.d.SupplierInvoice", csrf: true },
      fixed: ["method", "format"],
      authTypes: ["basic", "oauth2_client_credentials"],
    },
    outboundMapping: sapS4hanaCloudMapping(),
    lookupLists: Object.values(SAP_LISTS),
    vendorDocs: "https://api.sap.com/api/API_SUPPLIERINVOICE_PROCESS_SRV/overview",
  },
  {
    // Decision 0607: the third ERP connector, through Sage's REST API; a first version.
    id: "sage-intacct",
    version: 1,
    direction: "destination",
    publisher: "standard",
    status: "available",
    maturity: "first_version",
    categories: ["erp"],
    routeId: "https-out",
    transport: "https",
    formats: ["sage_ap_bill"],
    multiple: true,
    settings: {
      defaults: {
        url: INTACCT_BILL_URL,
        method: "POST",
        format: "mapped",
        auth: { type: "oauth2_client_credentials", tokenUrl: INTACCT_TOKEN_URL },
        referencePath: "$.ia::result.key",
      },
      fixed: ["method", "format"],
      authTypes: ["oauth2_client_credentials"],
    },
    outboundMapping: sageIntacctMapping(),
    lookupLists: Object.values(INTACCT_LISTS),
    vendorDocs: "https://developer.sage.com/intacct/docs/openapi/ap/accounts-payable.bill/",
  },
  {
    id: "dynamics-365-bc",
    version: 1,
    direction: "destination",
    publisher: "standard",
    status: "planned",
    categories: ["erp"],
    routeId: null,
    transport: "https",
    formats: ["bc_purchase_invoice"],
    multiple: true,
  },
  {
    id: "sftp-out",
    version: 1,
    direction: "destination",
    publisher: "standard",
    status: "planned",
    categories: ["generic"],
    routeId: null,
    transport: "sftp",
    formats: ["csv", "ubl"],
    multiple: true,
  },
  // --- Sources ----------------------------------------------------------------------
  { id: "email-in", version: 1, direction: "source", publisher: "standard", status: "available", categories: ["generic"], routeId: "email-in", transport: "email", formats: ["detected"], mechanism: "email", multiple: true },
  { id: "https-in", version: 1, direction: "source", publisher: "standard", status: "available", categories: ["generic"], routeId: "https-in", transport: "https", formats: ["detected"], mechanism: "https", multiple: true },
  { id: "file-import", version: 1, direction: "source", publisher: "standard", status: "available", categories: ["generic"], routeId: "file-import", transport: "upload", formats: ["detected"], mechanism: "file_import", multiple: false },
  { id: "sftp-in", version: 1, direction: "source", publisher: "standard", status: "planned", categories: ["generic"], routeId: "sftp-in", transport: "sftp", formats: ["detected"], mechanism: "sftp", multiple: true },
  { id: "edi-in", version: 1, direction: "source", publisher: "standard", status: "planned", categories: ["generic"], routeId: "edi-in", transport: "edi", formats: ["edifact"], mechanism: "edi", multiple: true },
  { id: "peppol-in", version: 1, direction: "source", publisher: "standard", status: "planned", categories: ["generic"], routeId: null, transport: "peppol", formats: ["ubl"], multiple: false },
];

export function connectorById(library: ConnectorDefinition[], id: string): ConnectorDefinition | null {
  return library.find((c) => c.id === id) ?? null;
}

/**
 * The connector a route instance runs: the one it was made from, else
 * the route's own standard connector (every standard route has one of
 * the same id), so instances made before the library still have one.
 */
export function connectorOfInstance(
  library: ConnectorDefinition[],
  instance: { route_id: string; connector_id: string | null }
): ConnectorDefinition | null {
  return connectorById(library, instance.connector_id ?? instance.route_id);
}
