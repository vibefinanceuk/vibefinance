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
export type ConnectorStatus = "available" | "planned";
export type ConnectorTransport = "email" | "https" | "upload" | "sftp" | "edi" | "file_download" | "peppol";
export type ConnectorCategory = "generic" | "erp" | "automation";
export type ConnectorAuthType = "none" | "api_key_header" | "bearer" | "basic" | "oauth2_client_credentials";

/** What a connector sets on a Destination it makes: defaults the customer may change, and what is fixed. */
export interface ConnectorSettings {
  defaults: {
    method?: "POST" | "PUT";
    format?: "vf_json" | "csv";
    auth?: { type: ConnectorAuthType; header?: string };
    referencePath?: string | null;
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
  publisher: "standard";
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
    id: "oracle-fusion-payables",
    version: 1,
    direction: "destination",
    publisher: "standard",
    status: "planned",
    categories: ["erp"],
    routeId: null,
    transport: "https",
    formats: ["oracle_invoice_json"],
    multiple: true,
    vendorDocs: "https://docs.oracle.com/en/cloud/saas/financials/25d/farfa/op-invoices-post.html",
  },
  {
    id: "sap-s4hana-cloud",
    version: 1,
    direction: "destination",
    publisher: "standard",
    status: "planned",
    categories: ["erp"],
    routeId: null,
    transport: "https",
    formats: ["sap_supplier_invoice"],
    multiple: true,
  },
  {
    id: "sage-intacct",
    version: 1,
    direction: "destination",
    publisher: "standard",
    status: "planned",
    categories: ["erp"],
    routeId: null,
    transport: "https",
    formats: ["sage_ap_bill"],
    multiple: true,
    vendorDocs: "https://developer.intacct.com/api/accounts-payable/bills/",
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
