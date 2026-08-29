/**
 * The control plane. Blueprint, "Subsystem three": customers, licences,
 * usage counts — never customer content. This binding is intentionally
 * named CONTROL_DB rather than DB, so a reviewer scanning for the
 * `no-restricted-properties` lint rule's banned names doesn't mistake
 * this Worker for one that needs the resolveTenant discipline — it has
 * no tenant to resolve. There is exactly one of this Worker, not one
 * per customer.
 *
 * The signed-token licensing contract, the offline grace path, and
 * idempotent usage-period ingestion (Blueprint, "Subsystem three") are
 * a later build step, deliberately not in this bundle — see
 * docs/change-and-promotion-model.md's build order: "Payments last —
 * the webhook is the easy part." This skeleton exists so the trust
 * boundary is real (a separate Worker, a separate database, a separate
 * deploy) from the first commit, rather than retrofitted once vf-app
 * has grown roots into it.
 */

export interface Env {
  CONTROL_DB?: D1Database;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      if (!env.CONTROL_DB) {
        return json({ status: "error", detail: "CONTROL_DB binding missing" }, 500);
      }
      // Confirms the binding is live, not just declared.
      await env.CONTROL_DB.prepare("SELECT 1").first();
      return json({ status: "ok" });
    }

    return json({ error: "not found" }, 404);
  },
};
