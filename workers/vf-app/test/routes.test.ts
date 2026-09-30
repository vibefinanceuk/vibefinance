import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema, seedStage } from "./setup.js";
import { handleCreateSource, handleRetireSource, handleRenameSource } from "../src/source-route.js";
import { handleListRoutes, handleProcessRoutes, processEnds } from "../src/routes-route.js";

/**
 * **Routes and instances — decision 0557**, slice 3: the standard routes
 * (migration 0107), every source a Source instance, an ERP Destination
 * for each process that receives invoices, and each process's entry and
 * exit stages.
 */

async function seedProcess(id = "ap", name = "Standard AP Process") {
  await env.DB.prepare("INSERT INTO processes (id, name) VALUES (?, ?)").bind(id, name).run();
  await seedStage(`${id}-intake`, id, "Intake", 1);
  await seedStage(`${id}-review`, id, "AP Review", 2);
  await seedStage(`${id}-eligible`, id, "Payment Eligible", 3);
}

const create = (processId: string, id: string, name: string, mechanism: string) =>
  handleCreateSource(env.DB, processId, { id, name, mechanism });

beforeEach(async () => {
  await applyTestSchema();
});

describe("the standard routes", () => {
  it("are seeded: five sources and the ERP CSV file, email, HTTPS, AP upload and the ERP live", async () => {
    const body = (await handleListRoutes(env.DB)).body as {
      routes: { id: string; direction: string; origin: string; live: boolean; current: Record<string, unknown> }[];
    };
    // Decision 0573: File import is live, as AP upload, so it sorts first by name.
    expect(body.routes.map((r) => [r.id, r.direction, r.origin, r.live])).toEqual([
      ["file-import", "source", "standard", true],
      ["edi-in", "source", "standard", false],
      ["email-in", "source", "standard", true],
      ["https-in", "source", "standard", true],
      ["sftp-in", "source", "standard", false],
      ["erp-csv", "destination", "standard", true],
    ]);
    expect(body.routes.find((r) => r.id === "email-in")?.current).toMatchObject({
      version: 1,
      status: "live",
      receivingGateway: "email",
      receivingFormat: "detected",
      translation: "standard_intake",
      deliveryFormat: "en16931",
      deliveryGateway: "process",
    });
    expect(body.routes.find((r) => r.id === "erp-csv")?.current).toMatchObject({
      receivingGateway: "process",
      deliveryFormat: "csv",
      deliveryGateway: "file_download",
    });
  });
});

describe("a source is a Source instance", () => {
  it("creating one places its route in its process, and gives the process an ERP Destination once", async () => {
    await seedProcess();
    expect((await create("ap", "ap-mailbox", "AP mailbox", "email")).status).toBe(201);
    expect((await create("ap", "supplier-api", "Supplier API", "https")).status).toBe(201);

    const rows = await env.DB.prepare(
      "SELECT id, route_id, process_id, source_id, name, status FROM route_instances ORDER BY id"
    ).all();
    expect(rows.results).toEqual([
      { id: "ap-mailbox", route_id: "email-in", process_id: "ap", source_id: "ap-mailbox", name: null, status: null },
      { id: "erp-ap", route_id: "erp-csv", process_id: "ap", source_id: null, name: "ERP", status: "active" },
      { id: "supplier-api", route_id: "https-in", process_id: "ap", source_id: "supplier-api", name: null, status: null },
    ]);
  });

  it("deleting one nothing used removes its instance too", async () => {
    await seedProcess();
    await create("ap", "typo", "Tpyo", "email");
    const result = await handleRetireSource(env.DB, "typo", "u-1");
    expect((result.body as { outcome: string }).outcome).toBe("deleted");
    expect(await env.DB.prepare("SELECT count(*) AS n FROM route_instances WHERE source_id = 'typo'").first()).toEqual({ n: 0 });
  });

  it("one that received a message is retired, not deleted, even if it made no invoice", async () => {
    // **Since 0555 a message is history of its source**, and its original
    // is kept: deleting the source would orphan it.
    await seedProcess();
    await create("ap", "ap-mailbox", "AP mailbox", "email");
    await env.DB.prepare(
      "INSERT INTO route_messages (id, instance_id, direction, status, failed_part, received_at) VALUES ('MSG-1', 'ap-mailbox', 'in', 'failed', 'format', '2026-09-29T10:00:00Z')"
    ).run();

    await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES ('u-1', 'u1@example.com', 'Dan')").run();
    const result = await handleRetireSource(env.DB, "ap-mailbox", "u-1");
    expect(result.body).toMatchObject({ outcome: "retired", reason: "documents_arrived" });
    expect((await handleRenameSource(env.DB, "ap-mailbox", "New name")).status).toBe(409);
  });
});

describe("a process's entry and exit stages", () => {
  it("are its first and last stages when none is stored", async () => {
    await seedProcess();
    expect(await processEnds(env.DB, "ap")).toMatchObject({ entryStageId: "ap-intake", exitStageId: "ap-eligible" });
  });

  it("are the stored ones, unless the current version no longer has them", async () => {
    await seedProcess();
    // A stage that exists but has left the current version: its exit is
    // not used, and the last stage stands in.
    await seedStage("ap-old", "ap", "Old stage", 9);
    await env.DB.prepare("DELETE FROM process_stage_versions WHERE stage_id = 'ap-old'").run();
    await env.DB.prepare("UPDATE processes SET entry_stage_id = 'ap-review', exit_stage_id = 'ap-old' WHERE id = 'ap'").run();
    expect(await processEnds(env.DB, "ap")).toMatchObject({ entryStageId: "ap-review", exitStageId: "ap-eligible" });
  });
});

describe("one process as a flow", () => {
  it("has its stages, its sources delivering to Intake and the ERP reading from Payment Eligible", async () => {
    await seedProcess();
    await create("ap", "ap-mailbox", "AP mailbox", "email");
    await create("ap", "old-drop", "Old SFTP drop", "sftp");
    await env.DB.prepare("UPDATE sources SET email_address = 'ap-mailbox.acme@vibefinance-ai.com', email_routing = 'active' WHERE id = 'ap-mailbox'").run();
    const now = new Date("2026-09-30T12:00:00Z");
    await env.DB.prepare(
      `INSERT INTO route_messages (id, instance_id, direction, status, failed_part, received_at) VALUES
        ('MSG-1', 'ap-mailbox', 'in', 'delivered', NULL, '2026-09-29T10:00:00Z'),
        ('MSG-2', 'ap-mailbox', 'in', 'failed', 'translation', '2026-09-30T10:00:00Z'),
        ('MSG-3', 'ap-mailbox', 'in', 'delivered', NULL, '2026-09-01T10:00:00Z')`
    ).run();

    const body = (await handleProcessRoutes(env.DB, new URLSearchParams(), now)).body as {
      processes: { id: string }[];
      process: { id: string; stages: { name: string }[]; entryStageId: string; exitStageId: string };
      sources: Record<string, unknown>[];
      destinations: Record<string, unknown>[];
    };
    expect(body.process.id).toBe("ap");
    expect(body.process.stages.map((s) => s.name)).toEqual(["Intake", "AP Review", "Payment Eligible"]);
    expect(body.process).toMatchObject({ entryStageId: "ap-intake", exitStageId: "ap-eligible" });
    expect(body.sources.map((s) => [s.name, s.routeName, (s.route as { live: boolean }).live, s.receivedThisWeek, s.failedOpen])).toEqual([
      ["AP mailbox", "Email in", true, 2, 1],
      ["Old SFTP drop", "SFTP in", false, 0, 0],
    ]);
    expect(body.sources[0]).toMatchObject({ emailAddress: "ap-mailbox.acme@vibefinance-ai.com", emailRouting: "active", mechanism: "email" });
    expect(body.destinations).toEqual([
      expect.objectContaining({ id: "erp-ap", name: "ERP", status: "active", routeName: "ERP CSV file", waiting: 0 }),
    ]);
  });

  it("opens the process asked for, else the first that receives anything", async () => {
    await seedProcess("aa-empty", "A process with nothing");
    await seedProcess("ap", "Standard AP Process");
    await create("ap", "ap-mailbox", "AP mailbox", "email");
    const id = async (q: string) => ((await handleProcessRoutes(env.DB, new URLSearchParams(q))).body as { process: { id: string } }).process.id;
    expect(await id("")).toBe("ap");
    expect(await id("process=aa-empty")).toBe("aa-empty");
    expect(await id("process=nope")).toBe("ap");
  });

  it("counts where each route is placed, leaving retired sources out", async () => {
    await seedProcess();
    await create("ap", "ap-mailbox", "AP mailbox", "email");
    await create("ap", "second", "Second mailbox", "email");
    await env.DB.prepare("UPDATE sources SET status = 'retired' WHERE id = 'second'").run();
    const { routes } = (await handleListRoutes(env.DB)).body as { routes: { id: string; instances: number; placedIn: string[] }[] };
    expect(routes.find((r) => r.id === "email-in")).toMatchObject({ instances: 1, placedIn: ["Standard AP Process"] });
    expect(routes.find((r) => r.id === "erp-csv")).toMatchObject({ instances: 1, placedIn: ["Standard AP Process"] });
    expect(routes.find((r) => r.id === "sftp-in")).toMatchObject({ instances: 0, placedIn: [] });
  });
});
