import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleInboundEmail, type EmailMessage } from "../src/inbound-email.js";
import { handleGetRouteMessage } from "../src/route-monitor-route.js";
import { handleReprocessMessage } from "../src/route-reprocess.js";
import { handleRereadPart } from "../src/mapping-reread.js";
import {
  handleCreateLookupList,
  handleGetLookupList,
  handleListLookupLists,
  handleRetireLookupList,
  handleSaveLookupList,
} from "../src/lookup-lists-route.js";
import {
  domainOf,
  handleCompileFunction,
  handleCompileRule,
  handleCreateMapping,
  handleProposeMapping,
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

/**
 * **A supplier's own CSV — decision 0565.** Received, failed with its kind
 * kept, mapped from the kept file with its separator and column names
 * guessed, published, reprocessed, and the next one read directly. The
 * invoice's amounts are the rows added up; a file with several invoices
 * is refused in words.
 */
const LAGER_CSV = [
  "Rechnungsnr;Datum;Fällig;Währung;Lieferant;USt-IdNr;Kunde;Land;Pos;Artikel;Menge;Einheit;Einzelpreis;Netto;MwSt;Brutto",
  "88250;29.09.2026;29.10.2026;EUR;Lager Nord GmbH;DE298765432;Acme UK Ltd;GB;1;Palettenregal;4;Stk;120,00;480,00;91,20;571,20",
  '88250;29.09.2026;29.10.2026;EUR;Lager Nord GmbH;DE298765432;Acme UK Ltd;GB;2;"Schrauben; M8";100;Stk;0,25;25,00;4,75;29,75',
].join("\r\n");

const CSV_DEFINITION = {
  root: "CSV",
  linesPath: "CSV/Row",
  csv: { delimiter: ";", header: true, skip: 0 },
  lines: [
    { target: "BT-1", source: "CSV/First/Rechnungsnr", fx: [] },
    { target: "BT-2", source: "CSV/First/Datum", fx: [{ fn: "read_date", args: { pattern: "dd.MM.yyyy" } }] },
    { target: "BT-3", source: null, fx: [{ fn: "always", args: { value: "380" } }] },
    { target: "BT-5", source: "CSV/First/Währung", fx: [] },
    { target: "BT-9", source: "CSV/First/Fällig", fx: [{ fn: "read_date", args: { pattern: "dd.MM.yyyy" } }] },
    { target: "BT-27", source: "CSV/First/Lieferant", fx: [] },
    { target: "BT-31", source: "CSV/First/USt-IdNr", fx: [] },
    { target: "BT-40", source: "CSV/First/USt-IdNr", fx: [{ fn: "first_letters", args: { n: 2 } }] },
    { target: "BT-44", source: "CSV/First/Kunde", fx: [] },
    { target: "BT-55", source: "CSV/First/Land", fx: [] },
    { target: "BT-106", source: "CSV/Row/Netto", fx: dc },
    { target: "BT-109", source: "CSV/Row/Netto", fx: dc },
    { target: "BT-110", source: "CSV/Row/MwSt", fx: dc },
    { target: "BT-112", source: "CSV/Row/Brutto", fx: dc },
    { target: "BT-115", source: "CSV/Row/Brutto", fx: dc },
    { target: "BT-126", source: "Pos", fx: [] },
    { target: "BT-129", source: "Menge", fx: [] },
    { target: "BT-130", source: "Einheit", fx: [{ fn: "unit_code" }] },
    { target: "BT-131", source: "Netto", fx: dc },
    { target: "BT-146", source: "Einzelpreis", fx: dc },
    { target: "BT-153", source: "Artikel", fx: [] },
  ],
};

/** A CSV attachment, labelled and encoded as a mail client might. */
function csvEmail(
  from: string,
  csv: string | Uint8Array,
  opts: { filename?: string; type?: string; encoding?: "base64" | "quoted-printable" } = {}
): EmailMessage {
  const boundary = "----vf-csv-boundary";
  const filename = opts.filename ?? "Rechnung_88250.csv";
  const bytes = typeof csv === "string" ? new TextEncoder().encode(csv) : csv;
  const encoding = opts.encoding ?? "base64";
  const body =
    encoding === "base64"
      ? base64(bytes)
      : [...bytes].map((b) => (b === 0x3d || b > 0x7e ? `=${b.toString(16).toUpperCase().padStart(2, "0")}` : String.fromCharCode(b))).join("");
  const raw =
    `From: ${from}\r\nTo: ${ADDRESS}\r\nSubject: Rechnung\r\nContent-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n` +
    `--${boundary}\r\nContent-Type: text/plain\r\n\r\nAnbei.\r\n` +
    `--${boundary}\r\nContent-Type: ${opts.type ?? "text/csv"}; name="${filename}"\r\nContent-Transfer-Encoding: ${encoding}\r\n` +
    `Content-Disposition: attachment; filename="${filename}"\r\n\r\n${body}\r\n--${boundary}--`;
  return { from, to: ADDRESS, raw: new Response(raw).body as ReadableStream, rawSize: raw.length, setReject() {}, async forward() {} } as EmailMessage;
}

async function receiveCsv(from: string, csv: string | Uint8Array, opts: Parameters<typeof csvEmail>[2] = {}) {
  await handleInboundEmail(csvEmail(from, csv, opts), env.DB, model, env.DOCUMENTS, CUSTOMER);
  return (await env.DB.prepare("SELECT id, status FROM route_messages ORDER BY received_at DESC, rowid DESC LIMIT 1").first<{ id: string; status: string }>())!;
}

async function publishedCsvMapping() {
  const failed = await receiveCsv("rechnung@lagernord.de", LAGER_CSV);
  const created = await handleCreateMapping(env.DB, env.DOCUMENTS, "u-dan", { messageId: failed.id, partSeq: 1 });
  const id = (created.body as { id: string }).id;
  await handleSaveDraft(env.DB, "u-dan", id, { definition: CSV_DEFINITION });
  const published = await handlePublishMapping(env.DB, env.DOCUMENTS, "u-dan", id);
  return { failed, id, created, published };
}

describe("a supplier's own CSV", () => {
  it("fails at translation as a CSV no mapping reads yet, keeping it", async () => {
    const m = await receiveCsv("rechnung@lagernord.de", LAGER_CSV);
    expect(m.status).toBe("failed");
    expect(await part(m.id)).toMatchObject({
      outcome: "failed",
      format: "supplier_csv",
      xml_root: "CSV",
      mapping_id: null,
      reason: "this is a CSV file, and no mapping on this route reads it yet",
    });
  });

  it("is taken as a CSV however the mail client labels and encodes it, and in Windows-1252", async () => {
    const outlook = await receiveCsv("rechnung@lagernord.de", LAGER_CSV, { type: "application/vnd.ms-excel", encoding: "quoted-printable" });
    expect(await part(outlook.id)).toMatchObject({ format: "supplier_csv", xml_root: "CSV" });
    // As Excel saves it on Windows: ä is 0xE4.
    const cp1252 = new Uint8Array([...LAGER_CSV].map((c) => (c === "ä" ? 0xe4 : c.charCodeAt(0))));
    const excel = await receiveCsv("rechnung@lagernord.de", cp1252, { type: "application/octet-stream" });
    expect(await part(excel.id)).toMatchObject({ format: "supplier_csv" });
    // A .txt labelled as plain text is not taken for a CSV.
    const text = await receiveCsv("rechnung@lagernord.de", LAGER_CSV, { type: "text/plain", filename: "notes.txt" });
    expect((await env.DB.prepare("SELECT count(*) AS n FROM route_message_parts WHERE message_id = ? AND role = 'attachment'").bind(text.id).first<{ n: number }>())?.n).toBe(0);
  });

  it("is mapped from the kept file: the separator and column names guessed, the rows as the lines", async () => {
    const failed = await receiveCsv("rechnung@lagernord.de", LAGER_CSV);
    const created = await handleCreateMapping(env.DB, env.DOCUMENTS, "u-dan", { messageId: failed.id, partSeq: 1 });
    expect(created).toMatchObject({ status: 201, body: { name: "lagernord.de CSV", root: "CSV" } });
    const id = (created.body as { id: string }).id;
    const got = (await handleGetMapping(env.DB, env.DOCUMENTS, id)).body as {
      mapping: { senders: string[] };
      editing: { definition: { linesPath: string; csv: unknown } };
      described: { groups: string[]; elements: Array<{ path: string; sample: string }> };
      columns: Array<{ name: string; element: string }>;
    };
    expect(got.mapping.senders).toEqual(["@lagernord.de"]);
    expect(got.editing.definition).toMatchObject({ linesPath: "CSV/Row", csv: { delimiter: ";", header: true, skip: 0 } });
    expect(got.described.groups).toEqual(expect.arrayContaining(["CSV/First", "CSV/Row"]));
    expect(got.described.elements.find((e) => e.path === "CSV/First/Währung")?.sample).toBe("EUR");
    expect(got.columns.find((c) => c.element === "USt-IdNr")?.name).toBe("USt-IdNr");

    // Options it cannot use are refused; ones it can are saved and read with.
    const bad = await handleSaveDraft(env.DB, "u-dan", id, { definition: { ...CSV_DEFINITION, csv: { delimiter: ":", header: true, skip: 0 } } });
    expect(bad).toMatchObject({ status: 422, body: { error: "the separator is one of ; , tab or |" } });
    await handleSaveDraft(env.DB, "u-dan", id, { definition: { ...CSV_DEFINITION, lines: [], csv: { delimiter: ";", header: false, skip: 0 } } });
    const noNames = (await handleGetMapping(env.DB, env.DOCUMENTS, id)).body as { columns: Array<{ element: string }> };
    expect(noNames.columns[0].element).toBe("Column1");
  });

  it("publishes, reprocesses with the amounts added up from the rows, and reads the next one directly", async () => {
    const { failed, id, published } = await publishedCsvMapping();
    expect(published).toMatchObject({ status: 200, body: { status: "live", waiting: [failed.id] } });
    const tried = await handleTryMapping(env.DB, env.DOCUMENTS, id);
    expect(tried).toMatchObject({ status: 200 });

    const rerun = await handleReprocessMessage(env.DB, failed.id, "u-dan", { model, bucket: env.DOCUMENTS, customerId: CUSTOMER });
    expect(rerun).toMatchObject({ status: 200, body: { status: "delivered" } });
    expect(await part(failed.id)).toMatchObject({ outcome: "captured", format: "supplier_csv", mapping_id: id, mapping_version: 1, en16931_failed: "[]" });
    expect(await facts(failed.id)).toMatchObject({
      "BT-1": "88250",
      "BT-2": "2026-09-29",
      "BT-106": 505,
      "BT-110": 95.95,
      "BT-112": 600.95,
      "intake.format": "supplier_csv",
    });

    // A table a person can read, beside the original CSV.
    const docs = await env.DB.prepare(
      `SELECT d.document_type, d.content_type FROM invoice_documents d JOIN route_message_items i ON i.item_id = d.invoice_id WHERE i.message_id = ? ORDER BY d.document_type`
    )
      .bind(failed.id)
      .all<{ document_type: string; content_type: string }>();
    expect(docs.results).toEqual([
      { document_type: "generated_rendering", content_type: "text/html; charset=utf-8" },
      { document_type: "original", content_type: "text/csv" },
    ]);

    const next = await receiveCsv("buchhaltung@lagernord.de", LAGER_CSV.replace(/88250/g, "88251"));
    expect(next.status).toBe("delivered");
    expect((await facts(next.id))?.["BT-1"]).toBe("88251");
  });

  it("refuses a file that holds several invoices, naming them", async () => {
    const { id } = await publishedCsvMapping();
    const two = `${LAGER_CSV}\r\n88252;30.09.2026;30.10.2026;EUR;Lager Nord GmbH;DE298765432;Acme UK Ltd;GB;1;Palettenregal;1;Stk;120,00;120,00;22,80;142,80`;
    const m = await receiveCsv("rechnung@lagernord.de", two);
    expect(m.status).toBe("failed");
    expect(await part(m.id)).toMatchObject({
      mapping_id: id,
      mapping_version: 1,
      reason: "lagernord.de CSV v1: the file holds 2 invoices (88250, 88252). One invoice per file is read",
    });
  });

  it("names the near miss for a CSV from another sender", async () => {
    const { id } = await publishedCsvMapping();
    const m = await receiveCsv("billing@other.example", LAGER_CSV);
    expect(await part(m.id)).toMatchObject({
      mapping_id: id,
      mapping_miss: "not_for_sender",
      reason: 'this is a CSV file; the mapping "lagernord.de CSV" reads CSV files on this route, but is not for billing@other.example',
    });
  });

  it("chooses, of a sender's CSV mappings, the one whose columns are in the file", async () => {
    const { id } = await publishedCsvMapping();
    // A second mapping for the same sender, for a file with other columns.
    const other = "Beleg;Betrag\r\nG-1;10,00\r\nG-1;5,00";
    const credit = await receiveCsv("rechnung@lagernord.de", other);
    const made = await handleCreateMapping(env.DB, env.DOCUMENTS, "u-dan", { messageId: credit.id, partSeq: 1, name: "Lager Nord credits" });
    const creditId = (made.body as { id: string }).id;
    await handleSaveDraft(env.DB, "u-dan", creditId, {
      definition: {
        root: "CSV",
        linesPath: "CSV/Row",
        csv: { delimiter: ";", header: true, skip: 0 },
        lines: [
          { target: "BT-1", source: "CSV/First/Beleg", fx: [] },
          { target: "BT-3", source: null, fx: [{ fn: "always", args: { value: "380" } }] },
        ],
      },
    });
    // Published directly, as its sample cannot pass EN 16931: only which mapping is chosen matters here.
    await env.DB.prepare("UPDATE supplier_mapping_versions SET status = 'live', published_at = ?, published_by = 'u-dan' WHERE mapping_id = ?")
      .bind(new Date(Date.now() + 1000).toISOString(), creditId)
      .run();
    const invoice = await receiveCsv("rechnung@lagernord.de", LAGER_CSV.replace(/88250/g, "88253"));
    expect(await part(invoice.id)).toMatchObject({ mapping_id: id, outcome: "captured" });
  });
});

/**
 * **Reading a captured file again with a newer mapping — decision 0566.**
 * On 30 September 88251 was read with version 1 of a mapping that lacked
 * the VAT total; version 2 added it, and reprocessing could not reach an
 * invoice already captured. Read again, it is the same invoice with the
 * new facts, in the same instance, never a second one.
 */
describe("reading a captured file again", () => {
  const WITHOUT_VAT = { ...DEFINITION, lines: DEFINITION.lines.filter((l) => l.target !== "BT-110") };

  /** Version 1 without the VAT total, an invoice captured with it, then version 2 with it. */
  async function capturedWithOldVersion() {
    const failed = await receive("buchhaltung@munch.de", munch());
    const created = await handleCreateMapping(env.DB, env.DOCUMENTS, "u-dan", { messageId: failed.id, partSeq: 1 });
    const id = (created.body as { id: string }).id;
    await handleSaveDraft(env.DB, "u-dan", id, { definition: WITHOUT_VAT });
    await handlePublishMapping(env.DB, env.DOCUMENTS, "u-dan", id);
    const next = await receive("rechnung@munch.de", munch({ number: "88251" }));
    // As at a Validation stage waiting for someone: still in progress.
    await env.DB.prepare(
      "UPDATE process_instances SET status = 'in_progress' WHERE subject_id = (SELECT item_id FROM route_message_items WHERE message_id = ?)"
    )
      .bind(next.id)
      .run();
    await handleSaveDraft(env.DB, "u-dan", id, { definition: DEFINITION });
    await handlePublishMapping(env.DB, env.DOCUMENTS, "u-dan", id);
    const invoiceId = (await env.DB.prepare("SELECT item_id FROM route_message_items WHERE message_id = ?").bind(next.id).first<{ item_id: string }>())!.item_id;
    return { id, next, invoiceId };
  }

  it("offers to read it again with the live version, and does: the same invoice, new facts, one instance", async () => {
    const { id, next, invoiceId } = await capturedWithOldVersion();
    expect(await part(next.id)).toMatchObject({ mapping_version: 1 });
    expect((await facts(next.id))?.["BT-110"]).toBeUndefined();

    const detail = (await handleGetRouteMessage(env.DB, next.id)).body as { parts: Array<{ role: string; reread: unknown }> };
    expect(detail.parts.find((p) => p.role === "attachment")?.reread).toEqual({ can: true, version: 2 });

    const reread = await handleRereadPart(env.DB, env.DOCUMENTS, next.id, 1, "u-dan");
    expect(reread).toMatchObject({ status: 200, body: { invoiceId, mappingId: id, version: 2, en16931Failed: [] } });
    expect(await part(next.id)).toMatchObject({ outcome: "captured", mapping_id: id, mapping_version: 2, en16931_failed: "[]" });
    expect((await facts(next.id))?.["BT-110"]).toBe(103.74);
    const invoices = await env.DB.prepare("SELECT count(*) AS n FROM invoice_headers WHERE invoice_number = '88251'").first<{ n: number }>();
    expect(invoices?.n).toBe(1);
    const instances = await env.DB.prepare("SELECT count(*) AS n FROM process_instances WHERE subject_id = ?").bind(invoiceId).first<{ n: number }>();
    expect(instances?.n).toBe(1);
    const event = await env.DB.prepare("SELECT event, part_seq, detail, actor FROM route_message_events WHERE message_id = ? ORDER BY seq DESC LIMIT 1")
      .bind(next.id)
      .first();
    expect(event).toEqual({ event: "reread", part_seq: 1, detail: "read again with munch.de <Rechnung> version 2", actor: "u-dan" });

    // Read with the live version now: nothing more to offer.
    const after = (await handleGetRouteMessage(env.DB, next.id)).body as { parts: Array<{ role: string; reread: unknown }> };
    expect(after.parts.find((p) => p.role === "attachment")?.reread).toBeNull();
    expect(await handleRereadPart(env.DB, env.DOCUMENTS, next.id, 1, "u-dan")).toMatchObject({ status: 409, body: { reason: "no_newer_version" } });
  });

  it("refuses an invoice somebody has worked on, and changes nothing", async () => {
    const { next, invoiceId } = await capturedWithOldVersion();
    const visit = await env.DB.prepare(
      "SELECT v.id, v.stage_id FROM stage_visits v JOIN process_instances pi ON pi.id = v.process_instance_id WHERE pi.subject_id = ? LIMIT 1"
    )
      .bind(invoiceId)
      .first<{ id: string; stage_id: string }>();
    await env.DB.prepare(
      "INSERT INTO tasks (id, stage_id, required_permission, stage_visit_id, claimed_by, claimed_at) VALUES ('t-1', ?, 'AP.Validate', ?, 'u-dan', ?)"
    )
      .bind(visit!.stage_id, visit!.id, new Date().toISOString())
      .run();
    const detail = (await handleGetRouteMessage(env.DB, next.id)).body as { parts: Array<{ role: string; reread: unknown }> };
    expect(detail.parts.find((p) => p.role === "attachment")?.reread).toEqual({ can: false, reason: "worked_on" });
    expect(await handleRereadPart(env.DB, env.DOCUMENTS, next.id, 1, "u-dan")).toMatchObject({ status: 409, body: { reason: "worked_on" } });
    expect(await part(next.id)).toMatchObject({ mapping_version: 1 });
  });

  it("refuses an invoice whose process has finished, and a file the live version cannot read", async () => {
    const { id, next, invoiceId } = await capturedWithOldVersion();
    await env.DB.prepare("UPDATE process_instances SET status = 'completed' WHERE subject_id = ?").bind(invoiceId).run();
    expect(await handleRereadPart(env.DB, env.DOCUMENTS, next.id, 1, "u-dan")).toMatchObject({ status: 409, body: { reason: "not_in_progress" } });

    await env.DB.prepare("UPDATE process_instances SET status = 'in_progress' WHERE subject_id = ?").bind(invoiceId).run();
    // Version 3 reads the date as the wrong pattern: refused with its problems, nothing touched.
    const wrongDate = {
      ...DEFINITION,
      lines: DEFINITION.lines.map((l) => (l.target === "BT-2" ? { ...l, fx: [{ fn: "read_date", args: { pattern: "yyyy-MM-dd" } }] } : l)),
    };
    await handleSaveDraft(env.DB, "u-dan", id, { definition: wrongDate });
    await env.DB.prepare("UPDATE supplier_mapping_versions SET status = 'retired' WHERE mapping_id = ? AND status = 'live'").bind(id).run();
    await env.DB.prepare("UPDATE supplier_mapping_versions SET status = 'live', published_at = ?, published_by = 'u-dan' WHERE mapping_id = ? AND status = 'draft'")
      .bind(new Date().toISOString(), id)
      .run();
    const refused = await handleRereadPart(env.DB, env.DOCUMENTS, next.id, 1, "u-dan");
    expect(refused).toMatchObject({ status: 422, body: { reason: "read_failed", error: "version 3 cannot read this file" } });
    expect(await part(next.id)).toMatchObject({ mapping_version: 1 });
  });
});

/**
 * **Look-up lists — decision 0568.** Shared lists a mapping reads through
 * `look_up`: a supplier's unit "Rolle" to a code, their article number to
 * the customer's own. Saved whole, refused in words, and retired keeping
 * their entries.
 */
describe("look-up lists", () => {
  it("are made with a name, saved whole, and refuse what a person would not mean", async () => {
    expect(await handleCreateLookupList(env.DB, "u-dan", {})).toMatchObject({ status: 400, body: { reason: "no_name" } });
    const made = await handleCreateLookupList(env.DB, "u-dan", { name: " Units " });
    expect(made).toMatchObject({ status: 201, body: { name: "Units" } });
    const id = (made.body as { id: string }).id;
    expect(id).toMatch(/^LL-[0-9A-F]{4}-[0-9A-F]{4}$/);
    expect(await handleCreateLookupList(env.DB, "u-dan", { name: "units" })).toMatchObject({ status: 409, body: { reason: "name_taken" } });

    const saved = await handleSaveLookupList(env.DB, "u-dan", id, {
      entries: [{ from: "Rolle", to: "RO" }, { from: " Karton ", to: "CT" }, { from: "", to: "" }],
    });
    expect(saved).toEqual({ status: 200, body: { id, name: "Units", entries: 2 } });
    expect((await handleGetLookupList(env.DB, id)).body).toMatchObject({
      list: { name: "Units", status: "active" },
      entries: [{ from: "Karton", to: "CT" }, { from: "Rolle", to: "RO" }],
      usedBy: [],
    });

    expect(await handleSaveLookupList(env.DB, "u-dan", id, { entries: [{ from: "Rolle", to: "RO" }, { from: "ROLLE ", to: "RL" }] })).toMatchObject({
      status: 422,
      body: { error: "ROLLE is in the list twice (rows 1 and 2)", reason: "duplicate" },
    });
    expect(await handleSaveLookupList(env.DB, "u-dan", id, { entries: [{ from: "Rolle", to: "" }] })).toMatchObject({
      status: 422,
      body: { error: "row 1 (Rolle) has nothing in To", reason: "empty_to" },
    });
    expect(await handleSaveLookupList(env.DB, "u-dan", id, { entries: [{ from: "", to: "RO" }] })).toMatchObject({ status: 422, body: { reason: "empty_from" } });
    // A refused save changes nothing.
    expect(((await handleGetLookupList(env.DB, id)).body as { entries: unknown[] }).entries).toHaveLength(2);

    const listed = (await handleListLookupLists(env.DB)).body as { lists: Array<{ id: string; entries: number }> };
    expect(listed.lists).toEqual([expect.objectContaining({ id, name: "Units", entries: 2, usedBy: [] })]);

    expect(await handleRetireLookupList(env.DB, "u-dan", id)).toMatchObject({ status: 200, body: { status: "retired" } });
    expect(((await handleListLookupLists(env.DB)).body as { lists: unknown[] }).lists).toEqual([]);
    expect(await handleSaveLookupList(env.DB, "u-dan", id, { entries: [] })).toMatchObject({ status: 409, body: { reason: "retired" } });
    // Retired, the name is free again.
    expect(await handleCreateLookupList(env.DB, "u-dan", { name: "Units" })).toMatchObject({ status: 201 });
  });

  it("read a supplier's unit through a list in a mapping, refuse a list that is not there, and say when one is retired", async () => {
    const units = ((await handleCreateLookupList(env.DB, "u-dan", { name: "Units" })).body as { id: string }).id;
    await handleSaveLookupList(env.DB, "u-dan", units, { entries: [{ from: "Rolle", to: "RO" }] });
    const withRolle = LAGER_CSV.replace(';100;Stk;0,25;', ';100;Rolle;0,25;');
    const failed = await receiveCsv("rechnung@lagernord.de", withRolle);
    const id = ((await handleCreateMapping(env.DB, env.DOCUMENTS, "u-dan", { messageId: failed.id, partSeq: 1 })).body as { id: string }).id;
    const withLookup = {
      ...CSV_DEFINITION,
      lines: CSV_DEFINITION.lines.map((l) =>
        l.target === "BT-130" ? { ...l, fx: [{ fn: "look_up", args: { list: units, otherwise: "keep" } }, { fn: "unit_code" }] } : l
      ),
    };
    expect(
      await handleSaveDraft(env.DB, "u-dan", id, {
        definition: { ...withLookup, lines: [{ target: "BT-130", source: "Einheit", fx: [{ fn: "look_up", args: { list: "LL-NONE-0000", otherwise: "keep" } }] }] },
      })
    ).toMatchObject({ status: 422, body: { reason: "unknown_list", error: "there is no look-up list LL-NONE-0000, or it is retired" } });
    await handleSaveDraft(env.DB, "u-dan", id, { definition: withLookup });

    const tried = (await handleTryMapping(env.DB, env.DOCUMENTS, id)).body as { lines: Array<Record<string, unknown>>; problems: unknown[] };
    expect(tried.problems).toEqual([]);
    expect(tried.lines.map((l) => l["BT-130"])).toEqual(["H87", "RO"]);
    expect(((await handleListLookupLists(env.DB)).body as { lists: Array<{ usedBy: string[] }> }).lists[0].usedBy).toEqual(["lagernord.de CSV"]);
    expect(((await handleGetMapping(env.DB, env.DOCUMENTS, id)).body as { lists: unknown }).lists).toEqual([{ id: units, name: "Units" }]);

    await handlePublishMapping(env.DB, env.DOCUMENTS, "u-dan", id);
    const next = await receiveCsv("rechnung@lagernord.de", withRolle.replace(/88250/g, "88260"));
    expect(next.status).toBe("delivered");

    expect(await handleRetireLookupList(env.DB, "u-dan", units)).toMatchObject({ body: { usedBy: ["lagernord.de CSV"] } });
    const after = await receiveCsv("rechnung@lagernord.de", withRolle.replace(/88250/g, "88261"));
    expect(after.status).toBe("failed");
    expect((await part(after.id)).reason).toContain(`BT-130 on line 2 (from Einheit): the look-up list "${units}" is not available: it may have been retired`);
  });

  it("are offered to the function compiler, with worked examples through the list", async () => {
    const units = ((await handleCreateLookupList(env.DB, "u-dan", { name: "Units" })).body as { id: string }).id;
    await handleSaveLookupList(env.DB, "u-dan", units, { entries: [{ from: "Stk", to: "H87" }] });
    const m = await receiveCsv("rechnung@lagernord.de", LAGER_CSV);
    const id = ((await handleCreateMapping(env.DB, env.DOCUMENTS, "u-dan", { messageId: m.id, partSeq: 1 })).body as { id: string }).id;
    const prompts: string[] = [];
    const compiler = {
      compile: async (prompt: string) => {
        prompts.push(prompt);
        return JSON.stringify({ steps: [{ fn: "look_up", args: { list: units, otherwise: "refuse" } }] });
      },
    };
    const result = await handleCompileFunction(env.DB, env.DOCUMENTS, compiler, id, { target: "BT-130", source: "CSV/Row/Einheit", say: "look it up in Units" });
    expect(result).toEqual({
      status: 200,
      body: { kind: "compiled", steps: [{ fn: "look_up", args: { list: units, otherwise: "refuse" } }], examples: [{ input: "Stk", output: "H87" }] },
    });
    expect(prompts[0]).toContain(`- "${units}": Units, for example "Stk" becomes "H87"`);
  });
});

/**
 * **Rules for the whole invoice — decision 0569.** Defaults and derived
 * values, kept on the mapping: validated on saving, compiled from plain
 * words against the sample, tried, published, and applied at intake.
 */
describe("rules for the whole invoice", () => {
  const NO_DUE_NO_CURRENCY = {
    ...CSV_DEFINITION,
    lines: CSV_DEFINITION.lines.filter((l) => l.target !== "BT-9" && l.target !== "BT-5"),
  };
  const RULES = [
    { target: "BT-5", when: "missing", from: null, fx: [{ fn: "always", args: { value: "EUR" } }], say: "if the currency is missing, use EUR" },
    { target: "BT-9", when: "missing", from: "BT-2", fx: [{ fn: "add_days", args: { days: 30 } }], say: "the due date is 30 days after the invoice date" },
  ];

  it("are saved with the draft, refused in words, tried, published and applied at intake", async () => {
    const failed = await receiveCsv("rechnung@lagernord.de", LAGER_CSV);
    const id = ((await handleCreateMapping(env.DB, env.DOCUMENTS, "u-dan", { messageId: failed.id, partSeq: 1 })).body as { id: string }).id;
    expect(
      await handleSaveDraft(env.DB, "u-dan", id, { definition: { ...NO_DUE_NO_CURRENCY, rules: [{ ...RULES[0], target: "BT-129" }] } })
    ).toMatchObject({ status: 422, body: { error: "rule 1: BT-129 is not a whole-invoice term a rule can fill" } });
    expect(
      await handleSaveDraft(env.DB, "u-dan", id, {
        definition: { ...NO_DUE_NO_CURRENCY, rules: [{ target: "BT-10", when: "missing", from: "BT-1", fx: [{ fn: "look_up", args: { list: "LL-NONE-0000", otherwise: "keep" } }] }] },
      })
    ).toMatchObject({ status: 422, body: { reason: "unknown_list" } });

    await handleSaveDraft(env.DB, "u-dan", id, { definition: { ...NO_DUE_NO_CURRENCY, rules: RULES } });
    const tried = (await handleTryMapping(env.DB, env.DOCUMENTS, id)).body as { facts: Record<string, unknown>; problems: unknown[] };
    expect(tried.problems).toEqual([]);
    expect(tried.facts).toMatchObject({ "BT-5": "EUR", "BT-2": "2026-09-29", "BT-9": "2026-10-29" });
    expect(((await handleGetMapping(env.DB, env.DOCUMENTS, id)).body as { editing: { definition: { rules: unknown[] } } }).editing.definition.rules).toEqual(RULES);

    await handlePublishMapping(env.DB, env.DOCUMENTS, "u-dan", id);
    const next = await receiveCsv("rechnung@lagernord.de", LAGER_CSV.replace(/88250/g, "88270"));
    expect(next.status).toBe("delivered");
    expect(await facts(next.id)).toMatchObject({ "BT-1": "88270", "BT-5": "EUR", "BT-9": "2026-10-29" });
  });

  it("are compiled from plain words against what the draft reads from its sample", async () => {
    const failed = await receiveCsv("rechnung@lagernord.de", LAGER_CSV);
    const id = ((await handleCreateMapping(env.DB, env.DOCUMENTS, "u-dan", { messageId: failed.id, partSeq: 1 })).body as { id: string }).id;
    await handleSaveDraft(env.DB, "u-dan", id, { definition: NO_DUE_NO_CURRENCY });
    const prompts: string[] = [];
    const model = {
      compile: async (prompt: string) => {
        prompts.push(prompt);
        return JSON.stringify({ rule: { target: "BT-9", when: "missing", from: "BT-2", steps: [{ fn: "add_days", args: { days: 14 } }] } });
      },
    };
    const result = await handleCompileRule(env.DB, env.DOCUMENTS, model, id, { say: "due 14 days after the invoice date" });
    expect(result).toEqual({
      status: 200,
      body: {
        kind: "compiled",
        rule: { target: "BT-9", when: "missing", from: "BT-2", fx: [{ fn: "add_days", args: { days: 14 } }], say: "due 14 days after the invoice date" },
        example: { target: "BT-9", before: null, after: "2026-10-13" },
      },
    });
    expect(prompts[0]).toContain('- BT-2 (');
    expect(prompts[0]).toContain('"2026-09-29"');
    expect(prompts[0]).not.toContain("- BT-129 (");
  });
});

/**
 * **AI proposals — decision 0570.** The model proposes; our code checks
 * and scores on names, values and whether the invoice adds up. Nothing is
 * saved until the person applies proposals.
 */
describe("AI proposing a mapping", () => {
  it("proposes lines for the terms not yet mapped, scored by our code, and saves nothing", async () => {
    const failed = await receiveCsv("rechnung@lagernord.de", LAGER_CSV);
    const id = ((await handleCreateMapping(env.DB, env.DOCUMENTS, "u-dan", { messageId: failed.id, partSeq: 1 })).body as { id: string }).id;
    await handleSaveDraft(env.DB, "u-dan", id, { definition: { ...CSV_DEFINITION, lines: CSV_DEFINITION.lines.filter((l) => l.target === "BT-1") } });
    const prompts: string[] = [];
    const answer = CSV_DEFINITION.lines
      .filter((l) => l.source !== null && l.target !== "BT-1")
      .map((l) => ({ target: l.target, source: l.source!.startsWith("CSV/") ? l.source : `CSV/Row/${l.source}`, steps: l.fx }));
    const model = {
      compile: async (prompt: string) => {
        prompts.push(prompt);
        return JSON.stringify({ lines: [...answer, { target: "BT-44", source: "CSV/First/Nirgends", steps: [] }] });
      },
    };
    const result = await handleProposeMapping(env.DB, env.DOCUMENTS, model, id);
    expect(result.status).toBe(200);
    const body = result.body as { proposals: Array<{ target: string; confidence: number; line: unknown; becomes: unknown }>; dropped: number; missingRequired: string[] };
    expect(body.dropped).toBe(1);
    expect(body.proposals.map((p) => p.target)).not.toContain("BT-1");
    const by = Object.fromEntries(body.proposals.map((p) => [p.target, p]));
    expect(by["BT-112"]).toMatchObject({ confidence: 100, becomes: 600.95 });
    expect(by["BT-129"].line).toEqual({ target: "BT-129", source: "Menge", fx: [], origin: "ai" });
    // BT-3 has no element (a fixed value), so it is a required term nothing covers.
    expect(body.missingRequired).toEqual(["BT-3"]);
    expect(prompts[0]).toContain('- CSV/First/Währung [whole invoice]: "EUR"');
    expect(prompts[0]).not.toContain("- BT-1: ");

    const got = (await handleGetMapping(env.DB, env.DOCUMENTS, id)).body as { editing: { definition: { lines: unknown[] } } };
    expect(got.editing.definition.lines).toHaveLength(1);
  });

  it("refuses a retired mapping and one whose sample is gone", async () => {
    const failed = await receiveCsv("rechnung@lagernord.de", LAGER_CSV);
    const id = ((await handleCreateMapping(env.DB, env.DOCUMENTS, "u-dan", { messageId: failed.id, partSeq: 1 })).body as { id: string }).id;
    const model = { compile: async () => '{"lines":[]}' };
    const part = await env.DB.prepare("SELECT r2_key FROM route_message_parts WHERE message_id = ? AND seq = 1").bind(failed.id).first<{ r2_key: string }>();
    await env.DOCUMENTS.delete(part!.r2_key);
    expect(await handleProposeMapping(env.DB, env.DOCUMENTS, model, id)).toMatchObject({ status: 409, body: { reason: "no_sample" } });
    await handleRetireMapping(env.DB, "u-dan", id);
    expect(await handleProposeMapping(env.DB, env.DOCUMENTS, model, id)).toMatchObject({ status: 409, body: { reason: "retired" } });
    expect(await handleProposeMapping(env.DB, env.DOCUMENTS, model, "MAP-NONE")).toMatchObject({ status: 404 });
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
