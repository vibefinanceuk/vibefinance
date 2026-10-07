import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema, seedStage } from "./setup.js";
import { eligibleInvoiceIds, handleCreateErpExport, handleUndoErpExport, toCsv } from "../src/erp-export-route.js";
import { handleProcessRoutes, handleSetInstanceStatus } from "../src/routes-route.js";
import { handleGetRouteMessage, handleListRouteMessages, routeMessagePart } from "../src/route-monitor-route.js";
import { handleListDeliveries, handleSetDestinationUnits } from "../src/destination-delivery.js";
import erpDeliveriesSql from "../../../migrations/0119_erp_csv_deliveries.sql?raw";

/**
 * **The ERP export as a Destination — decision 0558**, slice 4 of the
 * Routes design. Payment-eligible is read from each process's exit stage;
 * a paused ERP Destination takes nothing; each export is an outbound
 * message on its process's ERP Destination, with its invoices and the
 * file it carried; undoing an export closes its messages.
 */

const CUSTOMER = "acme";

async function processWithStages(id: string) {
  await env.DB.prepare("INSERT INTO processes (id, name) VALUES (?, ?)").bind(id, id === "ap" ? "Standard AP Process" : "Other AP").run();
  await seedStage(`${id}-intake`, id, "Intake", 1);
  await seedStage(`${id}-approval`, id, "Approval", 2);
  await seedStage(`${id}-eligible`, id, "Payment Eligible", 3);
  await env.DB.prepare("INSERT INTO route_instances (id, route_id, process_id, name, status) VALUES (?, 'erp-csv', ?, 'ERP', 'active')")
    .bind(`erp-${id}`, id)
    .run();
}

async function invoice(id: string, processId: string, stage: string, status = "in_progress") {
  await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json) VALUES (?1, json_set(?2, '$.BT-1', ?3))")
    .bind(id, JSON.stringify({ "BT-1": id.toUpperCase(), "BT-112": 120, "BT-5": "GBP" }), id.toUpperCase())
    .run();
  await env.DB.prepare(
    "INSERT INTO process_instances (id, process_id, subject_type, subject_id, current_stage_id, status) VALUES (?, ?, 'invoice', ?, ?, ?)"
  )
    .bind(`pi-${id}`, processId, id, stage, status)
    .run();
}

beforeEach(async () => {
  await applyTestSchema();
  const listed = await env.DOCUMENTS.list({ prefix: `${CUSTOMER}/` });
  for (const o of listed.objects) await env.DOCUMENTS.delete(o.key);
  await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES ('olga', 'olga@acme.com', 'Olga')").run();
  await env.DB.prepare("INSERT INTO org_roles (id, name, permissions_json) VALUES ('r-olga', 'Exporter', '[\"AP.Export\"]')").run();
  await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id, unit_id) VALUES ('olga', 'r-olga', NULL)").run();
  await processWithStages("ap");
});

describe("payment-eligible, from the exit stage", () => {
  it("takes an invoice at the process's exit stage, and a completed one, but not one before it", async () => {
    await invoice("inv-a", "ap", "ap-eligible");
    await invoice("inv-b", "ap", "ap-approval", "completed");
    await invoice("inv-c", "ap", "ap-approval");
    expect((await eligibleInvoiceIds(env.DB, null)).sort()).toEqual(["inv-a", "inv-b"]);
  });

  it("follows the declared exit stage, not the highest-numbered stage", async () => {
    // A stage added after Payment Eligible does not become the exit.
    await seedStage("ap-archive", "ap", "Archive", 4);
    await env.DB.prepare("UPDATE processes SET exit_stage_id = 'ap-eligible' WHERE id = 'ap'").run();
    await invoice("inv-a", "ap", "ap-eligible");
    await invoice("inv-z", "ap", "ap-archive");
    expect(await eligibleInvoiceIds(env.DB, null)).toEqual(["inv-a"]);
  });

  it("takes nothing through a paused ERP Destination, though its Destination still counts it as waiting", async () => {
    await invoice("inv-a", "ap", "ap-eligible");
    expect((await handleSetInstanceStatus(env.DB, "erp-ap", { status: "paused" })).status).toBe(200);
    expect(await eligibleInvoiceIds(env.DB, null)).toEqual([]);
    const flow = (await handleProcessRoutes(env.DB, new URLSearchParams("process=ap"))).body as { destinations: { status: string; waiting: number }[] };
    expect(flow.destinations[0]).toMatchObject({ status: "paused", waiting: 1 });
    expect((await handleCreateErpExport(env.DB, "olga")).status).toBe(409);

    await handleSetInstanceStatus(env.DB, "erp-ap", { status: "active" });
    expect(await eligibleInvoiceIds(env.DB, null)).toEqual(["inv-a"]);
  });
});

describe("pausing a Destination", () => {
  it("is for Destinations only, active or paused", async () => {
    await env.DB.prepare("INSERT INTO sources (id, process_id, name, mechanism) VALUES ('ap-mailbox', 'ap', 'AP mailbox', 'email')").run();
    await env.DB.prepare("INSERT INTO route_instances (id, route_id, process_id, source_id) VALUES ('ap-mailbox', 'email-in', 'ap', 'ap-mailbox')").run();
    expect((await handleSetInstanceStatus(env.DB, "ap-mailbox", { status: "paused" })).body).toMatchObject({ reason: "is_source" });
    expect((await handleSetInstanceStatus(env.DB, "erp-ap", { status: "retired" })).body).toMatchObject({ reason: "invalid_status" });
    expect((await handleSetInstanceStatus(env.DB, "nope", { status: "paused" })).status).toBe(404);
  });
});

describe("an export is its Destination's message", () => {
  it("goes out on the process's ERP, delivered, with its invoices, history and the file it carried", async () => {
    await invoice("inv-a", "ap", "ap-eligible");
    await invoice("inv-b", "ap", "ap-eligible");
    const made = (await handleCreateErpExport(env.DB, "olga", null, env.DOCUMENTS, CUSTOMER)).body as { id: string; messages: string[] };
    expect(made.messages).toHaveLength(1);

    const detail = (await handleGetRouteMessage(env.DB, made.messages[0])).body as {
      message: Record<string, unknown>;
      parts: { seq: number; role: string; filename: string; contentType: string }[];
      events: { event: string; actorName: string | null }[];
      invoices: { invoiceId: string; number: string }[];
    };
    expect(detail.message).toMatchObject({ direction: "out", status: "delivered", sourceId: "erp-ap", sourceName: "ERP", subject: "Export of 2 invoices" });
    expect(detail.invoices.map((i) => i.number).sort()).toEqual(["INV-A", "INV-B"]);
    expect(detail.events.map((e) => [e.event, e.actorName])).toEqual([
      ["exported", "Olga"],
      ["delivered", null],
    ]);
    expect(detail.parts).toEqual([
      expect.objectContaining({ seq: 1, role: "sent", contentType: "text/csv; charset=utf-8" }),
    ]);
    expect(detail.parts[0].filename).toMatch(/^vibefinance-erp-export-.*\.csv$/);

    // The file kept is exactly the export's rows for this process.
    const rows = (await env.DB.prepare("SELECT row_json FROM erp_export_rows WHERE export_id = ? ORDER BY seq").bind(made.id).all<{ row_json: string }>()).results;
    const file = (await routeMessagePart(env.DB, env.DOCUMENTS, made.messages[0], 1)) as Response;
    // Byte for byte, BOM included (text() would drop it).
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(new TextEncoder().encode(toCsv(rows.map((r) => JSON.parse(r.row_json)))));

    const row = await env.DB.prepare("SELECT destination_id, instance_id, erp_export_id FROM route_messages WHERE id = ?").bind(made.messages[0]).first();
    expect(row).toEqual({ destination_id: "erp-ap", instance_id: null, erp_export_id: made.id });
  });

  it("goes out as one message for each process whose invoices it took", async () => {
    await processWithStages("ap2");
    await invoice("inv-a", "ap", "ap-eligible");
    await invoice("inv-x", "ap2", "ap2-eligible");
    const made = (await handleCreateErpExport(env.DB, "olga", null, env.DOCUMENTS, CUSTOMER)).body as { messages: string[] };
    expect(made.messages).toHaveLength(2);
    const byDestination = await env.DB.prepare(
      "SELECT m.destination_id, i.item_id FROM route_messages m JOIN route_message_items i ON i.message_id = m.id ORDER BY m.destination_id"
    ).all();
    expect(byDestination.results).toEqual([
      { destination_id: "erp-ap", item_id: "inv-a" },
      { destination_id: "erp-ap2", item_id: "inv-x" },
    ]);
  });

  it("without R2 still records the message, saying the file was not kept", async () => {
    await invoice("inv-a", "ap", "ap-eligible");
    const made = (await handleCreateErpExport(env.DB, "olga")).body as { messages: string[] };
    const detail = (await handleGetRouteMessage(env.DB, made.messages[0])).body as { parts: unknown[]; message: { status: string } };
    expect(detail.message.status).toBe("delivered");
    expect(detail.parts).toEqual([]);
  });

  it("undone, is closed with its reason: failed at delivery, dismissed, not counted as a failure to fix", async () => {
    await invoice("inv-a", "ap", "ap-eligible");
    const made = (await handleCreateErpExport(env.DB, "olga", null, env.DOCUMENTS, CUSTOMER)).body as { id: string; messages: string[] };
    await handleUndoErpExport(env.DB, "olga", made.id, { reason: "The ERP rejected the file: GL code 1610 is closed" });

    const detail = (await handleGetRouteMessage(env.DB, made.messages[0])).body as {
      message: Record<string, unknown>;
      events: { event: string; detail: string | null; actorName: string | null }[];
    };
    expect(detail.message).toMatchObject({
      status: "dismissed",
      failedPart: "delivery",
      errorCode: "undone",
      errorText: "The ERP rejected the file: GL code 1610 is closed",
    });
    expect(detail.events.at(-1)).toMatchObject({ event: "undone", actorName: "Olga" });

    const monitor = (await handleListRouteMessages(env.DB, new URLSearchParams("source=erp-ap"))).body as {
      summary: { failedOpen: number };
      messages: { id: string; sourceName: string; direction: string; status: string; invoices: number }[];
      destinations: { id: string; name: string }[];
    };
    expect(monitor.messages).toEqual([expect.objectContaining({ id: made.messages[0], sourceName: "ERP", direction: "out", status: "dismissed", invoices: 1 })]);
    expect(monitor.summary.failedOpen).toBe(0);
    expect(monitor.destinations).toEqual([{ id: "erp-ap", name: "ERP", status: "active" }]);
  });
});

/**
 * **The ERP CSV file on the delivery engine — decision 0586.** Each
 * invoice an export takes is a delivery of its process's ERP Destination,
 * in the ledger HTTPS out keeps (0585); undoing the export takes it back.
 */
describe("exports as deliveries — decision 0586", () => {
  const deliveries = async () =>
    (await env.DB.prepare("SELECT instance_id, invoice_id, status, reference, message_id FROM destination_deliveries ORDER BY invoice_id").all<Record<string, unknown>>()).results;

  it("records each exported invoice as delivered to the ERP Destination, with the export as its reference, and undoing removes it", async () => {
    await invoice("inv-a", "ap", "ap-eligible");
    await invoice("inv-b", "ap", "ap-eligible");
    const made = (await handleCreateErpExport(env.DB, "olga", null, env.DOCUMENTS, CUSTOMER)).body as { id: string; messages: string[] };
    expect(await deliveries()).toEqual([
      { instance_id: "erp-ap", invoice_id: "inv-a", status: "delivered", reference: made.id, message_id: made.messages[0] },
      { instance_id: "erp-ap", invoice_id: "inv-b", status: "delivered", reference: made.id, message_id: made.messages[0] },
    ]);
    const listed = (await handleListDeliveries(env.DB, "erp-ap")).body as { routeId: string; counts: Record<string, number>; deliveries: Array<Record<string, unknown>> };
    expect(listed.routeId).toBe("erp-csv");
    expect(listed.counts).toEqual({ delivered: 2 });
    expect(listed.deliveries.map((d) => [d.invoiceNumber, d.status, d.reference])).toEqual([
      ["INV-A", "delivered", made.id],
      ["INV-B", "delivered", made.id],
    ]);

    expect((await handleUndoErpExport(env.DB, "olga", made.id, { reason: "the ERP rejected the file" })).status).toBe(200);
    expect(await deliveries()).toEqual([]);
  });

  it("migration 0119 records exports already made, and not undone ones", async () => {
    await invoice("inv-a", "ap", "ap-eligible");
    const kept = (await handleCreateErpExport(env.DB, "olga", null, env.DOCUMENTS, CUSTOMER)).body as { id: string; messages: string[] };
    await invoice("inv-b", "ap", "ap-eligible");
    const undone = (await handleCreateErpExport(env.DB, "olga", null, env.DOCUMENTS, CUSTOMER)).body as { id: string };
    await handleUndoErpExport(env.DB, "olga", undone.id, { reason: "wrong file" });
    // As before this decision: no deliveries recorded.
    await env.DB.prepare("DELETE FROM destination_deliveries").run();
    const sql = erpDeliveriesSql.replace(/--.*$/gm, "");
    for (const statement of sql.split(";").map((x) => x.trim()).filter(Boolean)) await env.DB.prepare(statement).run();
    expect(await deliveries()).toEqual([{ instance_id: "erp-ap", invoice_id: "inv-a", status: "delivered", reference: kept.id, message_id: kept.messages[0] }]);
  });
});

describe("the ERP CSV file's business units — decision 0587", () => {
  it("exports only the units its ERP Destination covers, leaving the rest to another Destination", async () => {
    await env.DB.prepare("INSERT INTO org_units (id, name, parent_unit_id) VALUES ('de', 'Acme Germany', NULL), ('uk', 'Acme UK', NULL)").run();
    await invoice("inv-de", "ap", "ap-eligible");
    await invoice("inv-uk", "ap", "ap-eligible");
    await env.DB.prepare("UPDATE invoice_headers SET org_unit_id = 'de' WHERE id = 'inv-de'").run();
    await env.DB.prepare("UPDATE invoice_headers SET org_unit_id = 'uk' WHERE id = 'inv-uk'").run();
    expect((await eligibleInvoiceIds(env.DB, null)).sort()).toEqual(["inv-de", "inv-uk"]);
    await handleSetDestinationUnits(env.DB, "erp-ap", { unitIds: ["uk"] });
    expect(await eligibleInvoiceIds(env.DB, null)).toEqual(["inv-uk"]);
    const flow = (await handleProcessRoutes(env.DB, new URLSearchParams("process=ap"))).body as { destinations: Array<{ id: string; waiting: number; unitIds: string[] | null }> };
    expect(flow.destinations.find((d) => d.id === "erp-ap")).toMatchObject({ waiting: 1, unitIds: ["uk"] });
  });
});
