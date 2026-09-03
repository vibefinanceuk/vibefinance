import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import {
  handleCreateSource,
  handleListSources,
  isKnownSourceMechanism,
  SOURCE_MECHANISMS,
} from "../src/source-route.js";
import { handleCreateProcess } from "../src/process-route.js";

beforeEach(async () => {
  await applyTestSchema();
  await handleCreateProcess(env.DB, { id: "p-ap", name: "Accounts Payable" });
  await handleCreateProcess(env.DB, { id: "p-ar", name: "Accounts Receivable" });
});

describe("creating a source", () => {
  it("creates one against a real process", async () => {
    const result = await handleCreateSource(env.DB, "p-ap", {
      id: "src-ap-mailbox",
      name: "AP mailbox",
      mechanism: "email",
    });
    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({
      id: "src-ap-mailbox",
      processId: "p-ap",
      name: "AP mailbox",
      mechanism: "email",
    });
  });

  it("404s a process that does not exist", async () => {
    const result = await handleCreateSource(env.DB, "no-such-process", {
      id: "s1",
      name: "Mailbox",
      mechanism: "email",
    });
    expect(result.status).toBe(404);
  });

  it("refuses a mechanism outside the closed set", async () => {
    // Unlike mandate.channel, which is deliberately a free string, this
    // is a real enum — the system has to know how to talk to it.
    const result = await handleCreateSource(env.DB, "p-ap", {
      id: "s1",
      name: "Mailbox",
      mechanism: "carrier_pigeon",
    });
    expect(result.status).toBe(400);
    expect(String((result.body as { error: string }).error)).toContain("mechanism must be one of");
  });

  it("refuses an unnamed source", async () => {
    // An unnamed arrival point cannot be reported on, which is most of
    // what a source is for.
    const result = await handleCreateSource(env.DB, "p-ap", {
      id: "s1",
      name: "   ",
      mechanism: "email",
    });
    expect(result.status).toBe(400);
  });

  it("refuses a duplicate id with a message naming the real problem", async () => {
    await handleCreateSource(env.DB, "p-ap", { id: "s1", name: "One", mechanism: "email" });
    const again = await handleCreateSource(env.DB, "p-ap", { id: "s1", name: "Two", mechanism: "sftp" });
    expect(again.status).toBe(409);
  });

  it("refuses two sources with the same name in one process", async () => {
    await handleCreateSource(env.DB, "p-ap", { id: "s1", name: "Mailbox", mechanism: "email" });
    const again = await handleCreateSource(env.DB, "p-ap", { id: "s2", name: "Mailbox", mechanism: "email" });
    expect(again.status).toBe(409);
    expect(String((again.body as { error: string }).error)).toContain("already has a source named");
  });

  it("allows the same name in a different process", async () => {
    // "Mailbox" under AP and "Mailbox" under AR are different arrival
    // points; uniqueness is per process, not global.
    await handleCreateSource(env.DB, "p-ap", { id: "s1", name: "Mailbox", mechanism: "email" });
    const other = await handleCreateSource(env.DB, "p-ar", { id: "s2", name: "Mailbox", mechanism: "email" });
    expect(other.status).toBe(201);
  });
});

describe("a mechanism instantiated more than once", () => {
  it("allows two mailboxes under one process, distinguished by name", async () => {
    // Two tax authority APIs for two jurisdictions are the same case.
    // The name is the INSTANCE's, not the mechanism's — a report
    // collapsing both to "email" answers nothing useful.
    await handleCreateSource(env.DB, "p-ap", { id: "s-uk", name: "HMRC mailbox", mechanism: "email" });
    const second = await handleCreateSource(env.DB, "p-ap", {
      id: "s-ie",
      name: "Revenue mailbox",
      mechanism: "email",
    });
    expect(second.status).toBe(201);

    const list = await handleListSources(env.DB, "p-ap");
    const names = (list.body as { sources: { name: string }[] }).sources.map((s) => s.name);
    expect(names).toEqual(["HMRC mailbox", "Revenue mailbox"]);
  });

  it("accepts every mechanism in the closed set", async () => {
    for (const [i, mechanism] of SOURCE_MECHANISMS.entries()) {
      const result = await handleCreateSource(env.DB, "p-ap", {
        id: `s-${i}`,
        name: `Source ${i}`,
        mechanism,
      });
      expect(result.status).toBe(201);
    }
  });
});

describe("listing sources", () => {
  it("returns only this process's sources", async () => {
    // A source feeds exactly one process (decision 0055 section 4).
    await handleCreateSource(env.DB, "p-ap", { id: "s-ap", name: "AP mailbox", mechanism: "email" });
    await handleCreateSource(env.DB, "p-ar", { id: "s-ar", name: "AR mailbox", mechanism: "email" });

    const list = await handleListSources(env.DB, "p-ap");
    const sources = (list.body as { sources: { id: string }[] }).sources;
    expect(sources.map((s) => s.id)).toEqual(["s-ap"]);
  });

  it("says plainly that a process with no sources is inert", async () => {
    // Rather than leaving someone to wonder why nothing arrives.
    const list = await handleListSources(env.DB, "p-ap");
    expect((list.body as { note?: string }).note).toContain("no document can reach it");
  });

  it("404s a process that does not exist", async () => {
    expect((await handleListSources(env.DB, "no-such-process")).status).toBe(404);
  });
});

describe("the backfill from intake_channels", () => {
  it("gives every existing channel a source with the same id", async () => {
    // The id is deliberately reused: a new one would strand every
    // stored mandate.channel value, and reusing it means existing
    // provenance keeps resolving with no data migration at all.
    await env.DB.prepare(
      "INSERT INTO intake_channels (id, process_id, name) VALUES ('ch-legacy', 'p-ap', 'New Supplier Integration')"
    ).run();
    // Re-run the backfill exactly as the migration performs it.
    await env.DB.prepare(
      `INSERT INTO sources (id, process_id, name, mechanism, legacy_channel_id)
       SELECT id, process_id, name, 'https', id FROM intake_channels
       WHERE id NOT IN (SELECT id FROM sources)`
    ).run();

    const row = await env.DB.prepare("SELECT * FROM sources WHERE id = 'ch-legacy'").first<{
      name: string;
      mechanism: string;
      legacy_channel_id: string;
    }>();
    expect(row?.name).toBe("New Supplier Integration");
    // 'https' because that is what they genuinely are today — every
    // capture route is an HTTP endpoint.
    expect(row?.mechanism).toBe("https");
    expect(row?.legacy_channel_id).toBe("ch-legacy");
  });

  it("surfaces the legacy reference so pre-split arrival points are visible", async () => {
    await env.DB.prepare(
      "INSERT INTO intake_channels (id, process_id, name) VALUES ('ch-legacy', 'p-ap', 'Legacy')"
    ).run();
    await env.DB.prepare(
      `INSERT INTO sources (id, process_id, name, mechanism, legacy_channel_id)
       SELECT id, process_id, name, 'https', id FROM intake_channels
       WHERE id NOT IN (SELECT id FROM sources)`
    ).run();

    const list = await handleListSources(env.DB, "p-ap");
    expect((list.body as { sources: { legacyChannelId?: string }[] }).sources[0].legacyChannelId).toBe("ch-legacy");
  });

  it("omits the legacy reference entirely for a source created directly", async () => {
    const result = await handleCreateSource(env.DB, "p-ap", {
      id: "s-new",
      name: "New mailbox",
      mechanism: "email",
    });
    expect(result.body).not.toHaveProperty("legacyChannelId");
  });
});

describe("isKnownSourceMechanism", () => {
  it("accepts every declared mechanism", () => {
    for (const m of SOURCE_MECHANISMS) expect(isKnownSourceMechanism(m)).toBe(true);
  });

  it("rejects anything else, including near misses", () => {
    expect(isKnownSourceMechanism("emial")).toBe(false);
    expect(isKnownSourceMechanism("EMAIL")).toBe(false);
    expect(isKnownSourceMechanism(undefined)).toBe(false);
  });
});
