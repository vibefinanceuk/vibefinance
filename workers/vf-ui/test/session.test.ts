import { describe, expect, it } from "vitest";
import { setSessionCookie, clearSessionCookie, readSessionCookie } from "../src/session.js";

const SESSION = {
  token: "a.b.c",
  environmentId: "Acme-production",
  instanceUrl: "https://vf-app.example.com",
};

const HOUR_AWAY = new Date(Date.now() + 3600_000).toISOString();

function withCookie(header: string): Request {
  return new Request("https://ui.example.com/api/whoami", { headers: { Cookie: header } });
}

/** The Set-Cookie value as a browser would store it. */
function cookieValue(setCookie: string): string {
  return setCookie.split(";")[0];
}

describe("the cookie a browser is given", () => {
  it("round-trips the session", () => {
    const set = setSessionCookie(SESSION, HOUR_AWAY);
    expect(readSessionCookie(withCookie(cookieValue(set)))).toEqual(SESSION);
  });

  it("is HttpOnly — which is the entire point", () => {
    // No browser API stores a token securely (RFC 10017). HttpOnly
    // means script cannot read this at all, so an injected script
    // cannot exfiltrate it.
    expect(setSessionCookie(SESSION, HOUR_AWAY)).toContain("HttpOnly");
  });

  it("is Secure, so it never travels in clear", () => {
    expect(setSessionCookie(SESSION, HOUR_AWAY)).toContain("Secure");
  });

  it("is SameSite=Strict, because a cookie is sent automatically", () => {
    // That is what makes a refresh work and what creates a CSRF surface
    // a bearer token in a header never had.
    expect(setSessionCookie(SESSION, HOUR_AWAY)).toContain("SameSite=Strict");
  });

  it("expires when the token does", () => {
    // A cookie outliving its token means a browser that believes it is
    // signed in and an API that disagrees — an unexplained failure
    // mid-task.
    const set = setSessionCookie(SESSION, new Date(Date.now() + 600_000).toISOString());
    const maxAge = Number(/Max-Age=(\d+)/.exec(set)?.[1]);
    expect(maxAge).toBeGreaterThan(560);
    expect(maxAge).toBeLessThanOrEqual(600);
  });

  it("expires immediately for a token already past its time", () => {
    const set = setSessionCookie(SESSION, new Date(Date.now() - 60_000).toISOString());
    expect(set).toContain("Max-Age=0");
  });
});

describe("reading a cookie that is not ours", () => {
  it("returns nothing when there is no cookie at all", () => {
    expect(readSessionCookie(new Request("https://ui.example.com/"))).toBeNull();
  });

  it("returns nothing for an unrelated cookie", () => {
    expect(readSessionCookie(withCookie("other=value"))).toBeNull();
  });

  it("returns nothing rather than throwing for nonsense", () => {
    // Anybody can send an arbitrary cookie. A parse failure is no
    // session, not a crash.
    for (const bad of ["vf_session=not-base64!!", "vf_session=", "vf_session=eyJ9"]) {
      expect(readSessionCookie(withCookie(bad))).toBeNull();
    }
  });

  it("returns nothing for valid JSON that is not a session", () => {
    const notASession = btoa(JSON.stringify({ hello: "world" })).replace(/=+$/, "");
    expect(readSessionCookie(withCookie(`vf_session=${notASession}`))).toBeNull();
  });

  it("finds ours among several", () => {
    const set = cookieValue(setSessionCookie(SESSION, HOUR_AWAY));
    expect(readSessionCookie(withCookie(`a=1; ${set}; b=2`))).toEqual(SESSION);
  });
});

describe("signing out", () => {
  it("clears the cookie", () => {
    const cleared = clearSessionCookie();
    expect(cleared).toContain("Max-Age=0");
    expect(cleared).toContain("HttpOnly");
  });

  it("leaves nothing readable", () => {
    expect(readSessionCookie(withCookie(cookieValue(clearSessionCookie())))).toBeNull();
  });
});
