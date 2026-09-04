/**
 * Cross-origin access — decision 0098.
 *
 * CORS is **entirely a browser mechanism**. A server blocks nothing; it
 * states which origins are permitted, and the browser withholds the
 * response from JavaScript when the headers do not allow it. `curl`
 * ignores all of it, which is why every command against these Workers
 * works today with no CORS headers anywhere.
 *
 * So this is not a security control against a determined caller. It is
 * the mechanism that decides **which web pages may read a signed-in
 * person's data**, which is a narrower and still important thing.
 */

/**
 * `Authorization` is not a CORS-safelisted header, so any request
 * carrying a session token triggers a preflight — and it **cannot be
 * wildcarded**, checked against MDN rather than assumed. It has to be
 * named.
 */
const ALLOWED_HEADERS = "Authorization, Content-Type";

const ALLOWED_METHODS = "GET, POST, PUT, DELETE, OPTIONS";

/** A day. Long enough that a UI is not preflighting every call. */
const MAX_AGE_SECONDS = 86400;

/**
 * Parse the configured allow-list.
 *
 * **Unset means no CORS headers at all**, which is exactly how these
 * Workers behave today: no browser page can read a response, and every
 * existing test and `curl` is unaffected. A Worker with no UI
 * configured should be byte-identical in behaviour to before.
 */
export function allowedOrigins(configured: string | undefined): string[] {
  if (!configured) return [];
  return configured
    .split(",")
    .map((o) => o.trim())
    .filter((o) => o !== "");
}

/**
 * The headers to add, or nothing.
 *
 * **The matching origin is echoed, never a wildcard and never whatever
 * arrived.** Echoing the request's own origin unconditionally is a
 * wildcard with extra steps — the well-known mistake that makes an
 * allow-list decorative.
 *
 * `Vary: Origin` because the response genuinely differs by origin, and
 * a cache that ignored it could serve one origin's permitted response
 * to another.
 *
 * Note what is **absent**: `Access-Control-Allow-Credentials`. These
 * APIs authenticate with a bearer token, which is an ordinary header
 * rather than "credentials" in the CORS sense — that means cookies and
 * TLS client certificates. Omitting it means a browser will not attach
 * cookies to these requests even if the origin check were wrong.
 */
export function corsHeaders(request: Request, configured: string | undefined): Record<string, string> {
  const origins = allowedOrigins(configured);
  if (origins.length === 0) return {};

  const origin = request.headers.get("Origin");
  if (!origin || !origins.includes(origin)) return { Vary: "Origin" };

  return {
    "Access-Control-Allow-Origin": origin,
    Vary: "Origin",
  };
}

/**
 * Answer a preflight, or return null if this is not one.
 *
 * A preflight carries no credentials and no body — it asks whether the
 * real request would be permitted. Answering it says nothing about
 * whether that request would then succeed, which is the router's job.
 */
export function handlePreflight(request: Request, configured: string | undefined): Response | null {
  if (request.method !== "OPTIONS") return null;
  if (!request.headers.get("Access-Control-Request-Method")) return null;

  const headers = corsHeaders(request, configured);
  if (!headers["Access-Control-Allow-Origin"]) {
    // Not an allowed origin. Refused by saying nothing useful rather
    // than by an error, which is what a browser expects: the absent
    // header is the refusal.
    return new Response(null, { status: 204, headers });
  }

  return new Response(null, {
    status: 204,
    headers: {
      ...headers,
      "Access-Control-Allow-Methods": ALLOWED_METHODS,
      "Access-Control-Allow-Headers": ALLOWED_HEADERS,
      "Access-Control-Max-Age": String(MAX_AGE_SECONDS),
    },
  });
}

/**
 * Copy a response, adding the CORS headers.
 *
 * Applied at the edge of the Worker to whatever the router produced, so
 * no individual route has to remember — a route that forgot would work
 * from `curl` and fail from a browser, which is the kind of divergence
 * this project keeps finding.
 */
export function withCors(
  response: Response,
  request: Request,
  configured: string | undefined
): Response {
  const headers = corsHeaders(request, configured);
  if (Object.keys(headers).length === 0) return response;

  const merged = new Headers(response.headers);
  for (const [key, value] of Object.entries(headers)) merged.set(key, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: merged,
  });
}
