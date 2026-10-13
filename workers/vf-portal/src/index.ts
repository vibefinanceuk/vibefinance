import { fromCustomer, invoice, invoices, me, order, receipt, reply, submissionCompanies, submit, type Deps, orderDocument, confirmByLink, confirmOrder, invoiceDocument } from "./network.js";

/**
 * **vf-portal: the supplier network — decision 0717.**
 *
 * Pages are static files. `/api/*` is this Worker: it signs a supplier's
 * person in with vf-licence, keeps their portal session in an `HttpOnly`,
 * `Secure`, `SameSite=Strict` cookie, and asks each linked customer's
 * instance for their invoices. Nothing is stored here.
 */

export interface Env {
  ASSETS: Fetcher;
  LICENCE_SERVICE?: Fetcher;
  LICENCE_API?: string;
}

const COOKIE = "vfn_session";

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });
}

function cookie(value: string, maxAgeSeconds: number): string {
  return `${COOKIE}=${value}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`;
}

export function readSession(request: Request): string | null {
  for (const part of (request.headers.get("Cookie") ?? "").split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === COOKIE && rest.join("=")) return rest.join("=");
  }
  return null;
}

function licenceFetcher(env: Env) {
  return async (path: string, init: RequestInit = {}): Promise<Response> => {
    if (!env.LICENCE_SERVICE || !env.LICENCE_API) return json({ error: "LICENCE_SERVICE and LICENCE_API must both be configured" }, 500);
    return env.LICENCE_SERVICE.fetch(new URL(path, env.LICENCE_API).toString(), init);
  };
}

/** A sign-in's answer as a cookie; the token itself never reaches the page. */
async function signedIn(res: Response): Promise<Response> {
  const body = ((await res.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
  if (res.status !== 200 || typeof body.token !== "string") return json(body, res.status);
  const seconds = (new Date(String(body.expiresAt)).getTime() - Date.now()) / 1000;
  return json({ signedIn: true }, 200, { "Set-Cookie": cookie(body.token, seconds) });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);

    /**
     * **Only this site may post here.** The cookie is `SameSite=Strict`
     * already; a POST that names another origin is refused as well.
     */
    if (request.method === "POST") {
      const origin = request.headers.get("Origin");
      if (origin && origin !== url.origin) return json({ error: "forbidden" }, 403);
    }

    const licence = licenceFetcher(env);
    const post = async (path: string) =>
      licence(path, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(request.headers.get("CF-Connecting-IP") ? { "CF-Connecting-IP": request.headers.get("CF-Connecting-IP")! } : {}) },
        body: JSON.stringify(((await request.json().catch(() => ({}))) ?? {}) as Record<string, unknown>),
      });

    // The words, from the control plane (0107), in the browser's language.
    if (url.pathname === "/api/ui-strings" && request.method === "GET") {
      return licence(`/ui-strings${url.search}`);
    }
    if (url.pathname === "/api/invitation/view" && request.method === "POST") {
      const res = await post("/portal/invitations/view");
      return json(await res.json().catch(() => ({})), res.status);
    }
    // Accepting signs the person in at once, with the password they just gave.
    if (url.pathname === "/api/invitation/accept" && request.method === "POST") {
      const body = ((await request.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
      const accepted = await licence("/portal/invitations/accept", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const answer = ((await accepted.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
      if (accepted.status !== 200) return json(answer, accepted.status);
      return signedIn(await licence("/portal/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: answer.email, password: body.password }) }));
    }
    if (url.pathname === "/api/sign-in" && request.method === "POST") return signedIn(await post("/portal/login"));
    if (url.pathname === "/api/sign-out" && request.method === "POST") return json({ signedOut: true }, 200, { "Set-Cookie": cookie("", 0) });

    /**
     * Decision 0762: the email's Confirm receipt link, posted by the confirm
     * page once it has loaded in a browser. Signed in or not: the link is
     * the proof.
     */
    if (url.pathname === "/api/order-confirm" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const result = await confirmByLink({ licence, instance: (u, init) => fetch(u, init) }, body, request.headers.get("User-Agent"));
      return json(result.body, result.status);
    }

    const session = readSession(request);
    if (!session) return json({ error: "signed_out" }, 401);
    const deps: Deps = { licence, instance: (u, init) => fetch(u, init) };
    const signedOutClears = (r: { status: number; body: unknown }) => json(r.body, r.status, r.status === 401 ? { "Set-Cookie": cookie("", 0) } : {});

    if (url.pathname === "/api/me" && request.method === "GET") return signedOutClears(await me(deps, session));
    if (url.pathname === "/api/invoices" && request.method === "GET") return signedOutClears(await invoices(deps, session, url.searchParams));
    // Decision 0770: an invoice's or credit note's own document — the page, or a file.
    const invoiceDoc = url.pathname.match(/^\/api\/invoices\/([^/]+)\/([^/]+)\/document$/);
    if (invoiceDoc && request.method === "GET") {
      const res = await invoiceDocument(deps, session, decodeURIComponent(invoiceDoc[1]), decodeURIComponent(invoiceDoc[2]), url.search);
      if (res.status === 401) return json({ error: "signed_out" }, 401, { "Set-Cookie": cookie("", 0) });
      return res;
    }
    const one = url.pathname.match(/^\/api\/invoices\/([^/]+)\/([^/]+)$/);
    if (one && request.method === "GET") return signedOutClears(await invoice(deps, session, decodeURIComponent(one[1]), decodeURIComponent(one[2])));
    // Decision 0760: a shared order as a document — PDF, UBL or CSV.
    const orderDoc = url.pathname.match(/^\/api\/orders\/([^/]+)\/([^/]+)\/document$/);
    if (orderDoc && request.method === "GET") {
      const res = await orderDocument(deps, session, decodeURIComponent(orderDoc[1]), decodeURIComponent(orderDoc[2]), url.search);
      if (res.status === 401) return json({ error: "signed_out" }, 401, { "Set-Cookie": cookie("", 0) });
      return res;
    }
    // Decision 0751: a purchase order the customer shares, read only.
    const oneOrder = url.pathname.match(/^\/api\/orders\/([^/]+)\/([^/]+)$/);
    if (oneOrder && request.method === "GET") return signedOutClears(await order(deps, session, decodeURIComponent(oneOrder[1]), decodeURIComponent(oneOrder[2])));
    // Decision 0762: the supplier confirms it has the order, in the network.
    const confirm = url.pathname.match(/^\/api\/orders\/([^/]+)\/([^/]+)\/confirm$/);
    if (confirm && request.method === "POST") return signedOutClears(await confirmOrder(deps, session, decodeURIComponent(confirm[1]), decodeURIComponent(confirm[2])));
    // Decision 0738: a goods receipt the customer shares, read only.
    const oneReceipt = url.pathname.match(/^\/api\/receipts\/([^/]+)\/([^/]+)$/);
    if (oneReceipt && request.method === "GET") return signedOutClears(await receipt(deps, session, decodeURIComponent(oneReceipt[1]), decodeURIComponent(oneReceipt[2])));
    // Decision 0721: replying to a customer about one invoice; 0740, about a goods receipt.
    const message = url.pathname.match(/^\/api\/(invoices|receipts|orders)\/([^/]+)\/([^/]+)\/messages$/);
    if (message && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      return signedOutClears(await reply(deps, session, decodeURIComponent(message[2]), decodeURIComponent(message[3]), body, message[1] as "invoices" | "receipts" | "orders"));
    }
    // Decision 0726: sending an invoice created in the network.
    if (url.pathname === "/api/submission-companies" && request.method === "GET") return signedOutClears(await submissionCompanies(deps, session));
    // Decision 0727: the Create form's seller, buyer and purchase orders.
    const customerAsk = url.pathname.match(/^\/api\/customers\/([^/]+)\/(invoice-parties|purchase-orders)$/);
    if (customerAsk && request.method === "GET") {
      return signedOutClears(await fromCustomer(deps, session, decodeURIComponent(customerAsk[1]), customerAsk[2] as "invoice-parties" | "purchase-orders", url.searchParams.get("orgUnitId") ?? ""));
    }
    const submission = url.pathname.match(/^\/api\/submissions\/([^/]+)$/);
    if (submission && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      return signedOutClears(await submit(deps, session, decodeURIComponent(submission[1]), body));
    }
    const end = url.pathname.match(/^\/api\/links\/([^/]+)\/end$/);
    if (end && request.method === "POST") {
      const res = await licence(`/portal/links/${encodeURIComponent(decodeURIComponent(end[1]))}/end`, { method: "POST", headers: { Authorization: `Bearer ${session}`, "Content-Type": "application/json" }, body: "{}" });
      return json(await res.json().catch(() => ({})), res.status);
    }
    return json({ error: "not_found" }, 404);
  },
};
