import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import worker from "../src/index.js";
import type { Env } from "../src/index.js";
import { generateApiKey, hashApiKey } from "../src/user-auth.js";

/**
 * **Someone else's week is AP Analytics' to show — decision 0611.** The
 * Documents search may show a person their own completed work with
 * `AP.Review`; another person's needs `AP.Analysis`, as the throughput
 * card that links to it does.
 */

async function person(id: string, permissions: string[]) {
  const key = generateApiKey();
  await env.DB.prepare("INSERT INTO org_users (id, email, name, api_key_hash) VALUES (?, ?, ?, ?)").bind(id, `${id}@acme.example`, id, await hashApiKey(key)).run();
  await env.DB.prepare("INSERT INTO org_roles (id, name, permissions_json) VALUES (?, ?, ?)").bind(`r-${id}`, `Role ${id}`, JSON.stringify(permissions)).run();
  await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id) VALUES (?, ?)").bind(id, `r-${id}`).run();
  return key;
}
const ask = (key: string, query: string) => worker.fetch(new Request(`https://vf.example/documents?${query}`, { headers: { Authorization: `Bearer ${key}` } }), env as unknown as Env);

beforeEach(async () => {
  await applyTestSchema();
});

describe("who may see whose work in Documents — decision 0611", () => {
  it("shows a reviewer their own week, refuses them someone else's, and lets an analyst see anyone's", async () => {
    const reviewer = await person("rev", ["AP.Review"]);
    const analyst = await person("ana", ["AP.Review", "AP.Analysis"]);
    expect((await ask(reviewer, "doneBy=rev&page=1&pageSize=25")).status).toBe(200);
    expect((await ask(reviewer, "doneBy=ana&page=1&pageSize=25")).status).toBe(403);
    expect((await ask(analyst, "doneBy=rev&page=1&pageSize=25")).status).toBe(200);
    expect((await ask(reviewer, "team=ap-team&page=1&pageSize=25")).status).toBe(200);
  });
});

describe("who may see whose open tasks in Documents — decision 0614", () => {
  it("shows a reviewer their own, refuses them someone else's, and lets an analyst see anyone's", async () => {
    const reviewer = await person("rev", ["AP.Review"]);
    const analyst = await person("ana", ["AP.Review", "AP.Analysis"]);
    expect((await ask(reviewer, "openFor=rev&page=1&pageSize=25")).status).toBe(200);
    expect((await ask(reviewer, "openFor=ana&openStage=validation&page=1&pageSize=25")).status).toBe(403);
    expect((await ask(analyst, "openFor=rev&openStage=validation&page=1&pageSize=25")).status).toBe(200);
  });
});

describe("who may see what others handled in Documents — decision 0616", () => {
  it("shows a reviewer their own, refuses them someone else's, and lets an analyst see anyone's", async () => {
    const reviewer = await person("rev", ["AP.Review"]);
    const analyst = await person("ana", ["AP.Review", "AP.Analysis"]);
    expect((await ask(reviewer, "handledBy=rev&page=1&pageSize=25")).status).toBe(200);
    expect((await ask(reviewer, "handledBy=ana&handledStage=validation&page=1&pageSize=25")).status).toBe(403);
    expect((await ask(analyst, "handledBy=rev&page=1&pageSize=25")).status).toBe(200);
  });
});
