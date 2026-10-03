import { Container } from "@cloudflare/containers";

/**
 * **vf-sftp — decision 0620, the SFTP proof of concept.**
 *
 * One Worker for the whole fleet, reached only by service binding from
 * each customer's vf-app (it has no public address: `workers_dev` is off
 * and it has no route). It passes `POST /run` to its container, where
 * `container/runner.mjs` does the SFTP, and passes the answer back.
 *
 * It keeps nothing: the server, the user and the password or key come
 * with each request from vf-app's encrypted connector secrets.
 *
 * **One container, asleep when idle.** `sleepAfter` stops it five minutes
 * after the last request; the next one starts it again (a few seconds).
 * A proof of concept needs no more than one; more can be spread across
 * later (`getRandom`).
 */
export class SftpRunner extends Container {
  defaultPort = 8080;
  sleepAfter = "5m";
}

export interface Env {
  SFTP_RUNNER: DurableObjectNamespace<SftpRunner>;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health" && request.method === "GET") {
      return Response.json({ ok: true, service: "vf-sftp" });
    }
    if (url.pathname !== "/run" || request.method !== "POST") {
      return Response.json({ error: { code: "not_found", message: "POST /run" } }, { status: 404 });
    }
    const container = env.SFTP_RUNNER.getByName("sftp-runner");
    try {
      return await container.fetch(new Request("http://container/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: request.body }));
    } catch (err) {
      return Response.json({ error: { code: "runner_unavailable", message: `the SFTP runner could not be started: ${(err as Error).message}` } }, { status: 503 });
    }
  },
};
