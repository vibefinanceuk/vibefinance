import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import worker, { readSession, type Env } from "../src/index.js";
import { invoice, invoices, me, type Deps } from "../src/network.js";

/**
 * **The supplier network — decision 0717.** vf-licence and the customers'
 * instances are faked; their own sides are 0713 and 0714.
 */

const LINKS = {
  email: "jo@lager-nord.example",
  links: [
    { id: "pl-acme", customerName: "Acme Ltd", environmentId: "acme-prod", instanceUrl: "https://acme.example", supplierName: "Lager Nord GmbH", orgUnits: [{ id: "uk", name: "Acme UK Ltd" }] },
    { id: "pl-globex", customerName: "Globex plc", environmentId: "globex-prod", instanceUrl: "https://globex.example/", supplierName: "Lager Nord GmbH", orgUnits: [{ id: "g", name: "Globex" }] },
  ],
};
const ACCESS = { access: [{ linkId: "pl-acme", environmentId: "acme-prod", instanceUrl: "https://acme.example", token: "tok-acme" }, { linkId: "pl-globex", environmentId: "globex-prod", instanceUrl: "https://globex.example/", token: "tok-globex" }] };

type Seen = { url: string; auth: string | null };
function deps(instances: Record<string, (url: string) => Response | Promise<Response>>, seen: Seen[] = [], session = "good"): Deps {
  return {
    licence: async (path, init) => {
      const auth = new Headers(init?.headers).get("Authorization");
      if (auth !== `Bearer ${session}`) return new Response("{}", { status: 401 });
      if (path === "/portal/links") return Response.json(LINKS);
      if (path === "/portal/access") return Response.json(ACCESS);
      return new Response("{}", { status: 404 });
    },
    instance: async (url, init) => {
      seen.push({ url, auth: new Headers(init.headers).get("Authorization") });
      const host = new URL(url).host;
      return instances[host] ? instances[host](url) : new Response("{}", { status: 404 });
    },
    timeoutMs: 200,
  };
}

const ACME = () => Response.json({ invoices: [{ id: "i1", invoiceNumber: "LN-1", receivedAt: "2026-10-02 10:00:00", status: "approved" }] });
const GLOBEX = () => Response.json({ invoices: [{ id: "g1", invoiceNumber: "LN-9", receivedAt: "2026-10-05 10:00:00", status: "received" }] });

describe("the list across customers", () => {
  it("asks each customer with its own token, and merges newest first, each labelled", async () => {
    const seen: Seen[] = [];
    const r = await invoices(deps({ "acme.example": ACME, "globex.example": GLOBEX }, seen), "good", new URLSearchParams("q=LN&status=approved&other=x"));
    expect(r.status).toBe(200);
    expect((r.body as { invoices: { id: string; customer: string; linkId: string }[] }).invoices.map((i) => [i.id, i.customer, i.linkId])).toEqual([
      ["g1", "Globex plc", "pl-globex"],
      ["i1", "Acme Ltd", "pl-acme"],
    ]);
    expect(seen).toEqual([
      { url: "https://acme.example/portal/invoices?status=approved&q=LN", auth: "Bearer tok-acme" },
      { url: "https://globex.example/portal/invoices?status=approved&q=LN", auth: "Bearer tok-globex" },
    ]);
  });

  it("names a customer that does not answer, refuses, or is too slow, and still shows the rest", async () => {
    const slow = () => new Promise<Response>((resolve) => setTimeout(() => resolve(GLOBEX()), 1000));
    const r = await invoices(deps({ "acme.example": ACME, "globex.example": slow }), "good", new URLSearchParams());
    expect(r.body).toMatchObject({ invoices: [expect.objectContaining({ id: "i1" })], unavailable: [{ customer: "Globex plc", reason: "unreachable" }] });
    const refused = await invoices(deps({ "acme.example": () => new Response("{}", { status: 403 }), "globex.example": GLOBEX }), "good", new URLSearchParams());
    expect((refused.body as { unavailable: unknown[] }).unavailable).toEqual([{ customer: "Acme Ltd", reason: "not_licensed" }]);
  });

  it("a session vf-licence no longer accepts is signed out", async () => {
    expect((await invoices(deps({}), "stale", new URLSearchParams())).status).toBe(401);
    expect((await me(deps({}), "stale")).status).toBe(401);
  });

  it("says who is signed in and their customers, with companies", async () => {
    expect((await me(deps({}), "good")).body).toEqual({
      email: "jo@lager-nord.example",
      customers: [
        { linkId: "pl-acme", customer: "Acme Ltd", supplier: "Lager Nord GmbH", companies: ["Acme UK Ltd"] },
        { linkId: "pl-globex", customer: "Globex plc", supplier: "Lager Nord GmbH", companies: ["Globex"] },
      ],
    });
  });
});

describe("one invoice", () => {
  it("asks only the customer that link is for", async () => {
    const seen: Seen[] = [];
    const r = await invoice(deps({ "acme.example": () => Response.json({ invoice: { id: "i1", lines: [] } }) }, seen), "good", "pl-acme", "i1");
    expect(r).toMatchObject({ status: 200, body: { id: "i1", customer: "Acme Ltd", linkId: "pl-acme" } });
    expect(seen).toEqual([{ url: "https://acme.example/portal/invoices/i1", auth: "Bearer tok-acme" }]);
  });

  it("a link that is not theirs, or an invoice the customer does not show them, is not found", async () => {
    expect((await invoice(deps({}), "good", "pl-someone", "i1")).status).toBe(404);
    expect((await invoice(deps({ "acme.example": () => new Response("{}", { status: 404 }) }), "good", "pl-acme", "nope")).status).toBe(404);
  });
});

describe("the Worker", () => {
  const withLicence = (licence: (path: string, init: RequestInit) => Response | Promise<Response>) =>
    ({ ...(env as unknown as Env), LICENCE_SERVICE: { fetch: (u: string, init: RequestInit) => licence(new URL(u).pathname, init) } as unknown as Fetcher }) as Env;
  const call = (e: Env, path: string, init: RequestInit = {}) => worker.fetch(new Request(`https://network.example${path}`, init), e);

  it("serves the pages", async () => {
    for (const page of ["/", "/welcome.html", "/portal.js", "/welcome.js", "/portal.css", "/tokens.css"]) {
      expect((await SELF.fetch(`https://network.example${page}`)).status, page).toBe(200);
    }
  });

  it("refuses the API without a session, and a POST from another site", async () => {
    expect((await SELF.fetch("https://network.example/api/me")).status).toBe(401);
    const foreign = await SELF.fetch("https://network.example/api/sign-in", { method: "POST", headers: { Origin: "https://evil.example", "Content-Type": "application/json" }, body: "{}" });
    expect(foreign.status).toBe(403);
  });

  it("signing in sets an HttpOnly, Secure, SameSite=Strict cookie and never shows the token to the page", async () => {
    const e = withLicence((path) =>
      path === "/portal/login" ? Response.json({ token: "sess-1", expiresAt: new Date(Date.now() + 3600e3).toISOString() }) : new Response("{}", { status: 404 })
    );
    const res = await call(e, "/api/sign-in", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: "jo@x.example", password: "p" }) });
    expect(res.status).toBe(200);
    expect(await res.text()).not.toContain("sess-1");
    const cookie = res.headers.get("Set-Cookie")!;
    expect(cookie).toMatch(/^vfn_session=sess-1; Path=\/; HttpOnly; Secure; SameSite=Strict; Max-Age=\d+$/);
    expect(readSession(new Request("https://n/", { headers: { Cookie: "other=1; vfn_session=sess-1" } }))).toBe("sess-1");
  });

  it("a refused sign-in passes the refusal on, with no cookie", async () => {
    const e = withLicence(() => Response.json({ error: "email or password is not correct" }, { status: 401 }));
    const res = await call(e, "/api/sign-in", { method: "POST", body: "{}" });
    expect(res.status).toBe(401);
    expect(res.headers.get("Set-Cookie")).toBeNull();
  });

  it("accepting an invitation signs the person in with the password they gave", async () => {
    const asked: string[] = [];
    const e = withLicence(async (path, init) => {
      asked.push(`${path} ${init.body}`);
      if (path === "/portal/invitations/accept") return Response.json({ email: "jo@x.example", linkId: "pl-1" });
      if (path === "/portal/login") return Response.json({ token: "sess-2", expiresAt: new Date(Date.now() + 3600e3).toISOString() });
      return new Response("{}", { status: 404 });
    });
    const res = await call(e, "/api/invitation/accept", { method: "POST", body: JSON.stringify({ token: "t", code: "123456", password: "a long passphrase" }) });
    expect(res.headers.get("Set-Cookie")).toContain("vfn_session=sess-2");
    expect(asked[1]).toBe('/portal/login {"email":"jo@x.example","password":"a long passphrase"}');
  });

  it("signing out clears the cookie; a session vf-licence refuses is cleared too", async () => {
    const out = await SELF.fetch("https://network.example/api/sign-out", { method: "POST" });
    expect(out.headers.get("Set-Cookie")).toContain("vfn_session=; ");
    const e = withLicence(() => new Response("{}", { status: 401 }));
    const res = await call(e, "/api/me", { headers: { Cookie: "vfn_session=old" } });
    expect(res.status).toBe(401);
    expect(res.headers.get("Set-Cookie")).toContain("Max-Age=0");
  });
});
