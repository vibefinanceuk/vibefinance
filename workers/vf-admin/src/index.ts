/**
 * The operator interface — decisions 0140, 0186.
 *
 * A fourth Worker, behind Cloudflare Access. **Not part of `vf-ui`**,
 * whose proxy refuses admin paths outright by design; **not part of
 * `vf-licence`**, because binding an interface to it would redeploy the
 * licence minter on every screen change (decision 0099's argument, one
 * Worker along).
 *
 * **Approving a customer is a `curl` today**, and a decision made blind
 * is a checkpoint in name only: nobody sees who asked, what they asked
 * for, or what was decided before.
 */

export interface Env {
  LICENCE_SERVICE: Fetcher;
  ASSETS: Fetcher;
  ACCESS_TEAM_DOMAIN?: string;
  /**
   * **The same secret `vf-licence` checks** — decision 0188.
   *
   * Named `ADMIN_KEY` when this Worker was written, which no route
   * anywhere validates: the control plane has checked `ADMIN_API_KEY`
   * since decision 0006. A forwarded request would have carried a
   * credential nothing compared against.
   *
   * Set with `wrangler secret put ADMIN_API_KEY`, never a var
   * (decision 0009's incident), and it is the **existing** fleet key
   * rather than a new one — two keys for one door is two keys to
   * rotate.
   */
  ADMIN_API_KEY?: string;
}

/**
 * Who is asking, according to Cloudflare rather than according to them.
 *
 * **The header is set by Access after it has verified the identity**,
 * and a request that did not pass through Access does not carry it. A
 * Worker on a `workers.dev` hostname is not behind Access at all, so
 * this refuses rather than assuming — decision 0141's discipline about
 * a domain: *"admits what it cannot do rather than producing something
 * plausible."*
 */
function operatorFrom(request: Request): string | null {
  const email = request.headers.get("Cf-Access-Authenticated-User-Email")?.trim();
  return email ? email.toLowerCase() : null;
}

/**
 * Paths this Worker will forward.
 *
 * **An allow-list, never a prefix.** Decision 0131 found a route
 * missing from `vf-ui`'s list and a rename failing silently; the lesson
 * was to enumerate, and the same applies here where the credential is
 * the fleet's admin key.
 */
const FORWARDED: readonly RegExp[] = [
  /^\/signup-requests$/,
  /^\/signup-requests\/[^/]+\/approve$/,
  /^\/signup-requests\/[^/]+\/reject$/,
  /^\/customers$/,
  /^\/environments$/,
  /^\/environments\/[^/]+\/config$/,
  /^\/licences$/,
  /^\/credentials$/,
  /^\/access$/,
  /^\/admin-actions$/,
  // Partners — decision 0592.
  /^\/partners$/,
  /^\/partners\/[^/]+\/(people|customers|suspend|reinstate)$/,
  // Invitations — decision 0593.
  /^\/invitations$/,
  /^\/invitations\/[^/]+\/(resend|cancel)$/,
  // Reviewing partners' connectors — decision 0600.
  /^\/partner-connectors$/,
  /^\/partner-connectors\/[^/]+\/versions\/\d+\/(approve|return)$/,
  /^\/partner-connectors\/[^/]+\/(suspend|reinstate)$/,
  // The console's screens — decision 0603.
  /^\/fleet-overview$/,
  /^\/people$/,
  // Interface wording and Branding — decision 0604.
  /^\/ui-strings$/,
  /^\/ui-strings\/keys$/,
  /^\/branding\/[^/]+$/,
];

/**
 * **Refresh now — decision 0640.** An environment reads its licence from
 * the control plane every six hours (its cron), or when asked at
 * `POST /licence/refresh` (decision 0004's pattern). This asks it, so a
 * licence changed here reaches the environment at once.
 *
 * - **Where to ask is the control plane's record, never the caller's.**
 *   The environment's `instanceUrl` comes from the fleet overview, read
 *   with the admin key, and must be https; the caller names only the
 *   environment's id.
 * - The environment's refresh fetches the signed token itself and checks
 *   its signature; nothing here carries a licence or a key to it.
 * - It is a plain fetch to the environment's own address: this Worker has
 *   `global_fetch_strictly_public`, so another Worker's workers.dev
 *   address is reached over the public internet rather than refused
 *   (decision 0005's 1042).
 */
export async function refreshLicence(
  env: Pick<Env, "LICENCE_SERVICE" | "ADMIN_API_KEY">,
  environmentId: string,
  operator: string,
  fetchFn: typeof fetch = (input, init) => fetch(input, init),
): Promise<Response> {
  const fleet = await env.LICENCE_SERVICE.fetch(
    new Request("https://vf-licence/fleet-overview", {
      headers: { Authorization: `Bearer ${env.ADMIN_API_KEY}`, "Cf-Access-Authenticated-User-Email": operator },
    }),
  );
  if (!fleet.ok) return json({ error: "the fleet could not be read", reason: "fleet_unavailable" }, 502);
  const body = (await fleet.json().catch(() => ({}))) as {
    customers?: { environments?: { id: string; deployed?: boolean; instanceUrl?: string | null }[] }[];
  };
  const environment = (body.customers ?? []).flatMap((c) => c.environments ?? []).find((e) => e.id === environmentId);
  if (!environment) return json({ error: `${environmentId} is not an environment`, reason: "unknown_environment" }, 404);
  const base = environment.instanceUrl ?? "";
  if (!environment.deployed || !/^https:\/\/[^/]+/.test(base)) {
    return json({ error: `${environmentId} is not deployed yet`, reason: "not_deployed" }, 409);
  }
  let response: Response;
  try {
    response = await fetchFn(`${base.replace(/\/+$/, "")}/licence/refresh`, { method: "POST", signal: AbortSignal.timeout(10_000) });
  } catch {
    return json({ error: `${environmentId} could not be reached`, reason: "unreachable" }, 502);
  }
  const answer = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    return json({ error: `${environmentId} could not refresh its licence`, reason: "not_refreshed", detail: answer.reason ?? response.status }, 502);
  }
  return json({ status: "refreshed", environmentId, currentState: answer.currentState ?? null }, 200);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (!url.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    /**
     * **Verified, never claimed** — decision 0186.
     *
     * `vf-licence` records `admin-key` where no Access identity exists
     * (decision 0140), honestly, and that fails ISO 27001 A.8.15 and
     * SOC 2 CC7.2 — which want a privileged action **attributable**
     * rather than merely recorded.
     *
     * This Worker holds the admin key, so it must not forward a request
     * whose actor is a shared secret. A missing header means the Worker
     * is not behind Access, and that is a deployment fault rather than
     * a caller's mistake — so it says so.
     */
    const operator = operatorFrom(request);
    if (!operator) {
      return json(
        {
          error: "this interface must sit behind Cloudflare Access",
          reason: "no_verified_identity",
        },
        403
      );
    }

    /**
     * **The route before the key**, and the identity before both.
     *
     * A stranger is told nothing about which routes exist. A verified
     * operator asking for a path that does not exist is told exactly
     * that — which is more use to them than *"the admin key is not
     * configured"*, a fault they cannot act on and which has nothing to
     * do with what they asked.
     */
    const path = url.pathname.slice("/api".length);
    const refreshMatch = path.match(/^\/environments\/([^/]+)\/licence-refresh$/);
    if (!refreshMatch && !FORWARDED.some((pattern) => pattern.test(path))) {
      return json({ error: `${path} is not an operator route` }, 404);
    }

    if (!env.ADMIN_API_KEY) {
      // A configuration gap rather than a failure, and the deployment
      // says which — decision 0141's discipline about a missing domain.
      return json({ error: "the admin key is not configured", reason: "no_admin_key" }, 503);
    }

    /**
     * The admin key is added **here**, and the operator's own identity
     * travels with it.
     *
     * `vf-licence` reads `Cf-Access-Authenticated-User-Email` when
     * recording (decision 0140), so forwarding it is what makes the
     * action attributable to a person rather than to a shared secret.
     */
    // Decision 0640: the console asks an environment to read its licence now.
    if (refreshMatch) {
      if (request.method !== "POST") return json({ error: "use POST" }, 405);
      return refreshLicence(env, decodeURIComponent(refreshMatch[1]), operator);
    }

    const headers = new Headers(request.headers);
    headers.set("Authorization", `Bearer ${env.ADMIN_API_KEY}`);
    headers.set("Cf-Access-Authenticated-User-Email", operator);

    return env.LICENCE_SERVICE.fetch(
      new Request(`https://vf-licence${path}${url.search}`, {
        method: request.method,
        headers,
        body:
          request.method === "GET" || request.method === "HEAD"
            ? undefined
            : await request.text(),
      })
    );
  },
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
