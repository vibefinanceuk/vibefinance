import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleInboundEmail, type EmailMessage } from "../src/inbound-email.js";
import { handleGetRouteMessage } from "../src/route-monitor-route.js";
import { handleListRoutes } from "../src/routes-route.js";
import { handleCaptureUblXml } from "../src/intake-capture-route.js";
import { decodePdf, FACTURX_CII_B64 } from "./fixtures/pdf-fixtures.js";

/**
 * **Routes, phase 2 slice 1: structured formats in — decision 0560.**
 *
 * An e-invoice is read as data whatever its syntax: UBL, CII, or the CII
 * inside a Factur-X / ZUGFeRD PDF. Its format is recognised from what it
 * declares, the EN 16931 rules are checked, and both are recorded on the
 * message part and as facts a rule can test. A broken rule never stops
 * the invoice.
 */

const ADDRESS = "ap-mailbox.acme@vibefinance-ai.com";
const CUSTOMER = "acme";

const XRECHNUNG = "urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0";

function cii(opts: { number?: string; due?: string; spec?: string } = {}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"
  xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100"
  xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
  <rsm:ExchangedDocumentContext>
    <ram:GuidelineSpecifiedDocumentContextParameter><ram:ID>${opts.spec ?? XRECHNUNG}</ram:ID></ram:GuidelineSpecifiedDocumentContextParameter>
  </rsm:ExchangedDocumentContext>
  <rsm:ExchangedDocument>
    <ram:ID>${opts.number ?? "R-88240"}</ram:ID>
    <ram:TypeCode>380</ram:TypeCode>
    <ram:IssueDateTime><udt:DateTimeString format="102">20260929</udt:DateTimeString></ram:IssueDateTime>
  </rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>
    <ram:IncludedSupplyChainTradeLineItem>
      <ram:AssociatedDocumentLineDocument><ram:LineID>1</ram:LineID></ram:AssociatedDocumentLineDocument>
      <ram:SpecifiedTradeProduct><ram:Name>Hydraulic seal kit</ram:Name></ram:SpecifiedTradeProduct>
      <ram:SpecifiedLineTradeAgreement><ram:NetPriceProductTradePrice><ram:ChargeAmount>45.50</ram:ChargeAmount></ram:NetPriceProductTradePrice></ram:SpecifiedLineTradeAgreement>
      <ram:SpecifiedLineTradeDelivery><ram:BilledQuantity unitCode="H87">12</ram:BilledQuantity></ram:SpecifiedLineTradeDelivery>
      <ram:SpecifiedLineTradeSettlement>
        <ram:ApplicableTradeTax><ram:TypeCode>VAT</ram:TypeCode><ram:CategoryCode>S</ram:CategoryCode><ram:RateApplicablePercent>19</ram:RateApplicablePercent></ram:ApplicableTradeTax>
        <ram:SpecifiedTradeSettlementLineMonetarySummation><ram:LineTotalAmount>546.00</ram:LineTotalAmount></ram:SpecifiedTradeSettlementLineMonetarySummation>
      </ram:SpecifiedLineTradeSettlement>
    </ram:IncludedSupplyChainTradeLineItem>
    <ram:ApplicableHeaderTradeAgreement>
      <ram:BuyerReference>04011000-12345-34</ram:BuyerReference>
      <ram:SellerTradeParty>
        <ram:Name>Munch GmbH</ram:Name>
        <ram:PostalTradeAddress><ram:CountryID>DE</ram:CountryID></ram:PostalTradeAddress>
        <ram:SpecifiedTaxRegistration><ram:ID schemeID="VA">DE812345678</ram:ID></ram:SpecifiedTaxRegistration>
      </ram:SellerTradeParty>
      <ram:BuyerTradeParty>
        <ram:Name>Acme UK Ltd</ram:Name>
        <ram:PostalTradeAddress><ram:CountryID>GB</ram:CountryID></ram:PostalTradeAddress>
      </ram:BuyerTradeParty>
    </ram:ApplicableHeaderTradeAgreement>
    <ram:ApplicableHeaderTradeDelivery/>
    <ram:ApplicableHeaderTradeSettlement>
      <ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>
      <ram:SpecifiedTradePaymentTerms><ram:DueDateDateTime><udt:DateTimeString format="102">20261029</udt:DateTimeString></ram:DueDateDateTime></ram:SpecifiedTradePaymentTerms>
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:LineTotalAmount>546.00</ram:LineTotalAmount>
        <ram:TaxBasisTotalAmount>546.00</ram:TaxBasisTotalAmount>
        <ram:TaxTotalAmount currencyID="EUR">103.74</ram:TaxTotalAmount>
        <ram:GrandTotalAmount>649.74</ram:GrandTotalAmount>
        <ram:DuePayableAmount>${opts.due ?? "649.74"}</ram:DuePayableAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>`;
}

const bytesOf = (text: string) => new TextEncoder().encode(text);
const base64 = (bytes: Uint8Array) => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};

function messageWith(attachments: { filename: string; contentType: string; bytes: Uint8Array }[]): EmailMessage {
  const boundary = "----vf-formats-boundary";
  const parts = [
    `--${boundary}\r\nContent-Type: text/plain\r\n\r\nRechnung anbei.\r\n`,
    ...attachments.map(
      (a) =>
        `--${boundary}\r\nContent-Type: ${a.contentType}; name="${a.filename}"\r\n` +
        `Content-Transfer-Encoding: base64\r\n` +
        `Content-Disposition: attachment; filename="${a.filename}"\r\n\r\n${base64(a.bytes)}\r\n`
    ),
    `--${boundary}--`,
  ];
  const raw =
    `From: buchhaltung@munch.de\r\nTo: ${ADDRESS}\r\nSubject: Rechnung\r\n` +
    `Content-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n${parts.join("")}`;
  return {
    from: "buchhaltung@munch.de",
    to: ADDRESS,
    raw: new Response(raw).body as ReadableStream,
    rawSize: raw.length,
    setReject() {},
    async forward() {},
  } as EmailMessage;
}

/** Structured documents never reach a model; one that is called is a bug. */
const model = { extract: vi.fn(async () => { throw new Error("a structured invoice must not be read by a model"); }) } as never;

async function seedSource() {
  await env.DB.prepare("INSERT OR IGNORE INTO processes (id, name) VALUES ('ap', 'AP')").run();
  await env.DB.prepare("INSERT OR IGNORE INTO process_stages (id, process_id, name, sequence) VALUES ('received', 'ap', 'Received', 1)").run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO process_stage_versions (process_id, version, stage_id, sequence)
     SELECT p.id, p.version, s.id, s.sequence FROM process_stages s JOIN processes p ON p.id = s.process_id`
  ).run();
  await env.DB.prepare(
    "INSERT INTO sources (id, process_id, name, mechanism, email_address, status) VALUES ('s-ap', 'ap', 'AP Mailbox', 'email', ?, 'active')"
  )
    .bind(ADDRESS)
    .run();
  await env.DB.prepare("INSERT INTO route_instances (id, route_id, process_id, source_id) VALUES ('s-ap', 'email-in', 'ap', 's-ap')").run();
}

async function receive(attachments: { filename: string; contentType: string; bytes: Uint8Array }[]) {
  await handleInboundEmail(messageWith(attachments), env.DB, model, env.DOCUMENTS, CUSTOMER);
  const m = await env.DB.prepare("SELECT id, status FROM route_messages ORDER BY received_at DESC LIMIT 1").first<{ id: string; status: string }>();
  return m!;
}

async function attachmentPart(messageId: string) {
  return (await env.DB.prepare(
    "SELECT outcome, reason, format, syntax, en16931_failed FROM route_message_parts WHERE message_id = ? AND role = 'attachment'"
  )
    .bind(messageId)
    .first<{ outcome: string; reason: string | null; format: string | null; syntax: string | null; en16931_failed: string | null }>())!;
}

async function invoiceFacts(messageId: string) {
  const row = await env.DB.prepare(
    `SELECT h.facts_json FROM route_message_items i JOIN invoice_headers h ON h.id = i.item_id WHERE i.message_id = ?`
  )
    .bind(messageId)
    .first<{ facts_json: string }>();
  return JSON.parse(row!.facts_json) as Record<string, unknown>;
}

beforeEach(async () => {
  await applyTestSchema();
  const listed = await env.DOCUMENTS.list({ prefix: `${CUSTOMER}/` });
  for (const o of listed.objects) await env.DOCUMENTS.delete(o.key);
  vi.mocked((model as { extract: () => unknown }).extract).mockClear();
});

describe("an e-invoice by email is read as data, whatever its syntax", () => {
  it("reads an XRechnung written in CII, and records its format and checks", async () => {
    await seedSource();
    const m = await receive([{ filename: "Rechnung_88240.xml", contentType: "application/xml", bytes: bytesOf(cii()) }]);

    expect(m.status).toBe("delivered");
    expect(await attachmentPart(m.id)).toEqual({
      outcome: "captured",
      reason: null,
      format: "xrechnung",
      syntax: "cii",
      en16931_failed: "[]",
    });
    const facts = await invoiceFacts(m.id);
    expect(facts).toMatchObject({
      "BT-1": "R-88240",
      "BT-2": "2026-09-29",
      "BT-27": "Munch GmbH",
      "BT-31": "DE812345678",
      "BT-115": 649.74,
      "intake.format": "xrechnung",
      "en16931.checked": true,
      "en16931.failures": "",
    });
    expect((model as { extract: () => unknown }).extract).not.toHaveBeenCalled();
  });

  it("reads the CII inside a Factur-X / ZUGFeRD PDF, which the UBL-only path refused", async () => {
    await seedSource();
    const m = await receive([{ filename: "Rechnung.pdf", contentType: "application/pdf", bytes: decodePdf(FACTURX_CII_B64) }]);

    expect(m.status).toBe("delivered");
    expect(await attachmentPart(m.id)).toMatchObject({ outcome: "captured", format: "en16931", syntax: "cii", en16931_failed: "[]" });
    expect(await invoiceFacts(m.id)).toMatchObject({
      "BT-1": "ZUGFERD-CII-2026-002",
      "BT-27": "Lager Nord GmbH",
      "BT-112": 1190,
      "intake.structure": "structured_pdfa",
      "intake.format": "en16931",
      "en16931.failures": "",
    });
    expect((model as { extract: () => unknown }).extract).not.toHaveBeenCalled();
  });

  it("delivers an invoice that breaks a rule, and says which, where and why", async () => {
    await seedSource();
    const m = await receive([{ filename: "Rechnung_88241.xml", contentType: "application/xml", bytes: bytesOf(cii({ number: "R-88241", due: "700.00" })) }]);

    expect(m.status).toBe("delivered");
    const part = await attachmentPart(m.id);
    expect(part.outcome).toBe("captured");
    expect(JSON.parse(part.en16931_failed!)).toEqual([{ rule: "BR-CO-16", detail: "BT-115 700.00, expected 649.74" }]);
    expect((await invoiceFacts(m.id))["en16931.failures"]).toBe("BR-CO-16");

    const events = await env.DB.prepare("SELECT event, detail FROM route_message_events WHERE message_id = ? ORDER BY seq")
      .bind(m.id)
      .all<{ event: string; detail: string | null }>();
    expect(events.results).toContainEqual({ event: "en16931_failed", detail: "BR-CO-16" });
  });

  it("refuses a credit note in words, and keeps it", async () => {
    await seedSource();
    const creditNote = `<?xml version="1.0"?><CreditNote xmlns="urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2"><ID>CN-1</ID></CreditNote>`;
    const m = await receive([{ filename: "Gutschrift.xml", contentType: "application/xml", bytes: bytesOf(creditNote) }]);

    expect(m.status).toBe("failed");
    const part = await attachmentPart(m.id);
    expect(part.outcome).toBe("failed");
    expect(part.reason).toMatch(/credit note, and credit notes are not read yet/);
    expect(part.format).toBeNull();
  });
});

describe("the Route monitor and the Routes screen", () => {
  it("shows each part's format and the rules it broke", async () => {
    await seedSource();
    const m = await receive([{ filename: "Rechnung_88241.xml", contentType: "application/xml", bytes: bytesOf(cii({ due: "700.00" })) }]);

    const detail = await handleGetRouteMessage(env.DB, m.id);
    const parts = (detail.body as { parts: Array<Record<string, unknown>> }).parts;
    expect(parts.find((p) => p.role === "original")).toMatchObject({ format: null, en16931Failed: null });
    expect(parts.find((p) => p.role === "attachment")).toMatchObject({
      format: "xrechnung",
      syntax: "cii",
      en16931Failed: [{ rule: "BR-CO-16", detail: "BT-115 700.00, expected 649.74" }],
    });
  });

  it("counts a Source route's last 30 days by format, and how many broke a rule", async () => {
    await seedSource();
    await receive([{ filename: "a.xml", contentType: "application/xml", bytes: bytesOf(cii({ number: "A-1" })) }]);
    await receive([{ filename: "b.xml", contentType: "application/xml", bytes: bytesOf(cii({ number: "A-2", due: "1.00" })) }]);
    await receive([{ filename: "c.pdf", contentType: "application/pdf", bytes: decodePdf(FACTURX_CII_B64) }]);

    const listed = await handleListRoutes(env.DB);
    const email = (listed.body as { routes: Array<{ id: string; formats30d: unknown[] }> }).routes.find((r) => r.id === "email-in")!;
    expect(email.formats30d).toEqual(
      expect.arrayContaining([
        { format: "xrechnung", inPdf: false, received: 2, failing: 1 },
        { format: "en16931", inPdf: true, received: 1, failing: 0 },
      ])
    );
    const https = (listed.body as { routes: Array<{ id: string; formats30d: unknown[] }> }).routes.find((r) => r.id === "https-in")!;
    expect(https.formats30d).toEqual([]);
  });
});

describe("the capture API", () => {
  it("takes CII at /capture-xml too, and says what it was", async () => {
    await seedSource();
    await env.DB.prepare("INSERT INTO intake_channels (id, process_id, name) VALUES ('ch-xml', 'ap', 'XML')").run();
    const result = await handleCaptureUblXml(env.DB, "ch-xml", cii({ number: "API-1" }));
    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({ format: "xrechnung", syntax: "cii", en16931: { checked: 30, failed: [] } });
  });
});
