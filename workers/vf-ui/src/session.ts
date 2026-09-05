/**
 * The session cookie — decision 0102.
 *
 * **The token never enters JavaScript.** Current guidance (RFC 10017)
 * is that no browser API stores a token securely: `localStorage` and
 * `sessionStorage` are equally readable by an injected script, and
 * choosing between them chooses how long a stolen token stays useful
 * rather than whether it can be stolen.
 *
 * So it lives in an `HttpOnly` cookie, which script cannot read, and
 * `vf-ui` attaches it to requests on the browser's behalf.
 */

const COOKIE_NAME = "vf_session";

/**
 * The cookie carries the token itself rather than an id pointing at
 * stored state.
 *
 * A Worker is stateless; holding sessions would mean KV, D1 or Durable
 * Objects — new infrastructure for one purpose. The token is already a
 * signed, self-contained, hour-lived credential, and putting it
 * somewhere the browser keeps and script cannot read is exactly what is
 * wanted.
 */
export interface SessionCookie {
  token: string;
  environmentId: string;
  instanceUrl: string;
}

/**
 * `SameSite=Strict`, and the reason matters.
 *
 * A cookie is sent automatically, which is what makes a refresh work
 * and also what creates a CSRF surface a bearer token in a header never
 * had — a cross-site request could otherwise act as the signed-in
 * person. `Strict` means the browser sends it only for requests
 * originating on this site.
 *
 * `Lax` would permit top-level navigations from elsewhere, which is
 * usually the friendlier choice. There is nothing here worth linking
 * into from another site, so the friendlier choice buys nothing and
 * costs the guarantee.
 */
function cookieAttributes(maxAgeSeconds: number): string {
  return [
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
    `Max-Age=${maxAgeSeconds}`,
  ].join("; ");
}

function encode(value: SessionCookie): string {
  const json = JSON.stringify(value);
  // base64url, so no cookie-hostile characters survive. Not encryption
  // and not claiming to be: the cookie is HttpOnly, and its contents
  // are a token the holder is entitled to use anyway.
  return btoa(json).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decode(raw: string): SessionCookie | null {
  try {
    const padded = raw.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (raw.length % 4)) % 4);
    const value = JSON.parse(atob(padded)) as unknown;
    if (
      typeof value !== "object" ||
      value === null ||
      typeof (value as SessionCookie).token !== "string" ||
      typeof (value as SessionCookie).environmentId !== "string" ||
      typeof (value as SessionCookie).instanceUrl !== "string"
    ) {
      return null;
    }
    return value as SessionCookie;
  } catch {
    // A cookie this cannot parse is no session, not a crash. Anybody
    // can send an arbitrary cookie.
    return null;
  }
}

export function setSessionCookie(session: SessionCookie, expiresAt: string): string {
  const remaining = Math.max(
    0,
    Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000)
  );
  // The cookie expires when the token does. A cookie outliving its
  // token means a browser that believes it is signed in and an API that
  // disagrees — which presents as an unexplained failure mid-task.
  return `${COOKIE_NAME}=${encode(session)}; ${cookieAttributes(remaining)}`;
}

export function clearSessionCookie(): string {
  return `${COOKIE_NAME}=; ${cookieAttributes(0)}`;
}

export function readSessionCookie(request: Request): SessionCookie | null {
  const header = request.headers.get("Cookie");
  if (!header) return null;

  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === COOKIE_NAME) return decode(rest.join("="));
  }
  return null;
}
