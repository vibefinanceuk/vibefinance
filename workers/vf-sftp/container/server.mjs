/**
 * The container's HTTP face — decision 0620. `POST /run` with
 * `{ connection, ops }` as JSON, answered by `runner.mjs`'s `run`;
 * `GET /health` says it is up. Only vf-sftp's Worker reaches it: the
 * container has no public address.
 */
import { createServer } from "node:http";
import { run } from "./runner.mjs";

const PORT = Number(process.env.PORT ?? 8080);
/** A 20 MB file as base64, with room for the rest of the request. */
const MAX_BODY = 32 * 1024 * 1024;

function reply(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) });
  res.end(text);
}

export function createRunnerServer() {
  return createServer((req, res) => {
    if (req.method === "GET" && req.url === "/health") return reply(res, 200, { ok: true });
    if (req.method !== "POST" || req.url !== "/run") return reply(res, 404, { error: { code: "not_found", message: "POST /run" } });
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reply(res, 413, { error: { code: "too_large", message: "the request is too large" } });
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", async () => {
      if (res.writableEnded) return;
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      } catch {
        return reply(res, 400, { error: { code: "bad_request", message: "the request is not JSON" } });
      }
      try {
        reply(res, 200, await run(body, { timeoutMs: Number(body?.timeoutMs) > 0 ? Math.min(Number(body.timeoutMs), 60_000) : 20_000 }));
      } catch (err) {
        reply(res, 500, { error: { code: "failed", message: err?.message ?? String(err) } });
      }
    });
  });
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  createRunnerServer().listen(PORT, () => console.log(`vf-sftp runner listening on ${PORT}`));
}
