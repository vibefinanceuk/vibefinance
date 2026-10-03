import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import ssh2 from "ssh2";
import type { AddressInfo } from "node:net";
import { startFakeSftpServer, type FakeServer } from "./fake-sftp-server.js";
// @ts-expect-error — plain JavaScript, the container's own code.
import { run, fingerprint } from "../container/runner.mjs";
// @ts-expect-error — plain JavaScript, the container's own code.
import { createRunnerServer } from "../container/server.mjs";

/**
 * **The SFTP runner — decision 0620.** Proved against an SFTP server of
 * the tests' own: a real SSH handshake, sign-in by password and by key,
 * the server's identity checked, and files listed, written whole,
 * read, moved and never overwritten.
 */

const { utils } = ssh2;
const hostPair = utils.generateKeyPairSync("ed25519");
const otherHost = utils.generateKeyPairSync("ed25519");
const clientPair = utils.generateKeyPairSync("ed25519");
const fp = (publicLine: string) => fingerprint(Buffer.from(publicLine.split(" ")[1], "base64"));

let server: FakeServer;
let keyServer: FakeServer;

beforeAll(async () => {
  server = await startFakeSftpServer({ username: "vf", password: "s3cret", hostKey: hostPair.private, hostKeyFingerprint: fp(hostPair.public) });
  keyServer = await startFakeSftpServer({ username: "vf", publicKey: clientPair.public, hostKey: hostPair.private, hostKeyFingerprint: fp(hostPair.public) });
});
afterAll(async () => {
  await server.close();
  await keyServer.close();
});
beforeEach(() => {
  server.files.clear();
  server.folders.clear();
  server.folders.add("/");
  server.readOnly.clear();
});

const conn = (extra: Record<string, unknown> = {}) => ({ host: "127.0.0.1", port: server.port, username: "vf", password: "s3cret", ...extra });

describe("signing in, and the server's identity", () => {
  it("signs in with a password, and says the server's host key as OpenSSH shows it", async () => {
    server.files.set("/invoice-1.xml", Buffer.from("<Invoice/>"));
    const out = await run({ connection: conn(), ops: [{ op: "list", path: "/" }] });
    expect(out.error).toBeUndefined();
    expect(out.hostKey).toBe(server.hostKeyFingerprint);
    expect(out.hostKey).toMatch(/^SHA256:[A-Za-z0-9+/]+$/);
    expect(out.results[0]).toMatchObject({ ok: true, entries: [{ name: "invoice-1.xml", size: 10, isFile: true }] });
  });

  it("signs in with a private key", async () => {
    const out = await run({ connection: { host: "127.0.0.1", port: keyServer.port, username: "vf", privateKey: clientPair.private }, ops: [{ op: "list", path: "/" }] });
    expect(out.error).toBeUndefined();
    expect(out.results[0]).toMatchObject({ ok: true, entries: [] });
  });

  it("says a refused password plainly, with the identity it saw", async () => {
    const out = await run({ connection: conn({ password: "wrong" }), ops: [{ op: "list", path: "/" }] });
    expect(out.error).toMatchObject({ code: "auth_failed" });
    expect(out.error.message).toContain("could not sign in to 127.0.0.1");
    expect(out.hostKey).toBe(server.hostKeyFingerprint);
  });

  it("refuses a server whose identity is not the one trusted, before signing in or sending anything", async () => {
    const out = await run({ connection: conn({ hostKey: fp(otherHost.public) }), ops: [{ op: "put", path: "/x.csv", contentBase64: "YQ==" }] });
    expect(out.error).toMatchObject({ code: "host_key_changed" });
    expect(out.error.message).toContain(server.hostKeyFingerprint);
    expect(server.files.size).toBe(0);
  });

  it("goes ahead with the identity trusted", async () => {
    const out = await run({ connection: conn({ hostKey: server.hostKeyFingerprint }), ops: [{ op: "list", path: "/" }] });
    expect(out.results[0].ok).toBe(true);
  });

  it("says a server that cannot be reached", async () => {
    const closed = createRunnerServer();
    await new Promise<void>((r) => closed.listen(0, "127.0.0.1", () => r()));
    const port = (closed.address() as AddressInfo).port;
    await new Promise<void>((r) => closed.close(() => r()));
    const out = await run({ connection: conn({ port }), ops: [] });
    expect(out.error).toMatchObject({ code: "connect_failed" });
  });

  it("refuses a request without what signing in needs, in words", async () => {
    expect((await run({ connection: { host: "", username: "vf", password: "x" }, ops: [] })).error).toMatchObject({ code: "bad_request", message: "name the server's host" });
    expect((await run({ connection: { host: "h", username: "vf" }, ops: [] })).error).toMatchObject({ code: "bad_request", message: "give a password or a private key" });
    expect((await run({ connection: { host: "h", username: "vf", password: "x", port: 70000 }, ops: [] })).error).toMatchObject({ code: "bad_request" });
  });

  it("refuses a private key that cannot be read, before connecting", async () => {
    const out = await run({ connection: { host: "127.0.0.1", port: server.port, username: "vf", privateKey: "not a key" }, ops: [] });
    expect(out.error).toMatchObject({ code: "bad_key" });
  });
});

describe("files", () => {
  it("writes a file whole, under its own name, with nothing half-written left behind", async () => {
    server.folders.add("/to-erp");
    const out = await run({ connection: conn(), ops: [{ op: "put", path: "/to-erp/RE-4417.csv", contentBase64: Buffer.from("a,b\n1,2\n").toString("base64") }] });
    expect(out.results[0]).toMatchObject({ ok: true, path: "/to-erp/RE-4417.csv", bytes: 8 });
    expect(server.files.get("/to-erp/RE-4417.csv")?.toString()).toBe("a,b\n1,2\n");
    expect([...server.files.keys()]).toEqual(["/to-erp/RE-4417.csv"]);
  });

  it("never overwrites a file already there, and leaves the one there as it was", async () => {
    server.files.set("/RE-1.csv", Buffer.from("first"));
    const out = await run({ connection: conn(), ops: [{ op: "put", path: "/RE-1.csv", contentBase64: Buffer.from("second").toString("base64") }] });
    expect(out.results[0]).toMatchObject({ ok: false, error: { code: "exists" } });
    expect(server.files.get("/RE-1.csv")?.toString()).toBe("first");
    expect([...server.files.keys()]).toEqual(["/RE-1.csv"]);
  });

  it("says a folder it may not write to, and a folder that is not there", async () => {
    server.folders.add("/locked");
    server.readOnly.add("/locked");
    const denied = await run({ connection: conn(), ops: [{ op: "put", path: "/locked/a.csv", contentBase64: "YQ==" }] });
    expect(denied.results[0].error).toMatchObject({ code: "permission_denied" });
    const missing = await run({ connection: conn(), ops: [{ op: "list", path: "/nowhere" }] });
    expect(missing.results[0].error).toMatchObject({ code: "not_found" });
  });

  it("makes a folder where it is not there, moves a file into it and reads it, on one connection", async () => {
    server.files.set("/in/88240.xml", Buffer.from("<Rechnung/>"));
    server.folders.add("/in");
    const out = await run({
      connection: conn(),
      ops: [
        { op: "ensureDir", path: "/in/processed" },
        { op: "ensureDir", path: "/in/processed" },
        { op: "move", from: "/in/88240.xml", to: "/in/processed/88240.xml" },
        { op: "get", path: "/in/processed/88240.xml" },
      ],
    });
    expect(out.results.map((r: { ok: boolean }) => r.ok)).toEqual([true, true, true, true]);
    expect(out.results[0]).toMatchObject({ made: true });
    expect(out.results[1]).toMatchObject({ made: false });
    expect(Buffer.from(out.results[3].contentBase64, "base64").toString()).toBe("<Rechnung/>");
    expect(server.files.has("/in/88240.xml")).toBe(false);
  });

  it("stops at the first step that fails, and says the rest were not tried", async () => {
    const out = await run({
      connection: conn(),
      ops: [
        { op: "get", path: "/gone.xml" },
        { op: "list", path: "/" },
      ],
    });
    expect(out.results[0]).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(out.results[1]).toMatchObject({ ok: false, error: { code: "skipped" } });
  });

  it("refuses an operation it does not know", async () => {
    const out = await run({ connection: conn(), ops: [{ op: "delete_everything" }] });
    expect(out.results[0]).toMatchObject({ ok: false, error: { code: "bad_request" } });
  });
});

describe("the container's HTTP face", () => {
  it("answers POST /run as run does, says it is up, and refuses what is not JSON", async () => {
    const http = createRunnerServer();
    await new Promise<void>((r) => http.listen(0, "127.0.0.1", () => r()));
    const base = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
    try {
      expect(await (await fetch(`${base}/health`)).json()).toEqual({ ok: true });
      server.files.set("/a.xml", Buffer.from("x"));
      const answer = await (await fetch(`${base}/run`, { method: "POST", body: JSON.stringify({ connection: conn(), ops: [{ op: "list", path: "/" }] }) })).json();
      expect(answer.hostKey).toBe(server.hostKeyFingerprint);
      expect(answer.results[0].entries.map((e: { name: string }) => e.name)).toEqual(["a.xml"]);
      const bad = await fetch(`${base}/run`, { method: "POST", body: "nope" });
      expect(bad.status).toBe(400);
      expect((await fetch(`${base}/other`)).status).toBe(404);
    } finally {
      await new Promise<void>((r) => http.close(() => r()));
    }
  });
});
