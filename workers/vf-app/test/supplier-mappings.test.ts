import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleInboundEmail, type EmailMessage } from "../src/inbound-email.js";
import { handleGetRouteMessage } from "../src/route-monitor-route.js";
import { handleReprocessMessage } from "../src/route-reprocess.js";
import {
  domainOf,
  handleCompileFunction,
  handleCreateMapping,
  handleGetMapping,
  handleListMappings,
  handlePublishMapping,
  handleRetireMapping,
  handleSaveDraft,
  handleTryMapping,
  senderMatches,
} from "../src/supplier-mapping-route.js";

/**
 * **Supplier mappings — decision 0561.** A supplier's own XML fails with
 * its root kept; a mapping is drawn from that kept message, its lines
 * saved as a draft, tried on the sample, published, and the failed
 * message reprocessed through it. Later mail from that supplier is read
 * through it directly; a value it cannot read fails in words.
 */

const ADDRESS = "ap-mailbox.acme@vibefinance-ai.com";
const CUSTOMER = "acme";

const munch = (opts: { date?: string; number?: string } = {}) => `<?xml version="1.0" encoding="UTF-8"?>
<Rechnung xmlns="urn:munch:rechnung">
  <Kopf><Rechnungsnummer>${opts.number ?? "88240"}</Rechnungsnummer><Datum>${opts.date ?? "29.09.2026"}</Datum><Faelligkeit>29.10.2026</Faelligkeit><Waehrung>EUR</Waehrung></Kopf>
  <Lieferant><Name>Munch GmbH</Name><UStIdNr>DE812345678</UStIdNr></Lieferant>
  <Kunde><Name>Acme UK Ltd</Name><Land>GB</Land></Kunde>
  <Position nr="1"><Beschreibung>Hydraulic seal kit</Beschreibung><Menge>12</Menge><Einheit>Stk</Einheit><Einzelpreis>45,50</Einzelpreis><Netto>546,00</Netto></Position>
  <Summen><Netto>546,00</Netto><MwSt>103,74</MwSt><Brutto>649,74</Brutto></Summen>
</Rechnung>`;

const dc = [{ fn: "decimal_comma" }];
const DEFINITION = {
  linesPath: "Rechnung/Position",
  lines: [
    { target: "BT-1", source: "Rechnung/Kopf/Rechnungsnummer", fx: [] },
    { target: "BT-2", source: "Rechnung/Kopf/Datum", fx: [{ fn: "read_date", args: { pattern: "dd.MM.yyyy" } }], say: "day.month.year" },
    { target: "BT-3", source: null, fx: [{ fn: "always", args: { value: "380" } }] },
    { target: "BT-5", source: "Rechnung/Kopf/Waehrung", fx: [] },
    { target: "BT-9", source: "Rechnung/Kopf/Faelligkeit", fx: [{ fn: "read_date", args: { pattern: "dd.MM.yyyy" } }] },
    { target: "BT-27", source: "Rechnung/Lieferant/Name", fx: [] },
    { target: "BT-31", source: "Rechnung/Lieferant/UStIdNr", fx: [] },
    { target: "BT-40", source: "Rechnung/Lieferant/UStIdNr", fx: [{ fn: "first_letters", args: { n: 2 } }] },
    { target: "BT-44", source: "Rechnung/Kunde/Name", fx: [] },
    { target: "BT-55", source: "Rechnung/Kunde/Land", fx: [] },
    { target: "BT-106", source: "Rechnung/Summen/Netto", fx: dc },
    { target: "BT-109", source: "Rechnung/Summen/Netto", fx: dc },
    { target: "BT-110", source: "Rechnung/Summen/MwSt", fx: dc },
    { target: "BT-112", source: "Rechnung/Summen/Brutto", fx: dc },
    { target: "BT-115", source: "Rechnung/Summen/Brutto", fx: dc },
    { target: "BT-126", source: "@nr", fx: [] },
    { target: "BT-129", source: "Menge", fx: [] },
    { target: "BT-130", source: "Einheit", fx: [{ fn: "unit_code" }] },
    { target: "BT-131", source: "Netto", fx: dc },
    { target: "BT-146", source: "Einzelpreis", fx: dc },
    { target: "BT-153", source: "Beschreibung", fx: [] },
  ],
};

const base64 = (bytes: Uint8Array) => {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};

function email(from: string, xml: string, filename = "Rechnung_88240.xml"): EmailMessage {
  const boundary = "----vf-map-boundary";
  const raw =
    `From: ${from}\r\nTo: ${ADDRESS}\r\nSubject: Rechnung\r\nContent-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n` +
    `--${boundary}\r\nContent-Type: text/plain\r\n\r\nAnbei.\r\n` +
    `--${boundary}\r\nContent-Type: application/xml; name="${filename}"\r\nContent-Transfer-Encoding: base64\r\n` +
    `Content-Disposition: attachment; filename="${filename}"\r\n\r\n${base64(new TextEncoder().encode(xml))}\r\n--${boundary}--`;
  return { from, to: ADDRESS, raw: new Response(raw).body as ReadableStream, rawSize: raw.length, setReject() {}, async forward() {} } as EmailMessage;
}

const model = { extract: vi.fn(async () => { throw new Error("a supplier's XML must not be read by a model"); }) } as never;

async function seed() {
  await env.DB.prepare("INSERT OR IGNORE INTO processes (id, name) VALUES ('ap', 'AP')").run();
  await env.DB.prepare("INSERT OR IGNORE INTO process_stages (id, process_id, name, sequence) VALUES ('received', 'ap', 'Received', 1)").run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO process_stage_versions (process_id, version, stage_id, sequence)
     SELECT p.id, p.version, s.id, s.sequence FROM process_stages s JOIN processes p ON p.id = s.process_id`
  ).run();
  await env.DB.prepare("INSERT OR IGNORE INTO org_users (id, name, email) VALUES ('u-dan', 'Dan Young', 'dan@acme.co.uk')").run();
  await env.DB.prepare(
    "INSERT INTO sources (id, process_id, name, mechanism, email_address, status) VALUES ('s-ap', 'ap', 'AP Mailbox', 'email', ?, 'active')"
  )
    .bind(ADDRESS)
    .run();
  await env.DB.prepare("INSERT INTO route_instances (id, route_id, process_id, source_id) VALUES ('s-ap', 'email-in', 'ap', 's-ap')").run();
}

async function receive(from: string, xml: string) {
  await handleInboundEmail(email(from, xml), env.DB, model, env.DOCUMENTS, CUSTOMER);
  return (await env.DB.prepare("SELECT id, status FROM route_messages ORDER BY received_at DESC, rowid DESC LIMIT 1").first<{ id: string; status: string }>())!;
}

async function part(messageId: string) {
  return (await env.DB.prepare(
    "SELECT outcome, reason, format, syntax, xml_root, mapping_id, mapping_version, mapping_miss, en16931_failed FROM route_message_parts WHERE message_id = ? AND role = 'attachment'"
  )
    .bind(messageId)
    .first<Record<string, unknown>>())!;
}

async function facts(messageId: string) {
  const row = await env.DB.prepare("SELECT h.facts_json FROM route_message_items i JOIN invoice_headers h ON h.id = i.item_id WHERE i.message_id = ?")
    .bind(messageId)
    .first<{ facts_json: string }>();
  return row ? (JSON.parse(row.facts_json) as Record<string, unknown>) : null;
}

/** A failed Munch message, a mapping drawn from it, its lines saved, and published. */
async function publishedMapping() {
  const failed = await receive("buchhaltung@munch.de", munch());
  const created = await handleCreateMapping(env.DB, env.DOCUMENTS, "u-dan", { messageId: failed.id, partSeq: 1 });
  const id = (created.body as { id: string }).id;
  await handleSaveDraft(env.DB, "u-dan", id, { definition: DEFINITION });
  const published = await handlePublishMapping(env.DB, env.DOCUMENTS, "u-dan", id);
  return { failed, id, published };
}

beforeEach(async () => {
  await applyTestSchema();
  const listed = await env.DOCUMENTS.list({ prefix: `${CUSTOMER}/` });
  for (const o of listed.objects) await env.DOCUMENTS.delete(o.key);
  await seed();
});

describe("a supplier's own XML, before any mapping", () => {
  it("fails at translation, keeping its root element for the monitor to offer mapping it", async () => {
    const m = await receive("buchhaltung@munch.de", munch());
    expect(m.status).toBe("failed");
    expect(await part(m.id)).toMatchObject({
      outcome: "failed",
      format: "supplier_xml",
      syntax: null,
      xml_root: "Rechnung",
      mapping_id: null,
    });
    expect((await part(m.id)).reason).toBe("this is <Rechnung>, a supplier's own XML, and no mapping on this route reads it yet");
    const detail = await handleGetRouteMessage(env.DB, m.id);
    expect((detail.body as { parts: Array<Record<string, unknown>> }).parts.find((p) => p.role === "attachment")).toMatchObject({
      xmlRoot: "Rechnung",
      mapping: null,
    });
  });
});

describe("drawing a mapping from a kept message", () => {
  it("creates an empty draft for the route, the root, the lines' group and the sender's domain", async () => {
    const m = await receive("Buchhaltung <buchhaltung@munch.de>", munch());
    const created = await handleCreateMapping(env.DB, env.DOCUMENTS, "u-dan", { messageId: m.id, partSeq: 1 });
    expect(created.status).toBe(201);
    const id = (created.body as { id: string }).id;
    expect(id).toMatch(/^MAP-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);

    const read = await handleGetMapping(env.DB, env.DOCUMENTS, id);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a test reading a nested response
    const body = read.body as Record<string, any>;
    expect(body.mapping).toMatchObject({ routeId: "email-in", name: "munch.de <Rechnung>", root: "Rechnung", senders: ["@munch.de"] });
    expect(body.editing).toMatchObject({ version: 1, status: "draft", definition: { root: "Rechnung", linesPath: "Rechnung/Position", lines: [] } });
    expect(body.editing.sample).toEqual({ messageId: m.id, partSeq: 1, filename: "Rechnung_88240.xml" });
    expect(body.described.elements).toContainEqual({ path: "Rechnung/Kopf/Datum", sample: "29.09.2026", count: 1 });
    expect(body.targets).toContainEqual(expect.objectContaining({ id: "BT-2", kind: "date", line: false, required: true }));
    expect(body.targets).toContainEqual(expect.objectContaining({ id: "BT-131", kind: "number", line: true, required: true }));
    expect(body.waiting).toBe(1);
  });

  it("refuses a message that is UBL or CII, which a standard mapping reads", async () => {
    const ubl = `<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"><cbc:ID xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">1</cbc:ID></Invoice>`;
    const m = await receive("x@y.de", ubl);
    const created = await handleCreateMapping(env.DB, env.DOCUMENTS, "u-dan", { messageId: m.id, partSeq: 1 });
    expect(created).toMatchObject({ status: 422, body: { reason: "standard_format" } });
  });

  it("saves only a draft it could run, and says why not", async () => {
    const m = await receive("buchhaltung@munch.de", munch());
    const id = ((await handleCreateMapping(env.DB, env.DOCUMENTS, "u-dan", { messageId: m.id, partSeq: 1 })).body as { id: string }).id;
    const bad = await handleSaveDraft(env.DB, "u-dan", id, { definition: { linesPath: null, lines: [{ target: "BT-2", source: "x", fx: [{ fn: "eval" }] }] } });
    expect(bad).toEqual({ status: 422, body: { error: 'BT-2: "eval" is not a function', reason: "invalid_mapping" } });
  });
});

describe("try, publish, and reprocess", () => {
  it("tries the draft on its sample: the facts, the lines, and the EN 16931 checks", async () => {
    const m = await receive("buchhaltung@munch.de", munch());
    const id = ((await handleCreateMapping(env.DB, env.DOCUMENTS, "u-dan", { messageId: m.id, partSeq: 1 })).body as { id: string }).id;
    await handleSaveDraft(env.DB, "u-dan", id, { definition: DEFINITION });
    const tried = await handleTryMapping(env.DB, env.DOCUMENTS, id);
    expect(tried.status).toBe(200);
    expect(tried.body).toMatchObject({
      version: 1,
      problems: [],
      en16931: { failed: [] },
      facts: { "BT-1": "88240", "BT-2": "2026-09-29", "BT-40": "DE", "BT-115": 649.74 },
      lines: [{ lineNumber: 1, "BT-129": 12, "BT-130": "H87", "BT-131": 546 }],
    });
  });

  it("refuses to publish a draft that maps nothing, or cannot read its own sample", async () => {
    const m = await receive("buchhaltung@munch.de", munch());
    const id = ((await handleCreateMapping(env.DB, env.DOCUMENTS, "u-dan", { messageId: m.id, partSeq: 1 })).body as { id: string }).id;
    expect(await handlePublishMapping(env.DB, env.DOCUMENTS, "u-dan", id)).toMatchObject({ status: 422, body: { reason: "empty" } });

    const wrongDate = {
      ...DEFINITION,
      lines: DEFINITION.lines.map((l) => (l.target === "BT-2" ? { ...l, fx: [{ fn: "read_date", args: { pattern: "yyyy-MM-dd" } }] } : l)),
    };
    await handleSaveDraft(env.DB, "u-dan", id, { definition: wrongDate });
    const refused = await handlePublishMapping(env.DB, env.DOCUMENTS, "u-dan", id);
    expect(refused).toMatchObject({ status: 422, body: { reason: "sample_problems" } });
    expect((refused.body as { problems: unknown[] }).problems).toEqual([
      { target: "BT-2", source: "Rechnung/Kopf/Datum", value: "29.09.2026", reason: '"29.09.2026" is not a date written yyyy-MM-dd' },
    ]);
  });

  it("publishes, names the failed messages it may read, and reprocessing delivers them through it", async () => {
    const { failed, id, published } = await publishedMapping();
    expect(published).toMatchObject({ status: 200, body: { version: 1, status: "live", waiting: [failed.id] } });

    const rerun = await handleReprocessMessage(env.DB, failed.id, "u-dan", { model, bucket: env.DOCUMENTS, customerId: CUSTOMER });
    expect(rerun).toMatchObject({ status: 200, body: { status: "delivered" } });
    expect(await part(failed.id)).toMatchObject({ outcome: "captured", format: "supplier_xml", mapping_id: id, mapping_version: 1, en16931_failed: "[]" });
    expect(await facts(failed.id)).toMatchObject({
      "BT-1": "88240",
      "BT-2": "2026-09-29",
      "BT-27": "Munch GmbH",
      "BT-112": 649.74,
      "intake.format": "supplier_xml",
      "en16931.checked": true,
      "en16931.failures": "",
    });

    const list = await handleListMappings(env.DB, new URLSearchParams("route=email-in"));
    expect((list.body as { mappings: unknown[] }).mappings).toEqual([
      { id, routeId: "email-in", name: "munch.de <Rechnung>", root: "Rechnung", senders: ["@munch.de"], liveVersion: 1, draftVersion: null, read30d: 1, waiting: 0 },
    ]);
  });

  it("reads the next invoice from that supplier directly, and not one from another sender", async () => {
    const { id } = await publishedMapping();
    const next = await receive("rechnung@munch.de", munch({ number: "88241" }));
    expect(next.status).toBe("delivered");
    expect(await part(next.id)).toMatchObject({ mapping_id: id, mapping_version: 1 });
    expect((await facts(next.id))?.["BT-1"]).toBe("88241");

    const stranger = await receive("billing@other.example", munch({ number: "X-1" }));
    expect(stranger.status).toBe("failed");
    // Decision 0563: the live mapping came close, and the part says so.
    expect(await part(stranger.id)).toMatchObject({ xml_root: "Rechnung", mapping_id: id, mapping_version: null, mapping_miss: "not_for_sender" });
  });

  it("fails an invoice it cannot read, saying which value, where and why, with the mapping that tried", async () => {
    const { id } = await publishedMapping();
    const m = await receive("buchhaltung@munch.de", munch({ date: "2026-09-30", number: "88242" }));
    expect(m.status).toBe("failed");
    const p = await part(m.id);
    expect(p).toMatchObject({ outcome: "failed", mapping_id: id, mapping_version: 1 });
    expect(p.reason).toBe(
      'munch.de <Rechnung> v1 could not read it: BT-2 (from Rechnung/Kopf/Datum): "2026-09-30" is not a date written dd.MM.yyyy'
    );
    const detail = await handleGetRouteMessage(env.DB, m.id);
    expect((detail.body as { parts: Array<Record<string, unknown>> }).parts.find((x) => x.role === "attachment")).toMatchObject({
      mapping: { id, version: 1, name: "munch.de <Rechnung>" },
    });
  });

  it("edits a published mapping as a new draft, and publishing it retires the one before", async () => {
    const { id } = await publishedMapping();
    const saved = await handleSaveDraft(env.DB, "u-dan", id, { definition: DEFINITION, name: "Munch GmbH XML" });
    expect(saved).toEqual({ status: 200, body: { id, version: 2, status: "draft" } });
    expect(await handlePublishMapping(env.DB, env.DOCUMENTS, "u-dan", id)).toMatchObject({ status: 200, body: { version: 2 } });
    const read = (await handleGetMapping(env.DB, env.DOCUMENTS, id)).body as { mapping: { name: string }; versions: Array<{ version: number; status: string; publishedBy: string }> };
    expect(read.mapping.name).toBe("Munch GmbH XML");
    expect(read.versions.map((v) => [v.version, v.status, v.publishedBy])).toEqual([
      [2, "live", "Dan Young"],
      [1, "retired", "Dan Young"],
    ]);
  });
});

describe("a function from plain words", () => {
  it("compiles against the sample's real values, with worked examples", async () => {
    const m = await receive("buchhaltung@munch.de", munch());
    const id = ((await handleCreateMapping(env.DB, env.DOCUMENTS, "u-dan", { messageId: m.id, partSeq: 1 })).body as { id: string }).id;
    const prompts: string[] = [];
    const compiler = {
      compile: async (prompt: string) => {
        prompts.push(prompt);
        return '{"steps":[{"fn":"decimal_comma","args":{}}]}';
      },
    };
    const result = await handleCompileFunction(env.DB, env.DOCUMENTS, compiler, id, {
      target: "BT-131",
      source: "Rechnung/Position/Netto",
      say: "amounts use a decimal comma",
    });
    expect(result).toEqual({
      status: 200,
      body: { kind: "compiled", steps: [{ fn: "decimal_comma", args: {} }], examples: [{ input: "546,00", output: 546 }] },
    });
    expect(prompts[0]).toContain('"546,00"');
  });
});

/**
 * **Near misses, and retiring — decision 0563.** On 30 September a
 * `<Rechnung>` from vibefinanceuk@gmail.com failed six times as "no
 * mapping reads it yet", while a live mapping for `<Rechnung>` was for
 * another address, and two drafts that would have read it were never
 * published. The editor had offered to reprocess it all the same.
 */
describe("when a mapping came close", () => {
  it("says a live mapping reads this root but is not for this sender, and names it", async () => {
    const { id } = await publishedMapping();
    const stranger = await receive("billing@other.example", munch({ number: "X-1" }));
    const p = await part(stranger.id);
    expect(p).toMatchObject({ outcome: "failed", mapping_id: id, mapping_version: null, mapping_miss: "not_for_sender" });
    expect(p.reason).toBe(
      `this is <Rechnung>, a supplier's own XML; the mapping "munch.de <Rechnung>" reads <Rechnung> on this route, but is not for billing@other.example`
    );
    const detail = await handleGetRouteMessage(env.DB, stranger.id);
    const parts = (detail.body as { parts: Array<{ role: string; mapping: unknown }> }).parts;
    expect(parts.find((x) => x.role === "attachment")?.mapping).toEqual({ id, version: null, name: "munch.de <Rechnung>", miss: "not_for_sender" });
  });

  it("says a mapping for this sender would read it but has not been published", async () => {
    const failed = await receive("buchhaltung@munch.de", munch());
    const created = await handleCreateMapping(env.DB, env.DOCUMENTS, "u-dan", { messageId: failed.id, partSeq: 1 });
    const id = (created.body as { id: string }).id;
    await handleSaveDraft(env.DB, "u-dan", id, { definition: DEFINITION });
    const again = await receive("buchhaltung@munch.de", munch({ number: "88241" }));
    const p = await part(again.id);
    expect(p).toMatchObject({ outcome: "failed", mapping_id: id, mapping_version: null, mapping_miss: "not_published" });
    expect(p.reason).toBe(`this is <Rechnung>, a supplier's own XML; the mapping "munch.de <Rechnung>" would read it, but has not been published`);
  });

  it("still says no mapping reads it where nothing came close", async () => {
    const m = await receive("buchhaltung@munch.de", munch());
    expect(await part(m.id)).toMatchObject({ mapping_id: null, mapping_version: null, mapping_miss: null });
  });

  it("counts as waiting only the failed messages from a sender the mapping is for", async () => {
    const { id } = await publishedMapping();
    const stranger = await receive("billing@other.example", munch({ number: "X-1" }));
    const got = await handleGetMapping(env.DB, env.DOCUMENTS, id);
    expect((got.body as { waiting: number }).waiting).toBe(1);
    const list = await handleListMappings(env.DB, new URLSearchParams("route=email-in"));
    expect((list.body as { mappings: Array<{ waiting: number }> }).mappings[0].waiting).toBe(1);

    // Adding the sender makes that message one it may read, at once.
    await handleSaveDraft(env.DB, "u-dan", id, { definition: DEFINITION, senders: ["@munch.de", "billing@other.example"] });
    const after = await handleGetMapping(env.DB, env.DOCUMENTS, id);
    expect((after.body as { waiting: number }).waiting).toBe(2);
    const rerun = await handleReprocessMessage(env.DB, stranger.id, "u-dan", { model, bucket: env.DOCUMENTS, customerId: CUSTOMER });
    expect(rerun).toMatchObject({ status: 200, body: { status: "delivered" } });
    expect(await part(stranger.id)).toMatchObject({ outcome: "captured", mapping_id: id, mapping_miss: null });
  });
});

describe("retiring a mapping", () => {
  it("stops it reading, leaves the list, keeps its versions, and refuses further edits", async () => {
    const { id } = await publishedMapping();
    const retired = await handleRetireMapping(env.DB, "u-dan", id);
    expect(retired).toEqual({ status: 200, body: { id, status: "retired", wasLive: true } });

    const row = await env.DB.prepare("SELECT status, retired_at, retired_by FROM supplier_mappings WHERE id = ?").bind(id).first<Record<string, unknown>>();
    expect(row).toMatchObject({ status: "retired", retired_by: "u-dan" });
    expect(row?.retired_at).toEqual(expect.any(String));
    const versions = await env.DB.prepare("SELECT version, status FROM supplier_mapping_versions WHERE mapping_id = ?").bind(id).all();
    expect(versions.results).toEqual([{ version: 1, status: "live" }]);

    const list = await handleListMappings(env.DB, new URLSearchParams("route=email-in"));
    expect((list.body as { mappings: unknown[] }).mappings).toEqual([]);
    const got = await handleGetMapping(env.DB, env.DOCUMENTS, id);
    expect((got.body as { mapping: { status: string } }).mapping.status).toBe("retired");

    const next = await receive("rechnung@munch.de", munch({ number: "88241" }));
    expect(next.status).toBe("failed");
    expect(await part(next.id)).toMatchObject({ mapping_id: null, mapping_miss: null });

    expect(await handleSaveDraft(env.DB, "u-dan", id, { definition: DEFINITION })).toMatchObject({ status: 409, body: { reason: "retired" } });
    expect(await handlePublishMapping(env.DB, env.DOCUMENTS, "u-dan", id)).toMatchObject({ status: 409, body: { reason: "retired" } });
    expect(await handleRetireMapping(env.DB, "u-dan", id)).toMatchObject({ status: 409, body: { reason: "retired" } });
    expect(await handleRetireMapping(env.DB, "u-dan", "MAP-NONE")).toMatchObject({ status: 404 });
  });

  it("retires a draft that was never published, saying it was not live", async () => {
    const failed = await receive("buchhaltung@munch.de", munch());
    const created = await handleCreateMapping(env.DB, env.DOCUMENTS, "u-dan", { messageId: failed.id, partSeq: 1 });
    const id = (created.body as { id: string }).id;
    expect(await handleRetireMapping(env.DB, "u-dan", id)).toEqual({ status: 200, body: { id, status: "retired", wasLive: false } });
  });
});

describe("who a mapping is for", () => {
  it("matches an address exactly, or by its domain, and anyone when it names no one", () => {
    expect(senderMatches(["@munch.de"], "Buchhaltung <buchhaltung@munch.de>")).toBe(true);
    expect(senderMatches(["@munch.de"], "billing@other.example")).toBe(false);
    expect(senderMatches(["anna@munch.de"], "ANNA@munch.de")).toBe(true);
    expect(senderMatches(null, undefined)).toBe(true);
    expect(senderMatches(["@munch.de"], undefined)).toBe(false);
    expect(domainOf("Buchhaltung <buchhaltung@munch.de>")).toBe("@munch.de");
    expect(domainOf("not an address")).toBeNull();
  });
});
