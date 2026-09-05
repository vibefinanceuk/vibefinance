import { readSessionCookie, setSessionCookie, clearSessionCookie } from "./session.js";

/**
 * vf-ui — the shared interface, and the browser's only origin —
 * decision 0099, extended by decision 0102.
 *
 * **One deployment, every customer.** With authentication in the
 * control plane, a per-instance UI would mean a person had to know
 * their region before they could sign in, which is backwards (0083
 * section 3).
 *
 * **Its own Worker, not assets bound to `vf-licence`**, on deployment
 * frequency: binding them means every UI change redeploying the
 * component that mints licence tokens for the entire fleet.
 *
 * Since decision 0102 it is also a **backend-for-frontend**: it holds
 * the session token in an `HttpOnly` cookie and attaches it to requests
 * on the browser's behalf, so the token never enters JavaScript. That
 * makes this a request path rather than a file server, and therefore
 * critical rather than convenient — stated plainly because it is a real
 * cost of the pattern.
 */

export interface Env {
  ASSETS: Fetcher;
  /**
   * Where `vf-licence` lives. Configuration rather than a constant: if
   * it were compiled into the JavaScript, moving to a custom domain
   * would mean rebuilding the UI (decision 0099).
   */
  LICENCE_API?: string;
}

function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...extra },
  });
}

/**
 * Configuration, as a script the page loads.
 *
 * Since decision 0102 it no longer carries the API address: the browser
 * talks only to this origin, so there is nothing to tell it. Kept
 * because a UI needs to know things, and removing the mechanism to add
 * it back later would be churn.
 */
function configScript(): Response {
  return new Response(`window.VF_CONFIG = ${JSON.stringify({ bff: true })};\n`, {
    status: 200,
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

/**
 * What may be proxied to a customer's instance.
 *
 * **An explicit list, not a general forwarder.** A proxy that forwards
 * whatever it is given forwards routes nobody has thought about — and
 * this project found three write routes sitting above an admin gate
 * (decision 0097) by exactly that kind of inattention. Adding a path
 * here should be a deliberate act.
 *
 * Each entry is matched against the whole path.
 */
const PROXIED_TO_INSTANCE: RegExp[] = [/^\/whoami$/];

/**
 * What may be proxied to `vf-licence`.
 *
 * Both are reached **before** anybody is signed in, which is why they
 * are here rather than behind the session:
 *
 *   - `/my-environments` carries credentials in its body and answers
 *     which instances a person may reach. It cannot require a session,
 *     because choosing an instance is what creates one.
 *   - `/branding/:id/tokens.css` is a customer's livery, deliberately
 *     public: the login screen needs it before anybody has signed in,
 *     and it discloses four colours and a name (decision 0096).
 */
const PROXIED_TO_LICENCE: RegExp[] = [
  /^\/my-environments$/,
  /^\/branding\/[^/]+\/tokens\.css$/,
];

function mayProxy(path: string): boolean {
  return PROXIED_TO_INSTANCE.some((pattern) => pattern.test(path));
}

function mayProxyToLicence(path: string): boolean {
  return PROXIED_TO_LICENCE.some((pattern) => pattern.test(path));
}

/**
 * Forward to the control plane, with no session attached.
 *
 * Nothing here needs one, and attaching a token to a route that does
 * not expect it is how a credential ends up somewhere nobody meant it
 * to go.
 */
async function proxyToLicence(request: Request, path: string, env: Env): Promise<Response> {
  if (!env.LICENCE_API) return json({ error: "LICENCE_API is not configured" }, 500);

  const target = new URL(path + new URL(request.url).search, env.LICENCE_API);
  return fetch(target, {
    method: request.method,
    headers: request.headers.get("Content-Type")
      ? { "Content-Type": request.headers.get("Content-Type") as string }
      : {},
    body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
  });
}

/**
 * What the page is allowed to see of a sign-in response.
 *
 * **Everything except the token.** Returning it as well would put it
 * back in JavaScript and undo the entire point of decision 0102 — the
 * cookie is `HttpOnly` precisely so script cannot reach the credential.
 *
 * Removed by name rather than by building a permitted list, so a new
 * field `vf-licence` adds reaches the page automatically and only the
 * one thing that must not is taken out.
 *
 * Exported because it is the property this whole change exists for, and
 * the sign-in path itself cannot be exercised without `vf-licence`
 * answering. A function that can be tested is better than a property
 * that cannot.
 */
export function visibleToPage(result: Record<string, unknown>): Record<string, unknown> {
  const visible = { ...result };
  delete visible.token;
  return visible;
}

async function handleSignIn(request: Request, env: Env): Promise<Response> {
  if (!env.LICENCE_API) return json({ error: "LICENCE_API is not configured" }, 500);

  const body = await request.json().catch(() => null);
  if (!body) return json({ error: "invalid JSON body" }, 400);

  const upstream = await fetch(`${env.LICENCE_API}/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const result = (await upstream.json().catch(() => ({}))) as Record<string, unknown>;

  if (!upstream.ok) {
    // Passed through unchanged. vf-licence gives the same message for
    // every authentication failure on purpose (decision 0094), and
    // adding anything here would undo that.
    return json(result, upstream.status);
  }

  const cookie = setSessionCookie(
    {
      token: String(result.token),
      environmentId: String(result.environmentId),
      instanceUrl: String(result.instanceUrl),
    },
    String(result.expiresAt)
  );

  return json(visibleToPage(result), 200, { "Set-Cookie": cookie });
}

async function handleProxy(request: Request, path: string): Promise<Response> {
  const session = readSessionCookie(request);
  if (!session) return json({ error: "not signed in" }, 401);

  const target = new URL(path + new URL(request.url).search, session.instanceUrl);

  const upstream = await fetch(target, {
    method: request.method,
    headers: {
      // The cookie becomes a bearer token here and nowhere else. The
      // browser never held one; the instance never sees a cookie.
      Authorization: `Bearer ${session.token}`,
      ...(request.headers.get("Content-Type")
        ? { "Content-Type": request.headers.get("Content-Type") as string }
        : {}),
    },
    body: request.method === "GET" || request.method === "HEAD" ? undefined : request.body,
  });

  if (upstream.status === 401) {
    // The token expired or the instance refused it. Clearing the cookie
    // means the next page load shows a sign-in screen rather than a
    // session that looks alive and fails on every action.
    const body = await upstream.text();
    return new Response(body, {
      status: 401,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") ?? "application/json",
        "Set-Cookie": clearSessionCookie(),
      },
    });
  }

  return upstream;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/config.js") return configScript();

    if (url.pathname === "/api/sign-in" && request.method === "POST") {
      return handleSignIn(request, env);
    }

    if (url.pathname === "/api/sign-out" && request.method === "POST") {
      return json({ signedOut: true }, 200, { "Set-Cookie": clearSessionCookie() });
    }

    // Anything under /api is either a proxied path or nothing. Falling
    // through to the page for an unrecognised API call would return
    // HTML to something expecting JSON.
    if (url.pathname.startsWith("/api/")) {
      const path = url.pathname.slice("/api".length);
      if (mayProxyToLicence(path)) return proxyToLicence(request, path, env);
      if (!mayProxy(path)) return json({ error: "not found" }, 404);
      return handleProxy(request, path);
    }

    // Everything else is a file. Cloudflare has already tried to match
    // one, so reaching here means nothing did — and a single-page
    // interface answers an unknown path with its own entry point,
    // because the path may be a route the page understands.
    const asset = await env.ASSETS.fetch(new URL("/index.html", request.url));
    return new Response(asset.body, {
      status: 200,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  },
};
