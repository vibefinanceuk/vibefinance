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
   * `vf-licence`, reached through a **Service Binding** rather than a
   * plain `fetch()` to its public URL.
   *
   * Decision 0005 records why, found live and then found again here: a
   * Worker cannot plain-`fetch()` another Worker's `workers.dev` URL on
   * the same account. Cloudflare's anti-loop protection answers with a
   * 404 the target never sees — `error code: 1042`, from Cloudflare
   * rather than from either Worker, which is why it looks like a
   * routing bug rather than a binding one.
   */
  LICENCE_SERVICE?: Fetcher;
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
const PROXIED_TO_INSTANCE: RegExp[] = [
  /^\/whoami$/,
  // The business units a document may belong to — decision 0193.
  /^\/org\/units$/,
  /**
   * **Everything a role-management screen needs — decision 0319.**
   * Added to the backend's own `index.ts` and never added here,
   * which is why a real request to it always returned this proxy's
   * own `"not found"` fallback: the path was never on the list of
   * things this Worker will forward at all, regardless of anything
   * the backend itself permits.
   */
  /^\/org\/overview$/,
  /**
   * **Creating and editing an org unit — decision 0335.** `/org/units`
   * (create) has existed in `vf-app` since decision 0003, gated for
   * the first time in this same decision — already on this list
   * since decision 0193, for a different reason (`GET`, listing units
   * for a document's own picker). The new update route was not.
   */
  /^\/org\/units\/[^/]+$/,
  /**
   * **Creating and editing a role's own definition — decision 0326.**
   * `/org/roles` (create) has existed in `vf-app` since before this
   * session and was never on this list either — the exact shape
   * decision 0212 already documents happening twice, and decision
   * 0324 found a third time on `/org/overview`. Added here alongside
   * the new update route rather than leaving the older gap to be
   * found the same way those were: by a real request failing.
   */
  /^\/org\/roles$/,
  /^\/org\/roles\/[^/]+$/,
  /**
   * **Assigning and revoking a role, decision 0327.** `POST
   * /org/users/:id/roles` (assign) has existed in `vf-app` since
   * decision 0201 and was never on this list either — a fourth
   * instance of decision 0212's own gap, found here before a real
   * request could fail on it. The revoke route is new alongside it.
   */
  /^\/org\/users\/[^/]+\/roles$/,
  /^\/org\/users\/[^/]+\/roles\/[^/]+$/,
  /**
   * **Creating a person — decision 0328.** `POST /org/users` has
   * existed in `vf-app` since before this session and was never on
   * this list either — a fifth instance of decision 0212's own gap.
   */
  /^\/org\/users$/,
  /**
   * **Setting an authority limit — decision 0328.** Closed alongside
   * the route's own real security gap: unguarded, and never on this
   * list either. A sixth instance of decision 0212's own gap, found
   * here before a real request could fail on it.
   */
  /^\/org\/users\/[^/]+\/authority-limits$/,
  /**
   * **User properties — decision 0334.** `PUT /org/users/:id`
   * (editing an existing person) and `POST
   * /org/users/:id/spend-limit` are both new alongside the routes
   * that use them — added here at build time rather than found the
   * way seven earlier instances of this exact gap already were.
   */
  /^\/org\/users\/[^/]+$/,
  /^\/org\/users\/[^/]+\/spend-limit$/,
  /**
   * **Teams, gated for the first time — decision 0332.** Both
   * existing routes (`/org/teams`, `/org/teams/:id/members`) had
   * existed since decision 0016, unauthenticated and never on this
   * list either — closed alongside gating them, rather than left to
   * be found the same way six earlier instances this arc already
   * were.
   */
  /^\/org\/teams$/,
  /^\/org\/teams\/[^/]+$/,
  /^\/org\/teams\/[^/]+\/members$/,
  /^\/org\/teams\/[^/]+\/members\/[^/]+$/,
  // The task list and the actions the list offers (decisions 0103,
  // 0104). Each added deliberately: the point of a list rather than a
  // prefix is that `/tasks/:id/anything` is not automatically
  // reachable because `/tasks` is.
  /^\/tasks$/,
  /^\/tasks\/[^/]+\/claim$/,
  /^\/tasks\/[^/]+\/release$/,
  // The rest of what a task can offer (decision 0138). Their icons
  // rendered and did nothing, because the proxy carried two of six.
  /^\/tasks\/[^/]+\/complete$/,
  /^\/tasks\/[^/]+\/return$/,
  /^\/tasks\/[^/]+\/return-to-supplier$/,
  /^\/tasks\/[^/]+\/discard$/,
  // What the Validation viewer needs (decision 0106): the keyed values,
  // and a short-lived signed URL for the retained original.
  // Reading one invoice back, so the keying screen shows what it saved
  // (decision 0120).
  /^\/invoices\/[^/]+$/,
  /^\/invoices\/[^/]+\/key$/,
  /^\/invoices\/[^/]+\/document-url$/,
  // The pages behind a multi-page scan (decision 0381) — the same
  // shape as document-url immediately above, and the exact gap this
  // list has already been caught missing six times over (0212,
  // 0324–0328): a route real and tested in vf-app, added here in the
  // same commit rather than left to be found live.
  /^\/invoices\/[^/]+\/pages$/,
  /^\/invoices\/[^/]+\/pages\/\d+\/document-url$/,
  // The standard's own code lists, so a person picks a currency rather
  // than types one (decision 0113).
  /^\/code-lists$/,
  // What this stage shows, and what may be edited (decision 0114).
  /^\/field-visibility$/,
  // The sources configuration screen (decision 0126).
  /^\/sources$/,
  // Which org a source places its documents in (decision 0204).
  /^\/sources\/[^/]+\/org$/,
  /**
   * Loading the customer's supplier master file (decision 0211).
   *
   * **The mirror could not be filled through the app**, only by `curl`
   * against `vf-app` directly — which is not a feature a customer has.
   */
  // What a person should do next (decision 0240).
  /^\/dashboard$/,
  /^\/dashboard\/catalogue$/,
  /**
   * Team throughput by stage — decision 0415. Added after the fact:
   * the route shipped in the same commit as this screen's own UI, and
   * this list was not updated alongside it — the exact gap decisions
   * 0131 and 0212 already document in this file. The nav item was
   * real, the click handler ran, the fetch went out — and this proxy
   * answered `{"error":"not found"}` before `vf-app` ever saw it.
   *
   * **Widened to a wildcard — decision 0428.** Workload's own
   * remaining seven metrics each add their own `/workload/<name>`
   * route; a single exact match would have needed seven more entries
   * for the identical family this codebase already has a pattern for
   * (`/suppliers/[^/]+$/` below). One wildcard, matching every
   * `/workload/*` path this screen calls, checked directly with a
   * real fetch against each of the eight paths it covers rather than
   * assumed from the pattern alone — `test/index.test.ts`'s own
   * `CALLED_BY_A_SCREEN` list.
   */
  /^\/workload\/[^/]+$/,
  /**
   * **The accruals report — decision 0417's own follow-on.** Checked
   * directly this time, not assumed: `/accruals` matches no existing
   * wildcard on this list, unlike `/suppliers/spend` (decision 0416),
   * so it gets its own entry rather than the gap decision 0415 already
   * left once.
   */
  /^\/accruals$/,
  /**
   * **Spend under management — decision 0419.** Checked directly
   * again, the same discipline decision 0418 already established for
   * this exact recurring gap: `/spend/under-management` matches no
   * existing wildcard on this list either.
   */
  /^\/spend\/under-management$/,
  /**
   * **Potential duplicate invoices — decision 0420.** Checked directly
   * again, the same discipline decisions 0418 and 0419 already
   * established for this exact recurring gap: `/fraud/duplicates`
   * matches no existing wildcard on this list either.
   */
  /^\/fraud\/duplicates$/,
  /**
   * **Unapproved-supplier invoices — decision 0422.** Checked directly
   * again, the same discipline decisions 0418–0420 already established
   * for this exact recurring gap: `/fraud/unapproved-suppliers`
   * matches no existing wildcard on this list either — it is a
   * sibling of `/fraud/duplicates` above, not a suffix of it.
   */
  /^\/fraud\/unapproved-suppliers$/,
  /**
   * **Exceptions by type, by user, by supplier — trended — decision
   * 0423.** Checked directly again, the same discipline decisions
   * 0418–0422 already established for this exact recurring gap:
   * `/fraud/exception-trends` matches no existing wildcard either.
   */
  /^\/fraud\/exception-trends$/,
  /**
   * **Statistical outliers — decision 0424.** Checked directly again,
   * the same discipline decisions 0418–0423 already established for
   * this exact recurring gap: `/fraud/statistical-outliers` matches no
   * existing wildcard either.
   */
  /^\/fraud\/statistical-outliers$/,
  /**
   * **Segregation-of-duties flags — decision 0424.** Checked directly
   * again, the same discipline decisions 0418–0423 already established
   * for this exact recurring gap: `/fraud/segregation-of-duties`
   * matches no existing wildcard either.
   */
  /^\/fraud\/segregation-of-duties$/,
  /**
   * **Consolidated spend across org units / legal entities — decision
   * 0425.** The Multi-Enterprise CFO View's first real metric. Checked
   * directly again, the same discipline decisions 0418–0424 already
   * established for this exact recurring gap: `/executive/consolidated-
   * spend` matched no existing wildcard either.
   *
   * **Widened to a wildcard — decision 0431.** The Multi-Enterprise
   * CFO View's remaining four data-buildable metrics each add their
   * own `/executive/<name>` route; a single exact match would have
   * needed four more entries for the identical family this codebase
   * already has a pattern for (`/^\/workload\/[^/]+$/` above, widened
   * for the same reason by decision 0428). One wildcard, matching
   * every `/executive/*` path this screen calls, checked directly with
   * a real fetch against each of the five paths it covers rather than
   * assumed from the pattern alone — `test/index.test.ts`'s own
   * `CALLED_BY_A_SCREEN` list.
   */
  /^\/executive\/[^/]+$/,
  /^\/suppliers$/,
  /^\/suppliers\/load$/,
  // Finding and choosing a supplier by hand (decision 0222).
  /^\/suppliers\/search$/,
  // Changing a supplier by hand (decision 0230).
  /^\/suppliers\/[^/]+$/,
  /**
   * **Purchase order ingestion and CSV load — decision 0371.**
   *
   * Both routes have existed in `vf-app` since decision 0081 (XML) and
   * decision 0370 (CSV), and neither was ever added here — the exact
   * gap this file's own comments already name four times over. Found
   * before a real request could fail on it, this time.
   */
  /^\/purchase-orders$/,
  /^\/purchase-orders\/csv-load$/,
  /^\/purchase-orders\/[^/]+$/,
  // Finding one of our own units, and re-routing (decision 0224).
  /^\/org\/units\/search$/,
  /^\/invoices\/[^/]+\/org$/,
  /^\/invoices\/[^/]+\/supplier$/,
  // The rules screen (decision 0149).
  /^\/rules$/,
  // The document manager (decision 0164).
  /^\/documents$/,
  // The activity panel — decision 0267.
  /^\/documents\/[^/]+\/activity$/,
  /^\/documents\/[^/]+\/comments$/,
  // Where an invoice has been (decision 0151).
  /^\/invoices\/[^/]+\/progress$/,
  /^\/rules\/stages$/,
  /^\/rules\/stages\/[^/]+\/rule-set$/,
  // Opening a rule, and pausing it (decision 0155).
  /^\/rules\/[^/]+$/,
  /^\/rules\/[^/]+\/enabled$/,
  /^\/rules\/[^/]+\/name$/,
  // Writing a rule (decision 0153).
  /^\/rules\/compile$/,
  /^\/rules\/[^/]+\/versions\/[0-9]+\/examples$/,
  /^\/rules\/examples\/[^/]+\/confirm$/,
  /^\/rules\/[^/]+\/versions\/[0-9]+\/activate$/,
  // What has arrived by email (decision 0147).
  /^\/inbound-email$/,
  // Listing processes and creating a source (decision 0128).
  /^\/processes$/,
  /**
   * **`/processes/:id/stages`, reachable for the first time —
   * decision 0349.** `handleCreateStage` has existed since decision
   * 0018, real and tested in `vf-app`, and was never once added to
   * this list — the same class of gap decision 0212 already
   * documents, found here rather than by a real request failing.
   *
   * **A process's own detail, and its own draft — decision 0349.**
   * What the new Process Management screen actually calls: reading
   * one process, adding or removing a stage from its own draft, and
   * publishing or discarding that draft.
   */
  /^\/processes\/[^/]+\/stages$/,
  /^\/processes\/[^/]+$/,
  /^\/processes\/[^/]+\/draft$/,
  /^\/processes\/[^/]+\/draft\/stages$/,
  /^\/processes\/[^/]+\/draft\/stages\/[^/]+$/,
  /^\/processes\/[^/]+\/publish$/,
  // Making a stage read-only (decision 0143).
  /^\/processes\/stages\/[^/]+\/read-only$/,
  /^\/processes\/[^/]+\/sources$/,
  /^\/sources\/[^/]+\/email$/,
  // Renaming and retiring one (decision 0130). **The bare path**, which
  // is easy to miss when the paths beneath it are already listed — and
  // the symptom is a button that does nothing, refused by this proxy
  // rather than by the route it was aimed at.
  /^\/sources\/[^/]+$/,
  /**
   * **The overdue-invoice balance — decision 0430's own worked
   * example.** Built solely to back the AP Assistant's `overdue_balance`
   * tool call, not a Screen 4 metric card. Checked directly again, the
   * same discipline decisions 0418–0425 already established for this
   * exact recurring gap: `/liabilities/overdue-balance` matches no
   * existing wildcard on this list either.
   */
  /^\/liabilities\/overdue-balance$/,
  /**
   * **"Talk to an AP Expert" — decision 0430**, the sixth and last tab
   * on AP Analytics. A single `POST`, not a `GET` report fetch like
   * every entry above it, so it needed its own entry regardless: no
   * existing wildcard on this list matches `/ap-assistant/ask`.
   */
  /^\/ap-assistant\/ask$/,
  /**
   * **AP Setup's own Approval Hierarchy tab — decision 0440.** The
   * exact gap this file's own comments already document more than a
   * dozen times over (0212, 0319, 0324–0328, 0415, 0417–0425, 0428,
   * 0430): the route was real and tested in `vf-app`, the nav item was
   * real, the click handler ran, the fetch went out — and this proxy
   * answered `{"error":"not found"}` before `vf-app` ever saw it,
   * reported live as *"AP Setup could not be loaded."* Found by
   * checking this file directly against the operator's own report
   * rather than re-tracing `vf-app` or `ap-setup.js`, both of which
   * were already correct.
   */
  /^\/approval-config$/,
  /^\/approval-config\/supervisor-overrides$/,
  /^\/approval-config\/supervisor-overrides\/[^/]+\/[^/]+$/,
  /^\/approval-config\/limit-overrides$/,
  /^\/approval-config\/limit-overrides\/[^/]+\/[^/]+\/[^/]+$/,
  /**
   * **AP Setup's own Account Coding tab — decision 0444.** The exact
   * same gap decision 0440's own Approval Hierarchy tab already hit
   * this file for: `/org/cost-centres` (POST, decision 0031) and
   * `/cost-centres/:id` (PUT, decision 0195) were both real in `vf-app`
   * and had never been added here, confirmed directly rather than
   * assumed — no existing wildcard on this list matches either. Added
   * alongside the three genuinely new routes this decision's own
   * generic coding-list CRUD needs.
   */
  /^\/org\/cost-centres$/,
  /^\/cost-centres\/[^/]+$/,
  /^\/coding-lists\/[^/]+$/,
  /^\/coding-lists\/[^/]+\/[^/]+$/,
  /**
   * **AP Setup's own Cost-Object Priority panel — decision 0452.** The
   * exact same gap decision 0440 found above, for `/approval-config`
   * itself: `PUT /approval-config/cost-object-dimensions` was real in
   * `vf-app` and tested there, but never added to this list — found
   * directly by checking this file against every AP Setup write route
   * it should be forwarding, not assumed from a real report, while
   * fixing decision 0472's own identical miss just below. Nothing on
   * this list is a wildcard broad enough to already cover it.
   */
  /^\/approval-config\/cost-object-dimensions$/,
  /**
   * **AP Setup's own Matching tab — decision 0472.** The exact same
   * gap decision 0440's own comment above already documents more than
   * a dozen times over: `GET`/`PUT /matching-config` were real and
   * tested in `vf-app`, and this proxy answered `{"error":"not
   * found"}` before `vf-app` ever saw either one, reported live as
   * *"AP Setup could not be loaded"* — the identical symptom, the
   * identical cause, missed here even after decision 0440's own
   * writeup named this file directly as the place to check first.
   */
  /^\/matching-config$/,
  /**
   * **CSV Template and Load — decision 0445.** `GET .../csv-format`
   * and `POST .../csv-load` both have the same two-segment shape as
   * `/coding-lists/:type/:id` directly above (`mayProxy` tests only
   * the path, never the method) — checked directly against this list
   * rather than assumed, given how many times this exact gap has
   * recurred in this file (0212, 0319, 0324–0328, 0371, 0415,
   * 0417–0430, 0441, 0444). No new entry needed; this comment is the
   * record of that check, not a silent no-op.
   */
];

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
  // The interface's own words (decision 0107). Reached before anybody
  // signs in, like branding — a login screen needs its labels.
  /^\/ui-strings$/,
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
  if (!env.LICENCE_SERVICE || !env.LICENCE_API) {
    return json({ error: "LICENCE_SERVICE and LICENCE_API must both be configured" }, 500);
  }

  const target = new URL(path + new URL(request.url).search, env.LICENCE_API);
  return env.LICENCE_SERVICE.fetch(target, {
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
  if (!env.LICENCE_SERVICE || !env.LICENCE_API) {
    return json({ error: "LICENCE_SERVICE and LICENCE_API must both be configured" }, 500);
  }

  const body = await request.json().catch(() => null);
  if (!body) return json({ error: "invalid JSON body" }, 400);

  // Through the binding. The URL supplies the path; the binding decides
  // where it goes, and the hostname is ignored.
  const upstream = await env.LICENCE_SERVICE.fetch(`${env.LICENCE_API}/login`, {
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
