import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleCreateProcess, handleCreateStage } from "../src/process-route.js";

beforeEach(async () => {
  await applyTestSchema();
});

describe("handleCreateProcess", () => {
  it("400s when id or name is missing", async () => {
    const result = await handleCreateProcess(env.DB, { id: "p1" });
    expect(result.status).toBe(400);
  });

  it("creates a process", async () => {
    const result = await handleCreateProcess(env.DB, { id: "p1", name: "Standard AP" });
    expect(result.status).toBe(201);
    const row = await env.DB.prepare("SELECT name FROM processes WHERE id = ?").bind("p1").first();
    expect(row).toEqual({ name: "Standard AP" });
  });

  it("409s on a duplicate id", async () => {
    await handleCreateProcess(env.DB, { id: "p1", name: "Standard AP" });
    const result = await handleCreateProcess(env.DB, { id: "p1", name: "Different name" });
    expect(result.status).toBe(409);
  });
});

describe("handleCreateStage", () => {
  it("400s when id, name, or sequence is missing", async () => {
    await handleCreateProcess(env.DB, { id: "p1", name: "Standard AP" });
    const result = await handleCreateStage(env.DB, "p1", { id: "s1", name: "Received" });
    expect(result.status).toBe(400);
  });

  it("404s when the process does not exist", async () => {
    const result = await handleCreateStage(env.DB, "does-not-exist", { id: "s1", name: "Received", sequence: 1 });
    expect(result.status).toBe(404);
  });

  it("creates a stage with no rule set — a purely automatic stage", async () => {
    await handleCreateProcess(env.DB, { id: "p1", name: "Standard AP" });
    const result = await handleCreateStage(env.DB, "p1", { id: "s1", name: "Received", sequence: 1 });
    expect(result.status).toBe(201);
    const row = await env.DB.prepare("SELECT name, sequence, rule_set_id FROM process_stages WHERE id = ?")
      .bind("s1")
      .first();
    expect(row).toEqual({ name: "Received", sequence: 1, rule_set_id: null });
  });

  it("404s when ruleSetId is provided but does not exist", async () => {
    await handleCreateProcess(env.DB, { id: "p1", name: "Standard AP" });
    const result = await handleCreateStage(env.DB, "p1", {
      id: "s1",
      name: "Approval",
      sequence: 1,
      ruleSetId: "does-not-exist",
    });
    expect(result.status).toBe(404);
  });

  it("creates a stage with a real rule set", async () => {
    await env.DB.prepare("INSERT INTO rule_sets (id, name, mode, status) VALUES (?, ?, ?, ?)")
      .bind("rs1", "test", "first_match", "active")
      .run();
    await handleCreateProcess(env.DB, { id: "p1", name: "Standard AP" });
    const result = await handleCreateStage(env.DB, "p1", {
      id: "s1",
      name: "Approval",
      sequence: 1,
      ruleSetId: "rs1",
    });
    expect(result.status).toBe(201);
    const row = await env.DB.prepare("SELECT rule_set_id FROM process_stages WHERE id = ?").bind("s1").first();
    expect(row).toEqual({ rule_set_id: "rs1" });
  });

  it("409s when the sequence is already used by another stage in the same process", async () => {
    await handleCreateProcess(env.DB, { id: "p1", name: "Standard AP" });
    await handleCreateStage(env.DB, "p1", { id: "s1", name: "Received", sequence: 1 });
    const result = await handleCreateStage(env.DB, "p1", { id: "s2", name: "Validated", sequence: 1 });
    expect(result.status).toBe(409);
  });

  it("the same sequence number is fine across two DIFFERENT processes", async () => {
    await handleCreateProcess(env.DB, { id: "p1", name: "AP" });
    await handleCreateProcess(env.DB, { id: "p2", name: "Expense" });
    await handleCreateStage(env.DB, "p1", { id: "s1", name: "Received", sequence: 1 });
    const result = await handleCreateStage(env.DB, "p2", { id: "s2", name: "Submitted", sequence: 1 });
    expect(result.status).toBe(201);
  });
});
