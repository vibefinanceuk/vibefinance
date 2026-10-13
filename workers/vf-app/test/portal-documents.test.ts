import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { signPortalToken, PORTAL_ACCESS_TTL_SECONDS, type PortalAccessClaims } from "@vibefinance/shared";
import { handlePutNetworkSharingConfig, handleGetNetworkSharingConfig } from "../src/receipt-sharing.js";

/**
 * **An invoice's own document, in the supplier network — decision 0770.**
 * Lager Nord's INV-1 came in as an e-invoice (its XML, and the page drawn
 * from it), in an email that also carried another supplier's invoice.
 * INV-2 is a PDF. INV-9 is another supplier's.
 */

const PRIVATE_KEY: JsonWebKey = {
  key_ops: ["sign"],
  ext: true,
  kty: "EC",
  x: "U-Zs04Hy_MlWHr9GlT1gZJgkbxmqFRJmP1VcTUx2Xmg",
  y: "okr43t1WZRRR27D1U_M2Ao18PjA6Fuk19NSuJ0MCijg",
  crv: "P-256",
  d: "meU9gflxUslwDVkLkdadGBdCX1VLlDcg1YDTdbUY3vk",
};

function access(o: Partial<PortalAccessClaims> = {}): Promise<string> {
  const now = new Date();
  return signPortalToken(
    {
      kind: "portal_access",
      email: "jo@lager-nord.example",
      supplierOrgId: "so-1",
      linkId: "pl-1",
      environmentId: "test-environment",
      supplierId: "sup-ln",
      orgUnitIds: ["uk"],
      issuedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + PORTAL_ACCESS_TTL_SECONDS * 1000).toISOString(),
      ...o,
    },
    PRIVATE_KEY
  );
}
const get = (path: string, token: string) => SELF.fetch(`https://app.example.com${path}`, { headers: { Authorization: `Bearer ${token}` } });
const XML = '<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"><ID>INV-1</ID><Note>&lt;script&gt;alert(1)&lt;/script&gt;</Note></Invoice>';
const PAGE = "<html><body><h1>Commercial invoice</h1></body></html>";

async function doc(invoiceId: string, type: string, contentType: string, body: string | Uint8Array) {
  const key = `test/${invoiceId}/${type}`;
  await env.DOCUMENTS.put(key, body);
  await env.DB.prepare("INSERT INTO invoice_documents (id, invoice_id, r2_key, document_type, content_type) VALUES (?, ?, ?, ?, ?)").bind(`${invoiceId}-${type}`, invoiceId, key, type, contentType).run();
}

beforeEach(async () => {
  await applyTestSchema();
  const claims = { customerId: "c", plan: "standard", features: ["supplier_portal"], volumeEntitlement: 1000, status: "active", issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 864e5).toISOString() };
  await env.DB.prepare("INSERT OR REPLACE INTO licence_cache (id, claims_json, fetched_at) VALUES (1, ?, ?)").bind(JSON.stringify(claims), new Date().toISOString()).run();
  await env.DB.prepare("INSERT INTO org_units (id, name) VALUES ('uk', 'Acme UK Ltd')").run();
  await env.DB.prepare("INSERT INTO suppliers (id, name, vat_id) VALUES ('sup-ln', 'Lager Nord GmbH', 'DE123456789'), ('sup-x', 'Other Ltd', 'GB999')").run();
  await env.DB.prepare(
    `INSERT INTO invoice_headers (id, facts_json, org_unit_id, supplier_id, created_at) VALUES
     ('inv-1', json_object('BT-1', 'INV-1', 'BT-3', '380'), 'uk', 'sup-ln', '2026-10-10 09:00:00'),
     ('inv-2', json_object('BT-1', 'INV/2', 'BT-3', '380'), 'uk', 'sup-ln', '2026-10-11 09:00:00'),
     ('inv-9', json_object('BT-1', 'INV-9', 'BT-3', '380'), 'uk', 'sup-x', '2026-10-12 09:00:00')`
  ).run();
  await doc("inv-1", "original", "application/xml", XML);
  await doc("inv-1", "generated_rendering", "text/html; charset=utf-8", PAGE);
  await doc("inv-2", "original", "application/pdf", new Uint8Array([37, 80, 68, 70, 45]));
  await doc("inv-9", "original", "application/pdf", new Uint8Array([37, 80, 68, 70, 45]));
  // The email INV-1 came in, with another supplier's invoice: a route message's parts, never an invoice's documents.
  await env.DB.prepare("INSERT INTO route_messages (id, direction, status, counterparty, subject, received_at) VALUES ('m1', 'in', 'delivered', 'ap@acme.example', 'Fwd: invoices', '2026-10-10T09:00:00Z')").run();
});

describe("the supplier sees the document they sent (decision 0770)", () => {
  it("lists an invoice's own documents with the invoice: the page drawn first, then the e-invoice", async () => {
    const body = (await (await get("/portal/invoices/inv-1", await access())).json()) as { invoice: { documentFiles: unknown } };
    expect(body.invoice.documentFiles).toEqual([
      { key: "generated_rendering", name: "INV-1.html", contentType: "text/html; charset=utf-8" },
      { key: "original", name: "INV-1.xml", contentType: "application/xml" },
    ]);
  });

  it("shows the page to look at, unable to run anything; gives each file to download, named for the invoice", async () => {
    const token = await access();
    const page = await get("/portal/invoices/inv-1/document", token);
    expect(page.status).toBe(200);
    expect(page.headers.get("Content-Type")).toContain("text/html");
    expect(page.headers.get("Content-Security-Policy")).toContain("sandbox");
    expect(page.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await page.text()).toContain("Commercial invoice");
    const xmlView = await get("/portal/invoices/inv-1/document?file=original", token);
    expect(xmlView.headers.get("Content-Type")).toContain("text/html");
    expect(xmlView.headers.get("Content-Security-Policy")).toContain("sandbox");
    const xml = await get("/portal/invoices/inv-1/document?file=original&download=1", token);
    expect([xml.headers.get("Content-Type"), xml.headers.get("Content-Disposition")]).toEqual(["application/xml", 'attachment; filename="INV-1.xml"']);
    expect(await xml.text()).toBe(XML);
    const pdf = await get("/portal/invoices/inv-2/document", token);
    expect([pdf.status, pdf.headers.get("Content-Type"), pdf.headers.get("Content-Disposition"), pdf.headers.get("Content-Security-Policy")]).toEqual([200, "application/pdf", "inline", null]);
    expect((await get("/portal/invoices/inv-2/document?download=1", token)).headers.get("Content-Disposition")).toBe('attachment; filename="INV_2.pdf"');
  });

  it("nothing of another supplier's invoice, a file the invoice does not have, or without a token", async () => {
    const token = await access();
    expect((await get("/portal/invoices/inv-9/document", token)).status).toBe(404);
    expect((await get("/portal/invoices/inv-2/document?file=embedded_xml", token)).status).toBe(404);
    expect((await get("/portal/invoices/inv-2/document?file=../m1", token)).status).toBe(404);
    expect((await SELF.fetch("https://app.example.com/portal/invoices/inv-2/document")).status).toBe(401);
  });

  it("none at all once AP Setup turns it off; on by default", async () => {
    expect(((await handleGetNetworkSharingConfig(env.DB)).body as { config: { shareDocuments: boolean } }).config.shareDocuments).toBe(true);
    await handlePutNetworkSharingConfig(env.DB, "u1", { shareDocuments: false });
    const token = await access();
    expect((await get("/portal/invoices/inv-1/document", token)).status).toBe(404);
    const body = (await (await get("/portal/invoices/inv-1", token)).json()) as { invoice: { documentFiles: unknown } };
    expect(body.invoice.documentFiles).toEqual([]);
    await handlePutNetworkSharingConfig(env.DB, "u1", { shareDocuments: true });
    expect((await get("/portal/invoices/inv-1/document", token)).status).toBe(200);
  });
});
