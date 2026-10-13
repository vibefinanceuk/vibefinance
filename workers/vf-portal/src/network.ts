/**
 * **The supplier network's backend — decision 0717.** Step 4 of
 * docs/design/supplier-portal.md.
 *
 * Holds nothing. The supplier's portal session (0713) lives in an
 * `HttpOnly` cookie that script cannot read; each request becomes a call
 * to vf-licence (who they are, which customers) and then, live and in
 * parallel, to each linked customer's own instance (0714) with a
 * five-minute token that only that instance accepts.
 */

export interface Deps {
  /** vf-licence, through its Service Binding. */
  licence: (path: string, init?: RequestInit) => Promise<Response>;
  /** A customer's instance, at its own address. */
  instance: (url: string, init: RequestInit) => Promise<Response>;
  /** How long to wait for one customer before saying it is not available. */
  timeoutMs?: number;
}

export interface Result {
  status: number;
  body: unknown;
}

interface Link {
  id: string;
  customerName: string;
  environmentId: string;
  instanceUrl: string;
  supplierName: string;
  orgUnits: { id: string; name: string }[];
}

interface Access {
  linkId: string;
  environmentId: string;
  instanceUrl: string;
  token: string;
}

async function asJson(res: Response): Promise<Record<string, unknown>> {
  return ((await res.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

/** The links and an access token for each, side by side. Null when the session is no longer good. */
async function linksWithAccess(deps: Deps, session: string): Promise<{ link: Link; access: Access | undefined }[] | null> {
  const [linksRes, accessRes] = await Promise.all([
    deps.licence("/portal/links", { headers: bearer(session) }),
    deps.licence("/portal/access", { method: "POST", headers: { ...bearer(session), "Content-Type": "application/json" }, body: "{}" }),
  ]);
  if (linksRes.status === 401 || accessRes.status === 401) return null;
  const links = ((await asJson(linksRes)).links ?? []) as Link[];
  const access = ((await asJson(accessRes)).access ?? []) as Access[];
  return links.map((link) => ({ link, access: access.find((a) => a.linkId === link.id) }));
}

/** One customer's answer, or why there is none. Never longer than the timeout. */
async function ask(deps: Deps, access: Access, path: string): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; reason: string; status?: number }> {
  const ms = deps.timeoutMs ?? 8000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // Aborted after the wait, and given up on then whether or not the abort is heeded.
    const res = await Promise.race([
      deps.instance(`${access.instanceUrl.replace(/\/+$/, "")}${path}`, { headers: bearer(access.token), signal: AbortSignal.timeout(ms) }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("timeout")), ms);
      }),
    ]);
    if (!res.ok) return { ok: false, reason: res.status === 403 ? "not_licensed" : "refused", status: res.status };
    return { ok: true, body: await asJson(res) };
  } catch {
    return { ok: false, reason: "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * `GET /api/me` — who is signed in and the customers they see, with the
 * companies each covers.
 */
export async function me(deps: Deps, session: string): Promise<Result> {
  const res = await deps.licence("/portal/links", { headers: bearer(session) });
  if (res.status === 401) return { status: 401, body: { error: "signed_out" } };
  const body = await asJson(res);
  return {
    status: 200,
    body: {
      email: body.email,
      // Decision 0762: which instance each is, for a confirm link to open its order.
      customers: ((body.links ?? []) as Link[]).map((l) => ({ linkId: l.id, environmentId: l.environmentId, customer: l.customerName, supplier: l.supplierName, companies: l.orgUnits.map((u) => u.name) })),
    },
  };
}

/**
 * `GET /api/invoices?status=&q=` — every linked customer asked at once;
 * the answers merged, newest first, each labelled with its customer. A
 * customer that does not answer is named in `unavailable`, never
 * silently left out.
 */
export async function invoices(deps: Deps, session: string, params: URLSearchParams): Promise<Result> {
  const pairs = await linksWithAccess(deps, session);
  if (!pairs) return { status: 401, body: { error: "signed_out" } };
  const query = new URLSearchParams();
  for (const k of ["status", "q"]) {
    const v = params.get(k);
    if (v) query.set(k, v.slice(0, 100));
  }
  const suffix = query.toString() ? `?${query}` : "";
  const answers = await Promise.all(
    pairs.map(async ({ link, access }) => ({ link, answer: access ? await ask(deps, access, `/portal/invoices${suffix}`) : ({ ok: false, reason: "no_access" } as const) }))
  );
  const all: Record<string, unknown>[] = [];
  const unavailable: { customer: string; reason: string }[] = [];
  // Decision 0736: a customer with more than it sent (its newest 500).
  const capped: string[] = [];
  // Decision 0738: whether any customer shares goods receipts with this supplier.
  let receipts = false;
  // Decision 0751: and purchase orders.
  let orders = false;
  for (const { link, answer } of answers) {
    if (!answer.ok) {
      unavailable.push({ customer: link.customerName, reason: answer.reason });
      continue;
    }
    if (answer.body.more === true) capped.push(link.customerName);
    if (answer.body.receipts === true) receipts = true;
    if (answer.body.orders === true) orders = true;
    for (const inv of (answer.body.invoices ?? []) as Record<string, unknown>[]) {
      all.push({ ...inv, linkId: link.id, customer: link.customerName, supplier: link.supplierName });
    }
  }
  all.sort((a, b) => String(b.receivedAt ?? "").localeCompare(String(a.receivedAt ?? "")));
  return { status: 200, body: { invoices: all, unavailable, capped, receipts, orders } };
}

/** `GET /api/invoices/:linkId/:invoiceId` — one invoice, from the customer that link is for. */
export async function invoice(deps: Deps, session: string, linkId: string, invoiceId: string): Promise<Result> {
  const pairs = await linksWithAccess(deps, session);
  if (!pairs) return { status: 401, body: { error: "signed_out" } };
  const pair = pairs.find((p) => p.link.id === linkId);
  if (!pair?.access) return { status: 404, body: { error: "not_found" } };
  const answer = await ask(deps, pair.access, `/portal/invoices/${encodeURIComponent(invoiceId)}`);
  if (!answer.ok) return { status: answer.status === 404 ? 404 : 502, body: { error: answer.status === 404 ? "not_found" : answer.reason, customer: pair.link.customerName } };
  return { status: 200, body: { ...(answer.body.invoice as Record<string, unknown>), linkId, customer: pair.link.customerName, supplier: pair.link.supplierName } };
}

/** `GET /api/receipts/:linkId/:receiptId` — decision 0738: a goods receipt the customer that link is for shares, read only. */
export async function receipt(deps: Deps, session: string, linkId: string, receiptId: string): Promise<Result> {
  const pairs = await linksWithAccess(deps, session);
  if (!pairs) return { status: 401, body: { error: "signed_out" } };
  const pair = pairs.find((p) => p.link.id === linkId);
  if (!pair?.access) return { status: 404, body: { error: "not_found" } };
  const answer = await ask(deps, pair.access, `/portal/receipts/${encodeURIComponent(receiptId)}`);
  if (!answer.ok) return { status: answer.status === 404 ? 404 : 502, body: { error: answer.status === 404 ? "not_found" : answer.reason, customer: pair.link.customerName } };
  return { status: 200, body: { ...(answer.body.receipt as Record<string, unknown>), linkId, customer: pair.link.customerName, supplier: pair.link.supplierName } };
}

/** `GET /api/orders/:linkId/:orderId` — a purchase order the customer shares, read only (decision 0751). */
export async function order(deps: Deps, session: string, linkId: string, orderId: string): Promise<Result> {
  const pairs = await linksWithAccess(deps, session);
  if (!pairs) return { status: 401, body: { error: "signed_out" } };
  const pair = pairs.find((p) => p.link.id === linkId);
  if (!pair?.access) return { status: 404, body: { error: "not_found" } };
  const answer = await ask(deps, pair.access, `/portal/orders/${encodeURIComponent(orderId)}`);
  if (!answer.ok) return { status: answer.status === 404 ? 404 : 502, body: { error: answer.status === 404 ? "not_found" : answer.reason, customer: pair.link.customerName } };
  return { status: 200, body: { ...(answer.body.order as Record<string, unknown>), linkId, customer: pair.link.customerName, supplier: pair.link.supplierName } };
}

/**
 * `GET /api/orders/:linkId/:orderId/document?format=` — decision 0760: a
 * shared order as the customer's instance makes it (PDF, UBL or CSV),
 * passed through as it comes. A Response, not a Result: it is a file.
 */
export async function orderDocument(deps: Deps, session: string, linkId: string, orderId: string, search: string): Promise<Response> {
  const pairs = await linksWithAccess(deps, session);
  const jsonResponse = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  if (!pairs) return jsonResponse(401, { error: "signed_out" });
  const pair = pairs.find((p) => p.link.id === linkId);
  if (!pair?.access) return jsonResponse(404, { error: "not_found" });
  const params = new URLSearchParams(search);
  const query = new URLSearchParams();
  for (const k of ["format", "download"]) if (params.get(k)) query.set(k, params.get(k)!);
  try {
    const res = await deps.instance(`${pair.access.instanceUrl.replace(/\/+$/, "")}/portal/orders/${encodeURIComponent(orderId)}/document?${query}`, {
      headers: bearer(pair.access.token),
      signal: AbortSignal.timeout(deps.timeoutMs ?? 15000),
    });
    if (!res.ok) return jsonResponse(res.status === 404 ? 404 : 502, { error: res.status === 404 ? "not_found" : "refused" });
    const headers = new Headers({ "Cache-Control": "private, no-store" });
    for (const h of ["Content-Type", "Content-Disposition"]) if (res.headers.get(h)) headers.set(h, res.headers.get(h)!);
    return new Response(res.body, { status: 200, headers });
  } catch {
    return jsonResponse(502, { error: "unreachable" });
  }
}

/**
 * `GET /api/receipts/:linkId/:receiptId/document?format=` — decision 0773:
 * a shared goods receipt as the customer's instance makes it (PDF or CSV),
 * passed through as it comes. A Response, not a Result: it is a file.
 */
export async function receiptDocument(deps: Deps, session: string, linkId: string, receiptId: string, search: string): Promise<Response> {
  const pairs = await linksWithAccess(deps, session);
  const jsonResponse = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  if (!pairs) return jsonResponse(401, { error: "signed_out" });
  const pair = pairs.find((p) => p.link.id === linkId);
  if (!pair?.access) return jsonResponse(404, { error: "not_found" });
  const params = new URLSearchParams(search);
  const query = new URLSearchParams();
  for (const k of ["format", "download"]) if (params.get(k)) query.set(k, params.get(k)!);
  try {
    const res = await deps.instance(`${pair.access.instanceUrl.replace(/\/+$/, "")}/portal/receipts/${encodeURIComponent(receiptId)}/document?${query}`, {
      headers: bearer(pair.access.token),
      signal: AbortSignal.timeout(deps.timeoutMs ?? 15000),
    });
    if (!res.ok) return jsonResponse(res.status === 404 ? 404 : 502, { error: res.status === 404 ? "not_found" : "refused" });
    const headers = new Headers({ "Cache-Control": "private, no-store" });
    for (const h of ["Content-Type", "Content-Disposition"]) if (res.headers.get(h)) headers.set(h, res.headers.get(h)!);
    return new Response(res.body, { status: 200, headers });
  } catch {
    return jsonResponse(502, { error: "unreachable" });
  }
}

/**
 * `POST /api/invoices/:linkId/:invoiceId/messages` — the supplier writes, to the customer that link is for (0721);
 * `POST /api/receipts/:linkId/:receiptId/messages` the same about a goods receipt (decision 0740),
 * and `POST /api/orders/:linkId/:orderId/messages` about a purchase order (decision 0752).
 */
export async function reply(deps: Deps, session: string, linkId: string, invoiceId: string, body: unknown, about: "invoices" | "receipts" | "orders" = "invoices"): Promise<Result> {
  const pairs = await linksWithAccess(deps, session);
  if (!pairs) return { status: 401, body: { error: "signed_out" } };
  const pair = pairs.find((p) => p.link.id === linkId);
  if (!pair?.access) return { status: 404, body: { error: "not_found" } };
  try {
    const res = await deps.instance(`${pair.access.instanceUrl.replace(/\/+$/, "")}/portal/${about}/${encodeURIComponent(invoiceId)}/messages`, {
      method: "POST",
      headers: { ...bearer(pair.access.token), "Content-Type": "application/json" },
      body: JSON.stringify({ body: typeof (body as { body?: unknown })?.body === "string" ? (body as { body: string }).body : "" }),
      signal: AbortSignal.timeout(deps.timeoutMs ?? 8000),
    });
    return { status: res.status, body: await asJson(res) };
  } catch {
    return { status: 502, body: { error: "unreachable", customer: pair.link.customerName } };
  }
}

/**
 * `GET /api/submission-companies` — decision 0726: for each customer, the
 * companies this person may send an invoice to (those their invitation
 * names that the customer's Supplier network source accepts). A customer
 * that takes none, or does not answer, is left out.
 */
export async function submissionCompanies(deps: Deps, session: string): Promise<Result> {
  const pairs = await linksWithAccess(deps, session);
  if (!pairs) return { status: 401, body: { error: "signed_out" } };
  const answers = await Promise.all(
    pairs.map(async ({ link, access }) => ({ link, answer: access ? await ask(deps, access, "/portal/submission-companies") : ({ ok: false, reason: "no_access" } as const) }))
  );
  const customers = answers
    .filter((a) => a.answer.ok && ((a.answer.body.companies ?? []) as unknown[]).length > 0)
    .map(({ link, answer }) => ({ linkId: link.id, customer: link.customerName, supplier: link.supplierName, companies: (answer as { body: { companies: { id: string; name: string }[] } }).body.companies }));
  return { status: 200, body: { customers } };
}

/** `POST /api/submissions/:linkId` `{ orgUnitId, filename, xml }` — decision 0726: one invoice, to the customer that link is for. */
export async function submit(deps: Deps, session: string, linkId: string, body: unknown): Promise<Result> {
  const pairs = await linksWithAccess(deps, session);
  if (!pairs) return { status: 401, body: { error: "signed_out" } };
  const pair = pairs.find((p) => p.link.id === linkId);
  if (!pair?.access) return { status: 404, body: { error: "not_found" } };
  const b = (body ?? {}) as Record<string, unknown>;
  try {
    const res = await deps.instance(`${pair.access.instanceUrl.replace(/\/+$/, "")}/portal/submissions`, {
      method: "POST",
      headers: { ...bearer(pair.access.token), "Content-Type": "application/json" },
      body: JSON.stringify({ orgUnitId: b.orgUnitId, filename: b.filename, xml: b.xml }),
      signal: AbortSignal.timeout(Math.max(deps.timeoutMs ?? 8000, 30000)),
    });
    return { status: res.status, body: { ...(await asJson(res)), customer: pair.link.customerName } };
  } catch {
    return { status: 502, body: { error: "unreachable", customer: pair.link.customerName } };
  }
}

/**
 * `GET /api/customers/:linkId/invoice-parties|purchase-orders?orgUnitId=` —
 * decision 0727: what the Create form fills in (the seller and buyer as
 * that customer has them) and its purchase orders for From a PO, asked of
 * the customer that link is for.
 */
export async function fromCustomer(deps: Deps, session: string, linkId: string, what: "invoice-parties" | "purchase-orders", orgUnitId: string): Promise<Result> {
  const pairs = await linksWithAccess(deps, session);
  if (!pairs) return { status: 401, body: { error: "signed_out" } };
  const pair = pairs.find((p) => p.link.id === linkId);
  if (!pair?.access) return { status: 404, body: { error: "not_found" } };
  const answer = await ask(deps, pair.access, `/portal/${what}?orgUnitId=${encodeURIComponent(orgUnitId)}`);
  if (!answer.ok) return { status: answer.status === 403 ? 403 : 502, body: { error: answer.reason, customer: pair.link.customerName } };
  return { status: 200, body: answer.body };
}

/**
 * `POST /api/order-confirm` `{ environmentId, token }` — decision 0762:
 * the email's *Confirm receipt* link, posted by the confirm page once it
 * has loaded in a browser. No sign-in: the link is the proof. vf-licence
 * says where that customer's instance is; the instance checks the link
 * and confirms. The answer names the order, for the page to open it.
 */
export async function confirmByLink(deps: Deps, body: unknown, agent: string | null): Promise<Result> {
  const b = (body ?? {}) as { environmentId?: unknown; token?: unknown };
  const environmentId = typeof b.environmentId === "string" ? b.environmentId : "";
  const token = typeof b.token === "string" ? b.token : "";
  if (!/^[\w-]{1,100}$/.test(environmentId) || !/^[A-Za-z0-9_-]{20,100}$/.test(token)) return { status: 404, body: { error: "unknown_link" } };
  const where = await deps.licence(`/portal/environments/${encodeURIComponent(environmentId)}`);
  if (where.status === 404) return { status: 404, body: { error: "unknown_link" } };
  const instanceUrl = (await asJson(where)).instanceUrl;
  if (!where.ok || typeof instanceUrl !== "string") return { status: 502, body: { error: "unreachable" } };
  try {
    const res = await deps.instance(`${instanceUrl.replace(/\/+$/, "")}/portal/order-confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, agent }),
      signal: AbortSignal.timeout(deps.timeoutMs ?? 8000),
    });
    const answer = await asJson(res);
    if (res.status === 404) return { status: 404, body: { error: "unknown_link" } };
    if (!res.ok) return { status: 502, body: { error: "refused" } };
    return { status: 200, body: { ...answer, environmentId } };
  } catch {
    return { status: 502, body: { error: "unreachable" } };
  }
}

/**
 * `POST /api/orders/:linkId/:orderId/confirm` — decision 0762: the
 * supplier confirms on the order in the supplier network, for a supplier
 * who never saw the email.
 */
export async function confirmOrder(deps: Deps, session: string, linkId: string, orderId: string): Promise<Result> {
  const pairs = await linksWithAccess(deps, session);
  if (!pairs) return { status: 401, body: { error: "signed_out" } };
  const pair = pairs.find((p) => p.link.id === linkId);
  if (!pair?.access) return { status: 404, body: { error: "not_found" } };
  try {
    const res = await deps.instance(`${pair.access.instanceUrl.replace(/\/+$/, "")}/portal/orders/${encodeURIComponent(orderId)}/confirm`, {
      method: "POST",
      headers: { ...bearer(pair.access.token), "Content-Type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(deps.timeoutMs ?? 8000),
    });
    return { status: res.status, body: await asJson(res) };
  } catch {
    return { status: 502, body: { error: "unreachable", customer: pair.link.customerName } };
  }
}

/**
 * `GET /api/invoices/:linkId/:invoiceId/document?file=&download=` —
 * decision 0770: an invoice's or credit note's own document, as the
 * customer's instance gives it to the supplier it belongs to, passed
 * through as it comes. Only `file` and `download` are forwarded; a page
 * keeps the instance's policy that it may run nothing.
 */
export async function invoiceDocument(deps: Deps, session: string, linkId: string, invoiceId: string, search: string): Promise<Response> {
  const pairs = await linksWithAccess(deps, session);
  const jsonResponse = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  if (!pairs) return jsonResponse(401, { error: "signed_out" });
  const pair = pairs.find((p) => p.link.id === linkId);
  if (!pair?.access) return jsonResponse(404, { error: "not_found" });
  const params = new URLSearchParams(search);
  const query = new URLSearchParams();
  for (const k of ["file", "download"]) if (params.get(k)) query.set(k, params.get(k)!);
  try {
    const res = await deps.instance(`${pair.access.instanceUrl.replace(/\/+$/, "")}/portal/invoices/${encodeURIComponent(invoiceId)}/document?${query}`, {
      headers: bearer(pair.access.token),
      signal: AbortSignal.timeout(deps.timeoutMs ?? 15000),
    });
    if (!res.ok) return jsonResponse(res.status === 404 ? 404 : 502, { error: res.status === 404 ? "not_found" : "refused" });
    const headers = new Headers({ "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
    for (const h of ["Content-Type", "Content-Disposition", "Content-Security-Policy"]) if (res.headers.get(h)) headers.set(h, res.headers.get(h)!);
    // A page with no policy of its own is given one: nothing it holds runs here.
    if ((headers.get("Content-Type") ?? "").includes("html") && !headers.get("Content-Security-Policy")) headers.set("Content-Security-Policy", "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:");
    return new Response(res.body, { status: 200, headers });
  } catch {
    return jsonResponse(502, { error: "unreachable" });
  }
}
