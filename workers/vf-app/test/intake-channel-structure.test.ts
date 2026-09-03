import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import {
  handleCreateIntakeChannel,
  isKnownChannelStructure,
  CHANNEL_STRUCTURES,
} from "../src/intake-channel-route.js";
import { handleCreateProcess } from "../src/process-route.js";

beforeEach(async () => {
  await applyTestSchema();
  await handleCreateProcess(env.DB, { id: "p-ap", name: "Accounts Payable" });
  await handleCreateProcess(env.DB, { id: "p-ar", name: "Accounts Receivable" });
});

describe("creating a structural intake channel (decision 0061)", () => {
  it("accepts each structure in the closed set", async () => {
    for (const [i, structure] of CHANNEL_STRUCTURES.entries()) {
      const result = await handleCreateIntakeChannel(env.DB, "p-ap", {
        id: `ch-${i}`,
        name: `Channel ${i}`,
        structure,
      });
      expect(result.status).toBe(201);
      expect(result.body).toMatchObject({ structure });
    }
  });

  it("refuses a structure outside the set", async () => {
    const result = await handleCreateIntakeChannel(env.DB, "p-ap", {
      id: "ch-x",
      name: "PDF",
      structure: "pdf",
    });
    expect(result.status).toBe(400);
  });

  it("refuses a second channel for the same structure in one process", async () => {
    // Detection depends on there being exactly one candidate per
    // structure; two would leave it picking arbitrarily.
    await handleCreateIntakeChannel(env.DB, "p-ap", { id: "x1", name: "XML", structure: "structured_xml" });
    const again = await handleCreateIntakeChannel(env.DB, "p-ap", {
      id: "x2",
      name: "XML again",
      structure: "structured_xml",
    });
    expect(again.status).toBe(409);
    expect(String((again.body as { error: string }).error)).toContain("exactly one per structure");
  });

  it("allows the same structure in a different process", async () => {
    // Channels are per-process because mapping rules are tailored to a
    // process: AR wants different mappings from AP for the same XML.
    await handleCreateIntakeChannel(env.DB, "p-ap", { id: "x1", name: "XML", structure: "structured_xml" });
    const other = await handleCreateIntakeChannel(env.DB, "p-ar", {
      id: "x2",
      name: "XML",
      structure: "structured_xml",
    });
    expect(other.status).toBe(201);
  });

  it("still allows a channel with no structure, for the legacy rows", async () => {
    // The pre-0061 rows have no single structure — they were arrival
    // points — and creating another must stay possible until they are
    // retired.
    const result = await handleCreateIntakeChannel(env.DB, "p-ap", { id: "legacy", name: "Legacy" });
    expect(result.status).toBe(201);
    expect(result.body).not.toHaveProperty("structure");
  });

  it("allows several structureless channels, which the index deliberately does not police", async () => {
    // SQLite treats NULLs as distinct in a UNIQUE, so the index is
    // partial and excludes them. Asserted so the limit is deliberate
    // rather than discovered.
    await handleCreateIntakeChannel(env.DB, "p-ap", { id: "l1", name: "Legacy one" });
    const second = await handleCreateIntakeChannel(env.DB, "p-ap", { id: "l2", name: "Legacy two" });
    expect(second.status).toBe(201);
  });
});

describe("the seeded structural channels", () => {
  it("gives a process with a legacy channel one channel per structure", async () => {
    // Reproduces what the migration does, since applyTestSchema starts
    // from an empty database.
    await env.DB.prepare(
      "INSERT INTO intake_channels (id, process_id, name) VALUES ('ic-new', 'p-ap', 'New Supplier Integration')"
    ).run();
    for (const [suffix, name, structure] of [
      ["xml", "Structured XML", "structured_xml"],
      ["pdfa", "Structured PDF/A", "structured_pdfa"],
      ["image", "Image", "image"],
    ]) {
      await env.DB.prepare(
        "INSERT INTO intake_channels (id, process_id, name, structure) VALUES (?, 'p-ap', ?, ?)"
      )
        .bind(`p-ap-${suffix}`, name, structure)
        .run();
    }

    const rows = await env.DB.prepare(
      "SELECT structure FROM intake_channels WHERE process_id = 'p-ap' AND structure IS NOT NULL ORDER BY structure"
    ).all<{ structure: string }>();
    expect(rows.results.map((r: { structure: string }) => r.structure)).toEqual(["image", "structured_pdfa", "structured_xml"]);
  });

  it("leaves the legacy channel's structure NULL rather than guessing one", async () => {
    // It received images, hybrid PDFs and UBL alike. Picking one would
    // assert something false about a row that handled three.
    await env.DB.prepare(
      "INSERT INTO intake_channels (id, process_id, name) VALUES ('ic-new', 'p-ap', 'New Supplier Integration')"
    ).run();
    const row = await env.DB.prepare("SELECT structure FROM intake_channels WHERE id = 'ic-new'").first<{
      structure: string | null;
    }>();
    expect(row?.structure).toBeNull();
  });
});

describe("isKnownChannelStructure", () => {
  it("accepts every declared structure", () => {
    for (const s of CHANNEL_STRUCTURES) expect(isKnownChannelStructure(s)).toBe(true);
  });

  it("rejects near misses and non-strings", () => {
    expect(isKnownChannelStructure("xml")).toBe(false);
    expect(isKnownChannelStructure("STRUCTURED_XML")).toBe(false);
    expect(isKnownChannelStructure(null)).toBe(false);
  });
});
