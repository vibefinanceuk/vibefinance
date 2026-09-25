import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("configuration is injected, not compiled in", () => {
  it("serves the API address as a script", async () => {
    // A <script src> rather than JSON fetched at startup, so the value
    // is present before any code needs it.
    const res = await SELF.fetch("https://ui.example.com/config.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("javascript");
    expect(await res.text()).toContain("window.VF_CONFIG");
  });

  it("no longer carries an API address at all", async () => {
    // Since decision 0102 the browser talks only to this origin, so
    // there is nothing to tell it. The mechanism stays because a UI
    // needs to know things; the value went away.
    const body = await (await SELF.fetch("https://ui.example.com/config.js")).text();
    expect(body).not.toContain("workers.dev");
  });

  it("is not cached — a stale copy sends a browser to the wrong API", async () => {
    const res = await SELF.fetch("https://ui.example.com/config.js");
    expect(res.headers.get("Cache-Control")).toContain("no-store");
  });

  it("is valid JavaScript, not concatenated strings", async () => {
    // The value comes from deployment configuration rather than a user,
    // but a URL interpolated raw into JavaScript is a shape of mistake
    // worth not making at all.
    const body = await (await SELF.fetch("https://ui.example.com/config.js")).text();
    expect(() => new Function(`const window = {}; ${body}`)()).not.toThrow();
  });
});

describe("serving the interface", () => {
  it("serves the sign-in page at the root", async () => {
    const res = await SELF.fetch("https://ui.example.com/");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Sign in");
  });

  it("answers an unknown path with the page, not a 404", async () => {
    // A path this Worker does not recognise may be a route the page
    // does.
    const res = await SELF.fetch("https://ui.example.com/queue/validation");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
  });

  it("falls back to the page for any path Cloudflare did not match", async () => {
    /**
     * **Static assets are not served in this test environment** — every
     * request reaches the Worker and takes the fallback. So this cannot
     * assert that `/tokens.css` serves the stylesheet; only that an
     * unmatched path yields the page.
     *
     * Worth stating because the previous version of this test claimed
     * to check the stylesheet and **passed for the wrong reason**: the
     * fallback returned `index.html`, which happened to contain
     * `--brand-bar` in its own styles. Changing that one variable made
     * it fail and revealed the test had never checked what it said.
     *
     * Asset serving is Cloudflare's, configured in `wrangler.jsonc` and
     * verified by `wrangler deploy --dry-run` reporting the files it
     * read.
     */
    const res = await SELF.fetch("https://ui.example.com/tokens.css");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/html");
  });
});

describe("the page loads its livery as a stylesheet", () => {
  it("links branding before any script runs", async () => {
    // Both stylesheets apply before the first paint. Fetching branding
    // as JSON and setting variables in script would mean a visible
    // flash of the wrong colours (decision 0096).
    // Against whichever script the page loads first, rather than a
    // named one — the entry point changed from signin.js to boot.js
    // when the Task Manager landed (decision 0103), and a test naming
    // the file fails on a rename while the property still holds.
    const html = await (await SELF.fetch("https://ui.example.com/")).text();
    const brandLink = html.indexOf('id="brand"');
    const firstScript = html.indexOf("<script type=\"module\"");
    expect(brandLink).toBeGreaterThan(-1);
    expect(firstScript).toBeGreaterThan(-1);
    expect(brandLink).toBeLessThan(firstScript);
  });

  it("carries no hardcoded API address in the markup", async () => {
    const html = await (await SELF.fetch("https://ui.example.com/")).text();
    expect(html).not.toContain("workers.dev");
  });
});


describe("the proxy is an allow-list, not a forwarder (decision 0102)", () => {
  /**
   * A proxy that forwards whatever it is given forwards routes nobody
   * has thought about — and this project found three write routes above
   * an admin gate (0097) by exactly that inattention. Adding a path is
   * a deliberate act.
   */
  it("refuses a path nobody listed", async () => {
    const res = await SELF.fetch("https://ui.example.com/api/customers", { method: "POST" });
    expect(res.status).toBe(404);
  });

  it("refuses an admin path outright", async () => {
    // vf-licence protects these itself, and a proxy that offered them a
    // route would be relying on that rather than deciding.
    for (const path of ["/api/credentials", "/api/access", "/api/branding/acme"]) {
      const res = await SELF.fetch(`https://ui.example.com${path}`, { method: "POST" });
      expect(res.status, path).toBe(404);
    }
  });

  it("answers an unknown API path with JSON, not the page", async () => {
    // Falling through to index.html would return HTML to something
    // expecting JSON.
    const res = await SELF.fetch("https://ui.example.com/api/nonsense");
    expect(res.headers.get("Content-Type")).toContain("json");
  });

  it("refuses a proxied instance path with no session", async () => {
    const res = await SELF.fetch("https://ui.example.com/api/whoami");
    expect(res.status).toBe(401);
  });
});

describe("signing out", () => {
  it("clears the cookie", async () => {
    const res = await SELF.fetch("https://ui.example.com/api/sign-out", { method: "POST" });
    expect(res.status).toBe(200);
    expect(res.headers.get("Set-Cookie")).toContain("Max-Age=0");
  });
});

describe("the token never reaches the page (decision 0102)", () => {
  /**
   * The property this whole change exists for, and it had no test until
   * a fail-watch showed nothing caught the token being returned
   * alongside the cookie.
   *
   * The sign-in path itself cannot be exercised here — it needs
   * `vf-licence` to answer — so this tests the step that decides what
   * the page sees. A function that can be tested is better than a
   * property that cannot.
   */
  it("removes the token from what the page receives", async () => {
    const { visibleToPage } = await import("../src/index.js");
    const upstream = {
      token: "a.real.token",
      expiresAt: "2026-09-05T00:00:00.000Z",
      environmentId: "Acme-production",
      instanceUrl: "https://vf-app.example.com",
    };

    const visible = visibleToPage(upstream);
    expect(visible).not.toHaveProperty("token");
    expect(JSON.stringify(visible)).not.toContain("a.real.token");
  });

  it("keeps everything else, including fields nobody anticipated", async () => {
    // Removed by name rather than by an allow-list, so a new field
    // vf-licence adds reaches the page without a change here.
    const { visibleToPage } = await import("../src/index.js");
    const visible = visibleToPage({
      token: "secret",
      environmentId: "Acme-production",
      lastSignedInAt: "2026-09-04T16:45:12.000Z",
      somethingAddedLater: 42,
    });

    expect(visible.environmentId).toBe("Acme-production");
    expect(visible.lastSignedInAt).toBe("2026-09-04T16:45:12.000Z");
    expect(visible.somethingAddedLater).toBe(42);
  });
});

describe("the task list is reachable, and only what it needs", () => {
  it("proxies the list itself", async () => {
    // Refused for want of a session, not for want of a route — which
    // is the distinction being asserted.
    const res = await SELF.fetch("https://ui.example.com/api/tasks");
    expect(res.status).toBe(401);
  });

  it("proxies claiming and releasing", async () => {
    for (const path of ["/api/tasks/abc/claim", "/api/tasks/abc/release"]) {
      const res = await SELF.fetch(`https://ui.example.com${path}`, { method: "POST" });
      expect(res.status, path).toBe(401);
    }
  });

  it("does not proxy a task path nobody listed", async () => {
    // The point of a list rather than a prefix: /tasks/:id/anything is
    // not automatically reachable because /tasks is.
    //
    // **The example changed, twice now.** It used `complete`, which
    // decision 0138 then listed, then `reassign`, which decision 0489
    // listed in turn — a test whose example becomes real is a test
    // that fails for being right about the old world. The claim
    // survives; only the path had to be one nobody has listed yet.
    const res = await SELF.fetch("https://ui.example.com/api/tasks/abc/frobnicate", { method: "POST" });
    expect(res.status).toBe(404);
  });
});

describe("the page decides which screen to show (decision 0103)", () => {
  it("ships both views, and shows NEITHER until it knows", async () => {
    // The session survives a refresh (decision 0102), and until now
    // nothing asked -- so a reload rendered an empty sign-in form while
    // the session was perfectly alive.
    //
    // **Both start hidden.** Showing the sign-in form by default meant
    // it painted on every refresh and vanished when /api/whoami
    // answered, which looks like a session failing and recovering.
    const html = await (await SELF.fetch("https://ui.example.com/")).text();
    expect(html).toContain('id="signin-view" hidden');
    expect(html).toContain('id="shell" hidden');
  });

  it("loads a boot script rather than the sign-in form directly", async () => {
    const html = await (await SELF.fetch("https://ui.example.com/")).text();
    expect(html).toContain("boot.js");
  });
});

describe("the Validation viewer's routes (decision 0106)", () => {
  it("proxies keying and the document URL", async () => {
    // Refused for want of a session, not for want of a route.
    for (const [method, path] of [
      ["POST", "/api/invoices/inv-1/key"],
      ["POST", "/api/invoices/inv-1/document-url"],
    // The rest of what a task can offer (decision 0138).
    ["POST", "/api/tasks/t-1/complete"],
    ["POST", "/api/tasks/t-1/return"],
    ["POST", "/api/tasks/t-1/return-to-supplier"],
    ["POST", "/api/tasks/t-1/discard"],
    ] as [string, string][]) {
      const res = await SELF.fetch(`https://ui.example.com${path}`, { method });
      expect(res.status, path).toBe(401);
    }
  });

  it("does not proxy an invoice path nobody listed", async () => {
    // Still a list rather than a prefix: /invoices/:id/anything is not
    // reachable merely because two of its siblings are.
    const res = await SELF.fetch("https://ui.example.com/api/invoices/inv-1/document", {
      method: "POST",
    });
    expect(res.status).toBe(404);
  });

  it("ships the viewer hidden alongside the list", async () => {
    const html = await (await SELF.fetch("https://ui.example.com/")).text();
    expect(html).toContain('id="viewer" hidden');
  });
});

describe("the interface's words come from the control plane (decision 0107)", () => {
  it("proxies the strings endpoint", async () => {
    // Reached before anybody signs in, like branding -- a login screen
    // needs its labels.
    const res = await SELF.fetch("https://ui.example.com/api/ui-strings?locale=de");
    // 503 from the stubbed binding, not 404: the route exists.
    expect(res.status).not.toBe(404);
  });

  it("ships no English labels in the markup", async () => {
    // Every visible word is fetched by key. A literal in the page is
    // one a translation cannot reach -- and one that flashes the wrong
    // language to the person least able to read it.
    const html = await (await SELF.fetch("https://ui.example.com/")).text();
    for (const literal of [
      "Sign out",
      "All stages",
      "Not yet keyed",
      "Save keyed values",
      // The sign-in form's own labels, keyed last because it is markup
      // rather than script.
      ">Email<",
      ">Password<",
      ">Continue<",
      ">Sign in to continue<",
      ">VibeFinance<",
    ]) {
      expect(html, literal).not.toContain(literal);
    }
  });

  it("marks the sign-in form's words for filling", async () => {
    const html = await (await SELF.fetch("https://ui.example.com/")).text();
    for (const key of ["signin.title", "signin.email", "signin.continue"]) {
      expect(html, key).toContain(`data-t="${key}"`);
    }
  });
});

describe("the standard's code lists reach the screen (decision 0113)", () => {
  it("proxies them", async () => {
    // Refused for want of a session, not for want of a route.
    const res = await SELF.fetch("https://ui.example.com/api/code-lists");
    expect(res.status).toBe(401);
  });
});

describe("field visibility reaches the screen (decision 0114)", () => {
  it("proxies it", async () => {
    // Refused for want of a session, not for want of a route.
    const res = await SELF.fetch("https://ui.example.com/api/field-visibility?stage=validation");
    expect(res.status).toBe(401);
  });
});

describe("the viewer can read an invoice back (decision 0120)", () => {
  it("proxies it", async () => {
    // Refused for want of a session, not for want of a route.
    const res = await SELF.fetch("https://ui.example.com/api/invoices/inv-1");
    expect(res.status).toBe(401);
  });
});



describe("the proxy carries every path a screen calls (decision 0131)", () => {
  /**
   * **Reported from the screen: the rename button did nothing.**
   *
   * `/sources/:id/email` and `/sources` were listed and the bare
   * `/sources/:id` was not — easy to miss when the paths beneath it are
   * already there. The symptom is a button refused by this proxy rather
   * than by the route it was aimed at, which looks identical to a bug
   * in the route.
   *
   * A 401 here means the path is carried and the request reached
   * `vf-app`, which refused it for want of a session. **A 404 means the
   * proxy did not recognise it**, and that is the failure this catches.
   *
   * The first version of this looked for a 403 and passed while the
   * reported bug was present — a test that checks the wrong code is a
   * test that reports the wrong answer confidently.
   */
  const CALLED_BY_A_SCREEN: [string, string][] = [
    ["GET", "/api/sources"],
    ["GET", "/api/processes"],
    ["GET", "/api/field-visibility"],
    ["GET", "/api/code-lists"],
    ["GET", "/api/tasks"],
    ["GET", "/api/invoices/inv-1"],
    ["POST", "/api/sources/s-1/email"],
    ["POST", "/api/processes/ap/sources"],
    ["POST", "/api/invoices/inv-1/key"],
    ["POST", "/api/invoices/inv-1/document-url"],
    // The rest of what a task can offer (decision 0138).
    ["POST", "/api/tasks/t-1/complete"],
    ["POST", "/api/tasks/t-1/return"],
    ["POST", "/api/tasks/t-1/return-to-supplier"],
    ["POST", "/api/tasks/t-1/discard"],
    // Reassign — decision 0489.
    ["GET", "/api/tasks/t-1/reassign-candidates"],
    ["POST", "/api/tasks/t-1/reassign"],
    // The two that were missing.
    ["PATCH", "/api/sources/s-1"],
    ["DELETE", "/api/sources/s-1"],
    // The purchase order load screen — decision 0371, and its list —
    // decision 0372.
    ["POST", "/api/purchase-orders/csv-load"],
    ["GET", "/api/purchase-orders"],
    // The Workload screen's own chart — decision 0415. Shipped without
    // this line: the nav item, the click handler, and the fetch all
    // worked, and this proxy still answered 404 before `vf-app` saw it.
    ["GET", "/api/workload/throughput"],
    /**
     * The Supplier Performance screen's own chart — decision 0416.
     * Already carried by the wildcard `/^\/suppliers\/[^/]+$/` a few
     * lines above `PROXIED_TO_INSTANCE`'s "spend" entry would go —
     * confirmed here explicitly rather than assumed, the same
     * discipline this whole block exists to enforce: a path a screen
     * calls is proven reachable by a real fetch, never inferred from
     * which pattern happens to match it.
     */
    ["GET", "/api/suppliers/spend"],
    /**
     * The Financial Performance tab's own accruals report — decision
     * 0417's own follow-on. `/accruals` matches no existing wildcard
     * (unlike `/suppliers/spend`), so it needed a real new entry on
     * `PROXIED_TO_INSTANCE` — proven reachable here rather than merely
     * added and assumed correct.
     */
    ["GET", "/api/accruals"],
    /**
     * The Financial Performance tab's own second real metric, spend
     * under management — decision 0419. Checked directly again, the
     * same discipline decision 0418 already established for this exact
     * recurring gap: `/spend/under-management` matched no existing
     * wildcard either.
     */
    ["GET", "/api/spend/under-management"],
    /**
     * The Fraud Prevention tab's own first real metric, potential
     * duplicate invoices — decision 0420. Checked directly again, the
     * same discipline decisions 0418 and 0419 already established for
     * this exact recurring gap: `/fraud/duplicates` matched no
     * existing wildcard either.
     */
    ["GET", "/api/fraud/duplicates"],
    /**
     * The Supplier Performance tab's own remaining four metrics —
     * decision 0421. Each matches the same `/^\/suppliers\/[^/]+$/`
     * wildcard `/suppliers/spend` already does — confirmed directly
     * with a real fetch rather than assumed from the pattern alone,
     * the same discipline every entry in this block already follows.
     */
    ["GET", "/api/suppliers/cycle-time"],
    ["GET", "/api/suppliers/exceptions"],
    ["GET", "/api/suppliers/po-variance"],
    ["GET", "/api/suppliers/payment-terms"],
    /**
     * The Fraud Prevention tab's own second real metric, unapproved-
     * supplier invoices — decision 0422. `/fraud/unapproved-suppliers`
     * matched no existing wildcard either, the same recurring gap this
     * whole block keeps finding — checked directly, not assumed.
     */
    ["GET", "/api/fraud/unapproved-suppliers"],
    /**
     * The Fraud Prevention tab's own third real metric, exceptions by
     * type/user/supplier trended — decision 0423.
     * `/fraud/exception-trends` matched no existing wildcard either,
     * the same recurring gap this whole block keeps finding.
     */
    ["GET", "/api/fraud/exception-trends"],
    /**
     * The Fraud Prevention tab's own fourth and fifth real metrics,
     * statistical outliers and segregation-of-duties flags — decision
     * 0424. Neither `/fraud/statistical-outliers` nor
     * `/fraud/segregation-of-duties` matched any existing wildcard
     * either, the same recurring gap this whole block keeps finding.
     */
    ["GET", "/api/fraud/statistical-outliers"],
    ["GET", "/api/fraud/segregation-of-duties"],
    /**
     * The Multi-Enterprise CFO View's own first real metric,
     * consolidated spend across org units / legal entities — decision
     * 0425. `/executive/consolidated-spend` matched no existing
     * wildcard either, the same recurring gap this whole block keeps
     * finding.
     */
    ["GET", "/api/executive/consolidated-spend"],
    /**
     * The Multi-Enterprise CFO View's own remaining four
     * data-buildable metrics — decision 0431. Each matches the
     * `/^\/executive\/[^/]+$/` wildcard `/executive/consolidated-spend`
     * was widened into for exactly this — confirmed directly with a
     * real fetch against every one of them, not assumed from the
     * pattern alone.
     */
    ["GET", "/api/executive/liabilities-by-entity"],
    ["GET", "/api/executive/supplier-concentration"],
    ["GET", "/api/executive/exception-trends"],
    ["GET", "/api/executive/throughput"],
    /**
     * Supplier Performance's own last two metrics, discount eligibility
     * and hold history — decision 0427. Each matches the same
     * `/^\/suppliers\/[^/]+$/` wildcard `/suppliers/spend` already does
     * — confirmed directly with a real fetch rather than assumed from
     * the pattern alone, the same discipline decision 0421 already
     * established for this screen's own other four metrics.
     */
    ["GET", "/api/suppliers/discount-eligibility"],
    ["GET", "/api/suppliers/hold-history"],
    /**
     * Six of Workload's own remaining seven metrics — decision 0428.
     * Each matches the `/^\/workload\/[^/]+$/` wildcard
     * `/workload/throughput` was widened into for exactly this —
     * confirmed directly with a real fetch against every one of them,
     * not assumed from the pattern alone. The seventh,
     * `/workload/exceptions`, is deliberately not listed here — no
     * screen calls it any more, since decision 0428's own second
     * addendum pulled the card and its route over an unresolved
     * governance concern and a broken raw-count calculation. The
     * wildcard would still proxy it if a screen ever called it again;
     * nothing calls it today.
     */
    ["GET", "/api/workload/open-tasks"],
    ["GET", "/api/workload/handling-time"],
    ["GET", "/api/workload/cycle-time"],
    ["GET", "/api/workload/pending"],
    ["GET", "/api/workload/queue-depth"],
    ["GET", "/api/workload/balance"],
    /**
     * The AP Assistant's own worked example, the overdue-invoice
     * balance — decision 0430. Not one of Financial Performance's six
     * metrics; built solely to back the assistant's `overdue_balance`
     * tool call. `/liabilities/overdue-balance` matched no existing
     * wildcard either, the same recurring gap this whole block keeps
     * finding.
     */
    ["GET", "/api/liabilities/overdue-balance"],
    /**
     * "Talk to an AP Expert" itself — decision 0430, the sixth and last
     * tab on AP Analytics. `/ap-assistant/ask` matched no existing
     * wildcard either.
     */
    ["POST", "/api/ap-assistant/ask"],
    /**
     * AP Setup's own Approval Hierarchy tab — decision 0440. Reported
     * live as "AP Setup could not be loaded": the route was real and
     * tested in `vf-app`, and this proxy answered 404 before `vf-app`
     * ever saw it, the exact gap this whole block exists to catch.
     */
    ["GET", "/api/approval-config"],
    ["PUT", "/api/approval-config"],
    ["POST", "/api/approval-config/supervisor-overrides"],
    ["DELETE", "/api/approval-config/supervisor-overrides/u-1/unit-1"],
    ["POST", "/api/approval-config/limit-overrides"],
    ["DELETE", "/api/approval-config/limit-overrides/u-1/unit-1/EUR"],
    /**
     * AP Setup's own Account Coding tab — decision 0444. The exact
     * same gap decision 0440 found above, this time for
     * `/org/cost-centres` (POST, decision 0031, already real in
     * `vf-app` and never proxied) and the three genuinely new
     * coding-list routes this decision's own generic CRUD adds.
     */
    ["GET", "/api/org/cost-centres"],
    ["POST", "/api/org/cost-centres"],
    ["PUT", "/api/cost-centres/cc-1"],
    ["GET", "/api/coding-lists/project"],
    ["POST", "/api/coding-lists/project"],
    ["PUT", "/api/coding-lists/project/p-1"],
    /**
     * AP Setup's own Cost-Object Priority panel — decision 0452. Found
     * missing here while fixing decision 0472's own identical miss
     * just below, not from a real report — `PUT
     * /approval-config/cost-object-dimensions` was real and tested in
     * `vf-app`, never on this list.
     */
    ["PUT", "/api/approval-config/cost-object-dimensions"],
    /**
     * AP Setup's own Matching tab — decision 0472. Reported live as
     * "AP Setup could not be loaded" — the identical symptom decision
     * 0440 already named this whole block after, missed again here.
     */
    ["GET", "/api/matching-config"],
    ["PUT", "/api/matching-config"],
    /**
     * Standard matching rules — decision 0474. Added alongside the
     * allowlist entry itself this time, not after a live report.
     */
    ["GET", "/api/matching-config/standard-rules"],
    /**
     * The collaborators roster — decision 0470, `collaborators.js`'s
     * own "Add person to conversation" panel. Never added here at the
     * time, the exact gap this whole block exists to catch — found
     * now, alongside decision 0476's own removal route just below,
     * rather than by a live report.
     */
    ["GET", "/api/documents/inv-1/collaborators"],
    ["POST", "/api/documents/inv-1/collaborators"],
    /**
     * Removing a collaborator — decision 0476. Added alongside the
     * allowlist entry itself this time, not after a live report.
     */
    ["DELETE", "/api/documents/inv-1/collaborators/u-1"],
    /**
     * Stage Restrictions — decision 0483. Reported live: unchecking
     * any Account Coding checkbox showed "not found" at the bottom of
     * the screen. The route (`PUT /processes/stages/:id/field-
     * visibility`) was real and tested in `vf-app` since decision
     * 0143/0196 — the exact recurring gap this whole block exists to
     * catch, missed at the time this decision shipped the route's own
     * first screen.
     */
    ["PUT", "/api/processes/stages/validation/field-visibility"],
    /**
     * Whether the Stage Restrictions screen even offers a stage —
     * decision 0485. Added alongside the allowlist entry itself, not
     * after a live report — decision 0484 was the lesson.
     */
    ["PUT", "/api/processes/stages/validation/offer-field-restrictions"],
    /**
     * What a stage's own action does — decision 0487. Added alongside
     * the allowlist entry itself, the same discipline as the entry
     * just above.
     */
    ["PUT", "/api/processes/stages/validation/actions/complete"],
  ];

  it("carries all of them", async () => {
    const refused: string[] = [];

    for (const [method, path] of CALLED_BY_A_SCREEN) {
      const res = await SELF.fetch(`https://ui.example.com${path}`, { method });
      if (res.status === 404) refused.push(`${method} ${path}`);
    }

    expect(
      refused,
      `Called by a screen and refused by the proxy: ${refused.join(", ")}. ` +
        "Add the path to PROXIED_INSTANCE_PATHS in workers/vf-ui/src/index.ts, " +
        "or the button that calls it will silently do nothing."
    ).toEqual([]);
  });
});

describe("paths the app is allowed to reach (decision 0212)", () => {
  /**
   * **A route the proxy does not know is a route that does not exist**,
   * however well it works on `vf-app`.
   *
   * Two shipped without one: decision 0204's org picker on the sources
   * screen, and decision 0211's supplier load — which returned
   * `{"error":"not found"}` to a `curl` that was otherwise correct.
   *
   * The allow-list is right to be a list. **The gap is that adding a
   * route and adding it here are two steps, and nothing ties them
   * together.**
   */
  const reachable = [
    "/suppliers/load",
    "/sources/s1/org",
    "/processes/p1",
    "/processes/p1/stages",
    "/processes/p1/draft",
    "/processes/p1/draft/stages",
    "/processes/p1/draft/stages/s1",
    "/processes/p1/publish",
    "/org/units",
    "/org/units/u1",
    "/org/overview",
    "/org/roles",
    "/org/roles/test-role",
    "/org/users/usr1/roles",
    "/org/users/usr1/roles/r1",
    "/org/users",
    "/org/users/usr1/authority-limits",
    "/org/users/usr1",
    "/org/users/usr1/spend-limit",
    "/org/teams",
    "/org/teams/t1",
    "/org/teams/t1/members",
    "/org/teams/t1/members/usr1",
    "/field-visibility",
    /**
     * Purchase order ingestion and CSV load — decision 0371. Both have
     * existed in vf-app since decisions 0081 and 0370 and were never
     * on this list either, the exact gap this describe block already
     * exists to catch.
     */
    "/purchase-orders",
    "/purchase-orders/csv-load",
    "/purchase-orders/PO-1",
    // The pages behind a multi-page scan — decision 0381.
    "/invoices/inv-1/pages",
    "/invoices/inv-1/pages/1/document-url",
  ];

  for (const path of reachable) {
    it(`forwards ${path}`, async () => {
      const res = await SELF.fetch(`https://example.com/api${path}`, { method: "POST" });
      // **401 is the proxy working**: it recognised the path and asked
      // for a session. A 404 would mean it did not recognise it at all.
      expect(res.status).not.toBe(404);
    });
  }

  it("still refuses a path nobody listed", async () => {
    // The list is a boundary, not a formality.
    const res = await SELF.fetch("https://example.com/api/not-a-real-route", { method: "POST" });
    expect(res.status).toBe(404);
  });
});
