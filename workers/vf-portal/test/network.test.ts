import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import worker, { readSession, type Env } from "../src/index.js";
import { confirmByLink, confirmOrder, invoice, invoiceDocument, invoices, me, order, orderDocument, receipt, receiptDocument, reply, submissionCompanies, submit, type Deps } from "../src/network.js";

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
        { linkId: "pl-acme", environmentId: "acme-prod", customer: "Acme Ltd", supplier: "Lager Nord GmbH", companies: ["Acme UK Ltd"] },
        { linkId: "pl-globex", environmentId: "globex-prod", customer: "Globex plc", supplier: "Lager Nord GmbH", companies: ["Globex"] },
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

describe("goods receipts — decision 0738", () => {
  it("says whether any customer shares them, and opens one from the customer that link is for", async () => {
    const shared = () => Response.json({ invoices: [{ id: "gr1", documentType: "goods_receipt", invoiceNumber: "GR-1", receivedAt: "2026-10-06T09:00:00", status: "goods_received" }], receipts: true });
    const list = await invoices(deps({ "acme.example": shared, "globex.example": GLOBEX }), "good", new URLSearchParams());
    expect(list.body).toMatchObject({ receipts: true });
    expect((await invoices(deps({ "acme.example": ACME, "globex.example": GLOBEX }), "good", new URLSearchParams())).body).toMatchObject({ receipts: false });
    const seen: Seen[] = [];
    const one = await receipt(deps({ "acme.example": () => Response.json({ receipt: { id: "gr1", lines: [] } }) }, seen), "good", "pl-acme", "gr1");
    expect(one).toMatchObject({ status: 200, body: { id: "gr1", customer: "Acme Ltd", linkId: "pl-acme" } });
    expect(seen).toEqual([{ url: "https://acme.example/portal/receipts/gr1", auth: "Bearer tok-acme" }]);
    expect((await receipt(deps({}), "good", "pl-someone", "gr1")).status).toBe(404);
    expect((await receipt(deps({ "acme.example": () => new Response("{}", { status: 404 }) }), "good", "pl-acme", "nope")).status).toBe(404);
    expect((await receipt(deps({}), "stale", "pl-acme", "gr1")).status).toBe(401);
  });
});

describe("a goods receipt as a document — decision 0773", () => {
  it("passes the customer's PDF or CSV through, asking only the customer that link is for, and only for a format", async () => {
    const seen: Seen[] = [];
    const csv = () => new Response("receipt_number\nGR-1\n", { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="GR-1.csv"', "X-Other": "no" } });
    const res = await receiptDocument(deps({ "acme.example": csv }, seen), "good", "pl-acme", "gr1", "?format=csv&download=1&file=x");
    expect(res.status).toBe(200);
    expect([res.headers.get("Content-Type"), res.headers.get("Content-Disposition"), res.headers.get("X-Other"), res.headers.get("Cache-Control")]).toEqual(["text/csv; charset=utf-8", 'attachment; filename="GR-1.csv"', null, "private, no-store"]);
    expect(seen).toEqual([{ url: "https://acme.example/portal/receipts/gr1/document?format=csv&download=1", auth: "Bearer tok-acme" }]);
    expect((await receiptDocument(deps({ "acme.example": () => new Response("{}", { status: 404 }) }), "good", "pl-acme", "nope", "")).status).toBe(404);
    expect((await receiptDocument(deps({}), "good", "pl-someone", "gr1", "")).status).toBe(404);
    expect((await receiptDocument(deps({}), "stale", "pl-acme", "gr1", "")).status).toBe(401);
  });
});

describe("an order as a document — decision 0760", () => {
  it("passes the customer's PDF through as it comes, asking only the customer that link is for, and only for a format", async () => {
    const seen: Seen[] = [];
    const pdf = () => new Response(new Uint8Array([37, 80, 68, 70, 45]), { headers: { "Content-Type": "application/pdf", "Content-Disposition": 'inline; filename="PO-7.pdf"', "X-Other": "no" } });
    const res = await orderDocument(deps({ "acme.example": pdf }, seen), "good", "pl-acme", "po1", "?format=pdf&download=1&other=x");
    expect(res.status).toBe(200);
    expect([res.headers.get("Content-Type"), res.headers.get("Content-Disposition"), res.headers.get("X-Other"), res.headers.get("Cache-Control")]).toEqual(["application/pdf", 'inline; filename="PO-7.pdf"', null, "private, no-store"]);
    expect(new TextDecoder().decode(await res.arrayBuffer())).toBe("%PDF-");
    expect(seen).toEqual([{ url: "https://acme.example/portal/orders/po1/document?format=pdf&download=1", auth: "Bearer tok-acme" }]);
    expect((await orderDocument(deps({ "acme.example": () => new Response("{}", { status: 404 }) }), "good", "pl-acme", "po9", "")).status).toBe(404);
    expect((await orderDocument(deps({}), "good", "pl-someone", "po1", "")).status).toBe(404);
    expect((await orderDocument(deps({}), "stale", "pl-acme", "po1", "")).status).toBe(401);
  });
});

describe("confirming receipt of an order — decision 0762", () => {
  const TOKEN = "Abc_def-0123456789xyzABCDEFGHIJ";
  /** vf-licence says where the instance is, signed in or not; the instance confirms. */
  function linkDeps(answer: (body: Record<string, unknown>) => Response, seen: { url: string; body: Record<string, unknown> }[] = []): Deps {
    return {
      licence: async (path) => (path === "/portal/environments/acme-prod" ? Response.json({ instanceUrl: "https://acme.example/" }) : new Response("{}", { status: 404 })),
      instance: async (url, init) => {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        seen.push({ url, body });
        return answer(body);
      },
      timeoutMs: 200,
    };
  }

  it("by the email's link: finds the instance, which confirms, and says which order, from which customer", async () => {
    const seen: { url: string; body: Record<string, unknown> }[] = [];
    const d = linkDeps(() => Response.json({ confirmed: true, already: false, current: true, orderNumber: "PO-7", orderId: "po7", company: "Acme UK Ltd", kind: "order" }), seen);
    const r = await confirmByLink(d, { environmentId: "acme-prod", token: TOKEN }, "Mozilla/5.0");
    expect(r).toEqual({ status: 200, body: { confirmed: true, already: false, current: true, orderNumber: "PO-7", orderId: "po7", company: "Acme UK Ltd", kind: "order", environmentId: "acme-prod" } });
    expect(seen).toEqual([{ url: "https://acme.example/portal/order-confirm", body: { token: TOKEN, agent: "Mozilla/5.0" } }]);
  });

  it("a link the instance does not know, an unknown customer or a malformed link is not recognised; an instance that does not answer is said so", async () => {
    expect((await confirmByLink(linkDeps(() => Response.json({ error: "unknown_link" }, { status: 404 })), { environmentId: "acme-prod", token: TOKEN }, null)).status).toBe(404);
    const never: { url: string; body: Record<string, unknown> }[] = [];
    expect((await confirmByLink(linkDeps(() => Response.json({}), never), { environmentId: "globex-prod", token: TOKEN }, null)).status).toBe(404);
    expect((await confirmByLink(linkDeps(() => Response.json({}), never), { environmentId: "acme-prod", token: "short" }, null)).status).toBe(404);
    expect((await confirmByLink(linkDeps(() => Response.json({}), never), { environmentId: "../x", token: TOKEN }, null)).status).toBe(404);
    expect(never).toEqual([]);
    expect((await confirmByLink(linkDeps(() => Response.json({}, { status: 500 })), { environmentId: "acme-prod", token: TOKEN }, null)).status).toBe(502);
    const down: Deps = { ...linkDeps(() => Response.json({})), instance: async () => Promise.reject(new Error("down")) };
    expect((await confirmByLink(down, { environmentId: "acme-prod", token: TOKEN }, null)).body).toEqual({ error: "unreachable" });
  });

  it("in the network: to the customer that link is for, with its own token", async () => {
    const seen: Seen[] = [];
    const r = await confirmOrder(deps({ "acme.example": () => Response.json({ already: false, confirmation: { kind: "order", confirmed: { how: "network" } } }) }, seen), "good", "pl-acme", "po7");
    expect(r).toMatchObject({ status: 200, body: { already: false } });
    expect(seen).toEqual([{ url: "https://acme.example/portal/orders/po7/confirm", auth: "Bearer tok-acme" }]);
    expect((await confirmOrder(deps({}), "good", "pl-someone", "po7")).status).toBe(404);
    expect((await confirmOrder(deps({}), "stale", "pl-acme", "po7")).status).toBe(401);
  });

  it("the Worker takes the link without a session, but only from this site", async () => {
    const e = { ...(env as unknown as Env), LICENCE_SERVICE: { fetch: async () => new Response("{}", { status: 404 }) } as unknown as Fetcher } as Env;
    const post = (origin?: string) =>
      worker.fetch(new Request("https://network.example/api/order-confirm", { method: "POST", headers: { "Content-Type": "application/json", ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify({ environmentId: "nobody", token: TOKEN }) }), e);
    expect((await post()).status).toBe(404);
    expect((await post("https://evil.example")).status).toBe(403);
  });
});

describe("an invoice's own document — decision 0770", () => {
  it("passes the customer's file through with its policy, asking only the customer that link is for, and only for a file", async () => {
    const seen: Seen[] = [];
    const page = () => new Response("<html><body>Commercial invoice</body></html>", { headers: { "Content-Type": "text/html; charset=utf-8", "Content-Disposition": "inline", "Content-Security-Policy": "sandbox; default-src 'none'", "Set-Cookie": "x=1" } });
    const res = await invoiceDocument(deps({ "acme.example": page }, seen), "good", "pl-acme", "inv-1", "?file=original&download=1&other=x");
    expect(res.status).toBe(200);
    expect([res.headers.get("Content-Type"), res.headers.get("Content-Security-Policy"), res.headers.get("Set-Cookie"), res.headers.get("Cache-Control")]).toEqual(["text/html; charset=utf-8", "sandbox; default-src 'none'", null, "private, no-store"]);
    expect(seen).toEqual([{ url: "https://acme.example/portal/invoices/inv-1/document?file=original&download=1", auth: "Bearer tok-acme" }]);
    // A page that came without a policy is given one.
    const bare = await invoiceDocument(deps({ "acme.example": () => new Response("<p>x</p>", { headers: { "Content-Type": "text/html" } }) }), "good", "pl-acme", "inv-1", "");
    expect(bare.headers.get("Content-Security-Policy")).toContain("sandbox");
    expect((await invoiceDocument(deps({ "acme.example": () => new Response("{}", { status: 404 }) }), "good", "pl-acme", "inv-9", "")).status).toBe(404);
    expect((await invoiceDocument(deps({}), "good", "pl-someone", "inv-1", "")).status).toBe(404);
    expect((await invoiceDocument(deps({}), "stale", "pl-acme", "inv-1", "")).status).toBe(401);
  });
});

describe("the Worker", () => {
  const withLicence = (licence: (path: string, init: RequestInit) => Response | Promise<Response>) =>
    ({ ...(env as unknown as Env), LICENCE_SERVICE: { fetch: (u: string, init: RequestInit) => licence(new URL(u).pathname, init) } as unknown as Fetcher }) as Env;
  const call = (e: Env, path: string, init: RequestInit = {}) => worker.fetch(new Request(`https://network.example${path}`, init), e);

  it("serves the pages", async () => {
    for (const page of ["/", "/welcome.html", "/portal.js", "/welcome.js", "/shell.js", "/icons.js", "/create.js", "/view.js", "/order-view.js", "/order-document.js", "/invoice-document.js", "/confirm", "/confirm.js", "/bis3.js", "/portal.css", "/tokens.css", "/app.css", "/img/logo.png", "/img/logo-light.png", "/img/logo-mark.png"]) {
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

describe("replying — decision 0721", () => {
  it("posts to the customer that link is for, with its own token, the message alone", async () => {
    const posted: { url: string; auth: string | null; body: string }[] = [];
    const d = deps({});
    d.instance = async (url, init) => {
      posted.push({ url, auth: new Headers(init.headers).get("Authorization"), body: String(init.body) });
      return Response.json({ messages: [] }, { status: 201 });
    };
    const r = await reply(d, "good", "pl-globex", "g1", { body: "Corrected invoice to follow.", extra: "ignored" });
    expect(r.status).toBe(201);
    expect(posted).toEqual([{ url: "https://globex.example/portal/invoices/g1/messages", auth: "Bearer tok-globex", body: '{"body":"Corrected invoice to follow."}' }]);
  });

  it("about a goods receipt, to the receipt — decision 0740", async () => {
    const posted: string[] = [];
    const d = deps({});
    d.instance = async (url) => {
      posted.push(url);
      return Response.json({ messages: [] }, { status: 201 });
    };
    expect((await reply(d, "good", "pl-acme", "gr1", { body: "You recorded 8?" }, "receipts")).status).toBe(201);
    expect(posted).toEqual(["https://acme.example/portal/receipts/gr1/messages"]);
    // Decision 0752: and about a purchase order, to the order.
    expect((await reply(d, "good", "pl-acme", "po1", { body: "Delivery moves to the 22nd." }, "orders")).status).toBe(201);
    expect(posted.at(-1)).toBe("https://acme.example/portal/orders/po1/messages");
  });

  it("not for a link that is not theirs, and signed out for a stale session", async () => {
    expect((await reply(deps({}), "good", "pl-someone", "i1", { body: "x" })).status).toBe(404);
    expect((await reply(deps({}), "stale", "pl-acme", "i1", { body: "x" })).status).toBe(401);
  });
});

describe("sending an invoice — decision 0726", () => {
  it("lists, per customer, the companies that take invoices through the network, leaving out a customer that takes none", async () => {
    const r = await submissionCompanies(
      deps({
        "acme.example": () => Response.json({ companies: [{ id: "uk", name: "Acme UK Ltd" }] }),
        "globex.example": () => Response.json({ companies: [] }),
      }),
      "good"
    );
    expect(r.body).toEqual({ customers: [{ linkId: "pl-acme", customer: "Acme Ltd", supplier: "Lager Nord GmbH", companies: [{ id: "uk", name: "Acme UK Ltd" }] }] });
  });

  it("posts the invoice to the customer that link is for, with its own token, and only the invoice", async () => {
    const posted: { url: string; auth: string | null; body: string }[] = [];
    const d = deps({});
    d.instance = async (url, init) => {
      posted.push({ url, auth: new Headers(init.headers).get("Authorization"), body: String(init.body) });
      return Response.json({ message: "MSG-AAAA-BBBB-CCCC", invoiceId: "inv-9" }, { status: 202 });
    };
    const r = await submit(d, "good", "pl-acme", { orgUnitId: "uk", filename: "LN-500.xml", xml: "<Invoice/>", supplierId: "someone-else" });
    expect(r).toEqual({ status: 202, body: { message: "MSG-AAAA-BBBB-CCCC", invoiceId: "inv-9", customer: "Acme Ltd" } });
    expect(posted).toEqual([{ url: "https://acme.example/portal/submissions", auth: "Bearer tok-acme", body: '{"orgUnitId":"uk","filename":"LN-500.xml","xml":"<Invoice/>"}' }]);
    expect((await submit(deps({}), "good", "pl-someone", {})).status).toBe(404);
    expect((await submit(deps({}), "stale", "pl-acme", {})).status).toBe(401);
  });
});

describe("readable in Night too", () => {
  /**
   * Dan, against a screenshot: the supplier's own message could not be
   * read in Night. `--severity-*-bg` stays light in both themes, so a rule
   * using one must set its own `--severity-*-text` colour too.
   */
  it("pairs every fixed severity background with its own text colour", async () => {
    const css = (await import("../public/portal.css?raw")).default as string;
    const unpaired = [...css.matchAll(/([^{}]+)\{([^}]*)\}/g)]
      .filter(([, , body]) => /var\(--severity-(\w+)-bg\)/.test(body))
      .filter(([, , body]) => !/color:\s*var\(--severity-\w+-text\)/.test(body))
      .map(([, selector]) => selector.trim());
    expect(unpaired).toEqual([]);
  });
});

describe("the top bar and messages, as the application's (decision 0723)", () => {
  it("keeps the messages in Day's light colours in Night too, as the application's Timeline / Chat", async () => {
    const css = (await import("../public/portal.css?raw")).default as string;
    const msg = /\.msg \{\s*--surface-2[^}]*\}/.exec(css)?.[0] ?? "";
    expect(msg).toContain("--surface-2: #ffffff;");
    expect(msg).toContain("--text-primary: #121a26;");
  });

  it("draws the top bar's controls in shell.js: Night / Day, Language, Help and Sign out", async () => {
    const shell = (await import("../public/shell.js?raw")).default as string;
    for (const key of ["network.mood.", "network.help", "network.signout"]) expect(shell).toContain(key);
    expect(shell).toContain("LANGUAGES");
  });
});

/**
 * **The application's look, kept the application's — decision 0725.** The
 * network uses the app's own stylesheet, tokens and icons, copied into its
 * public folder (a Worker serves only its own). A copy that drifts from the
 * app's is a network that no longer looks like it: these fail until the copy
 * is refreshed (`cp workers/vf-ui/public/{app.css,tokens.css,icons.js} workers/vf-portal/public/`).
 */
describe("the application's look", () => {
  it("app.css, tokens.css and icons.js are the same as the app's", async () => {
    const pairs: [string, string, string][] = [
      ["app.css", (await import("../public/app.css?raw")).default, (await import("../../vf-ui/public/app.css?raw")).default],
      ["tokens.css", (await import("../public/tokens.css?raw")).default, (await import("../../vf-ui/public/tokens.css?raw")).default],
      ["icons.js", (await import("../public/icons.js?raw")).default, (await import("../../vf-ui/public/icons.js?raw")).default],
    ];
    for (const [file, ours, app] of pairs) {
      expect(ours.length, file).toBeGreaterThan(100);
      expect(ours === app, `${file} differs from the app's: copy it again`).toBe(true);
    }
  });

  it("signs in, and accepts an invitation, on the app's sign-in page, and fills the window once signed in", async () => {
    const index = (await import("../public/index.html?raw")).default as string;
    const welcome = (await import("../public/welcome.html?raw")).default as string;
    for (const page of [index, welcome]) {
      expect(page).toContain('href="/app.css"');
      expect(page).toContain('<div class="mark"></div>');
    }
    expect(index).toContain('<main id="signin-view" hidden>');
    expect(index).toContain('<main id="shell" hidden></main>');
    const portal = (await import("../public/portal.js?raw")).default as string;
    expect(portal).toContain('document.body.classList.add("working")');
  });
});

/**
 * **Every word the network's pages ask for exists — decision 0727**, as
 * vf-licence's string coverage does for the app: a key nothing defines is
 * a label nobody can read. Literal `t("network.…")` keys in the pages,
 * and the rule keys the invoice builder names.
 */
describe("the network's words", () => {
  it("are all defined, in English and German", async () => {
    const migrations = import.meta.glob("../../vf-licence/migrations/*.sql", { query: "?raw", import: "default", eager: true }) as Record<string, string>;
    const defined = { en: new Set<string>(), de: new Set<string>() };
    for (const sql of Object.values(migrations)) {
      for (const m of sql.matchAll(/\('(network\.[^']+)',\s*'(en|de)',/g)) defined[m[2] as "en" | "de"].add(m[1]);
    }
    const pages = [
      (await import("../public/portal.js?raw")).default,
      (await import("../public/shell.js?raw")).default,
      (await import("../public/create.js?raw")).default,
      (await import("../public/view.js?raw")).default,
      (await import("../public/receipt-view.js?raw")).default,
      (await import("../public/order-view.js?raw")).default,
      (await import("../public/order-document.js?raw")).default,
      (await import("../public/welcome.js?raw")).default,
      (await import("../public/confirm.js?raw")).default,
      (await import("../public/invoice-document.js?raw")).default,
    ] as string[];
    const used = new Set<string>();
    for (const src of pages) for (const m of src.matchAll(/t\("(network\.[a-z0-9._]+)"/g)) used.add(m[1]);
    // Decision 0736: the Documents columns' labels, and the pager's.
    for (const src of pages) for (const m of src.matchAll(/(?:label: |nav\("[a-z]+", )"(network\.[a-z0-9._]+)"/g)) used.add(m[1]);
    const bis3 = (await import("../public/bis3.js?raw")).default as string;
    for (const m of bis3.matchAll(/"(network\.bis3\.[a-z]+)"/g)) used.add(m[1]);
    // Built from a value: each unit, VAT category and send failure the form can name.
    for (const u of ["C62", "H87", "HUR", "DAY", "KGM", "MTR", "LTR", "SET"]) used.add(`network.unit.${u}`);
    for (const c of ["S", "Z", "E", "AE"]) {
      used.add(`network.vat.${c}`);
      used.add(`network.vatline.${c}`);
    }
    for (const r of ["not_covered", "not_accepting", "not_bis3", "unreadable", "too_large", "other", "credit_not_allowed", "unknown_invoice", "already_credited"]) used.add(`network.create.failed.${r}`);
    // Decision 0732: each credit note reason, each document type, and Credited.
    for (const r of ["duplicate", "price", "returned", "cancelled", "other"]) used.add(`network.credit.reason.${r}`);
    for (const k of ["invoice", "credit_note", "goods_receipt", "purchase_order"]) used.add(`network.types.${k}`);
    // Decision 0738: a goods receipt's statuses.
    // Decision 0751: and a purchase order's.
    for (const s of ["credited", "goods_received", "goods_returned", "goods_checking", "order_open", "order_part_received", "order_received", "order_part_invoiced", "order_invoiced", "order_on_hold", "order_closed"]) {
      used.add(`network.status.${s}`);
      used.add(`network.help.status.${s}`);
    }
    // Decision 0770: what each of an invoice's files is.
    for (const k of ["generated_rendering", "pdf", "xml", "embedded_xml", "other"]) used.add(`network.invoice.file.${k}`);
    // Decision 0762: confirming receipt, said of the version confirmed.
    for (const k of ["order", "change", "cancellation"]) {
      used.add(`network.confirm.done.${k}`);
      used.add(`network.order.confirmednote.${k}`);
      used.add(`network.order.toconfirm.${k}`);
    }
    used.add("network.create.accountnote");
    used.add("network.create.noaccount");
    expect(used.size).toBeGreaterThan(80);
    expect([...used].filter((k) => !defined.en.has(k))).toEqual([]);
    expect([...used].filter((k) => !defined.de.has(k))).toEqual([]);
  });
});

describe("purchase orders — decision 0751", () => {
  it("says whether any customer shares orders, and opens one from the customer its link is for", async () => {
    const shared = () => Response.json({ invoices: [{ id: "po1", documentType: "purchase_order", invoiceNumber: "PO-1", receivedAt: "2026-10-06T09:00:00", status: "order_open" }], orders: true });
    const list = await invoices(deps({ "acme.example": shared, "globex.example": GLOBEX }), "good", new URLSearchParams());
    expect(list.body).toMatchObject({ orders: true });
    expect((await invoices(deps({ "acme.example": ACME, "globex.example": GLOBEX }), "good", new URLSearchParams())).body).toMatchObject({ orders: false });
    const seen: { url: string; auth: string | null }[] = [];
    const one = await order(deps({ "acme.example": () => Response.json({ order: { id: "po1", lines: [] } }) }, seen), "good", "pl-acme", "po1");
    expect(one).toMatchObject({ status: 200, body: { id: "po1", linkId: "pl-acme" } });
    expect(seen).toEqual([{ url: "https://acme.example/portal/orders/po1", auth: "Bearer tok-acme" }]);
    expect((await order(deps({}), "good", "pl-someone", "po1")).status).toBe(404);
    expect((await order(deps({}), "stale", "pl-acme", "po1")).status).toBe(401);
  });
});
