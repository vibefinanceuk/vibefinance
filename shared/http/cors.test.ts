import { describe, expect, it } from "vitest";
import { corsHeaders, handlePreflight, withCors, allowedOrigins } from "./cors.js";

const UI = "https://app.vibefinance.com";
const CONFIGURED = `${UI},http://localhost:8788`;

function req(origin?: string, method = "GET", extra: Record<string, string> = {}): Request {
  const headers: Record<string, string> = { ...extra };
  if (origin) headers.Origin = origin;
  return new Request("https://api.example.com/whoami", { method, headers });
}

describe("unset means the Worker behaves exactly as before", () => {
  it("adds no headers at all", () => {
    // Every existing test and curl must be unaffected by this
    // existing. A Worker with no UI configured is byte-identical.
    expect(corsHeaders(req(UI), undefined)).toEqual({});
  });

  it("returns the response untouched", () => {
    const original = new Response("hello", { headers: { "Content-Type": "text/plain" } });
    expect(withCors(original, req(UI), undefined)).toBe(original);
  });

  it("does not answer a preflight", () => {
    const preflight = req(UI, "OPTIONS", { "Access-Control-Request-Method": "POST" });
    const response = handlePreflight(preflight, undefined);
    expect(response).not.toBeNull();
    expect(response?.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });
});

describe("the allow-list is a list, not a wildcard", () => {
  it("echoes an origin that is on it", () => {
    expect(corsHeaders(req(UI), CONFIGURED)["Access-Control-Allow-Origin"]).toBe(UI);
  });

  it("refuses one that is not, by saying nothing", () => {
    // The absent header IS the refusal — that is what a browser reads.
    const headers = corsHeaders(req("https://evil.example.com"), CONFIGURED);
    expect(headers["Access-Control-Allow-Origin"]).toBeUndefined();
  });

  it("never echoes whatever arrived", () => {
    // Echoing the request's own origin unconditionally is a wildcard
    // with extra steps, and the well-known mistake that makes an
    // allow-list decorative.
    for (const origin of ["https://evil.example.com", "null", "https://app.vibefinance.com.evil.com"]) {
      expect(corsHeaders(req(origin), CONFIGURED)["Access-Control-Allow-Origin"]).toBeUndefined();
    }
  });

  it("never sends a wildcard", () => {
    expect(corsHeaders(req(UI), CONFIGURED)["Access-Control-Allow-Origin"]).not.toBe("*");
  });

  it("adds nothing when there is no Origin header — an ordinary curl", () => {
    expect(corsHeaders(req(undefined), CONFIGURED)["Access-Control-Allow-Origin"]).toBeUndefined();
  });

  it("supports several origins, so development is configuration not code", () => {
    expect(corsHeaders(req("http://localhost:8788"), CONFIGURED)["Access-Control-Allow-Origin"]).toBe(
      "http://localhost:8788"
    );
  });

  it("tolerates spacing in the configured list", () => {
    expect(allowedOrigins(" a , b ,, c ")).toEqual(["a", "b", "c"]);
  });
});

describe("Vary: Origin", () => {
  it("is set whenever CORS is configured, allowed or not", () => {
    // The response genuinely differs by origin, and a cache ignoring
    // that could serve one origin's permitted response to another.
    expect(corsHeaders(req(UI), CONFIGURED).Vary).toBe("Origin");
    expect(corsHeaders(req("https://evil.example.com"), CONFIGURED).Vary).toBe("Origin");
  });
});

describe("preflight", () => {
  const preflight = (origin: string) =>
    req(origin, "OPTIONS", { "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "authorization" });

  it("names Authorization explicitly, because it cannot be wildcarded", () => {
    // Checked against MDN rather than assumed: Authorization is not
    // CORS-safelisted and never accepts a wildcard.
    const response = handlePreflight(preflight(UI), CONFIGURED);
    expect(response?.headers.get("Access-Control-Allow-Headers")).toContain("Authorization");
    expect(response?.headers.get("Access-Control-Allow-Headers")).not.toContain("*");
  });

  it("answers 204 with the methods a UI needs", () => {
    const response = handlePreflight(preflight(UI), CONFIGURED);
    expect(response?.status).toBe(204);
    expect(response?.headers.get("Access-Control-Allow-Methods")).toContain("POST");
  });

  it("refuses an origin not on the list", () => {
    const response = handlePreflight(preflight("https://evil.example.com"), CONFIGURED);
    expect(response?.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(response?.headers.get("Access-Control-Allow-Methods")).toBeNull();
  });

  it("is not triggered by an ordinary OPTIONS request", () => {
    const plain = req(UI, "OPTIONS");
    expect(handlePreflight(plain, CONFIGURED)).toBeNull();
  });

  it("leaves other methods alone", () => {
    expect(handlePreflight(req(UI, "POST"), CONFIGURED)).toBeNull();
  });
});

describe("no Allow-Credentials, deliberately", () => {
  it("is absent from a normal response", () => {
    // These APIs authenticate with a bearer token, which is an ordinary
    // header rather than "credentials" in the CORS sense — cookies and
    // TLS client certificates. Omitting it means a browser will not
    // attach cookies even if the origin check were wrong.
    const response = withCors(new Response("ok"), req(UI), CONFIGURED);
    expect(response.headers.get("Access-Control-Allow-Credentials")).toBeNull();
  });

  it("is absent from a preflight", () => {
    const response = handlePreflight(
      req(UI, "OPTIONS", { "Access-Control-Request-Method": "POST" }),
      CONFIGURED
    );
    expect(response?.headers.get("Access-Control-Allow-Credentials")).toBeNull();
  });
});

describe("withCors preserves the response", () => {
  it("keeps the status and body", async () => {
    const response = withCors(new Response("refused", { status: 401 }), req(UI), CONFIGURED);
    expect(response.status).toBe(401);
    expect(await response.text()).toBe("refused");
  });

  it("keeps existing headers", () => {
    const original = new Response("{}", { headers: { "Content-Type": "application/json" } });
    const response = withCors(original, req(UI), CONFIGURED);
    expect(response.headers.get("Content-Type")).toBe("application/json");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(UI);
  });
});
