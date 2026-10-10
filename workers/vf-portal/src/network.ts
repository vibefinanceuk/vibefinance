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
      customers: ((body.links ?? []) as Link[]).map((l) => ({ linkId: l.id, customer: l.customerName, supplier: l.supplierName, companies: l.orgUnits.map((u) => u.name) })),
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
  for (const { link, answer } of answers) {
    if (!answer.ok) {
      unavailable.push({ customer: link.customerName, reason: answer.reason });
      continue;
    }
    for (const inv of (answer.body.invoices ?? []) as Record<string, unknown>[]) {
      all.push({ ...inv, linkId: link.id, customer: link.customerName, supplier: link.supplierName });
    }
  }
  all.sort((a, b) => String(b.receivedAt ?? "").localeCompare(String(a.receivedAt ?? "")));
  return { status: 200, body: { invoices: all, unavailable } };
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

/** `POST /api/invoices/:linkId/:invoiceId/messages` — the supplier writes, to the customer that link is for (0721). */
export async function reply(deps: Deps, session: string, linkId: string, invoiceId: string, body: unknown): Promise<Result> {
  const pairs = await linksWithAccess(deps, session);
  if (!pairs) return { status: 401, body: { error: "signed_out" } };
  const pair = pairs.find((p) => p.link.id === linkId);
  if (!pair?.access) return { status: 404, body: { error: "not_found" } };
  try {
    const res = await deps.instance(`${pair.access.instanceUrl.replace(/\/+$/, "")}/portal/invoices/${encodeURIComponent(invoiceId)}/messages`, {
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
