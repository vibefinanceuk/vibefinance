import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import stringsSql from "../../vf-licence/migrations/0239_invitation_strings.sql?raw";
import page from "../public/welcome.html?raw";

/**
 * **Accepting an invitation — decision 0593.** The welcome page reads the
 * token from the fragment, says who and where, takes the code and a
 * password, and says what happened, with the real English strings.
 */

const strings: Record<string, string> = {};
for (const m of stringsSql.matchAll(/\('([^']+)', 'en', '((?:[^']|'')*)'\)/g)) strings[m[1]] = m[2].replace(/''/g, "'");

const TOKEN = "T".repeat(43);
type Call = { path: string; body: Record<string, unknown> };

function stub(calls: Call[], view: [number, unknown], accept: [number, unknown] = [200, { email: "ana@acme.example", environments: [] }]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const path = String(url).split("?")[0];
      if (path === "/api/ui-strings") return { ok: true, json: async () => ({ locale: "en", strings }) } as Response;
      calls.push({ path, body: JSON.parse(String(init?.body ?? "{}")) });
      const [status, body] = path === "/api/invitations/view" ? view : accept;
      return { ok: status < 300, status, json: async () => body } as Response;
    })
  );
}

async function openPage(hash: string) {
  document.body.innerHTML = page.slice(page.indexOf("<main"), page.indexOf("</main>") + 7);
  history.replaceState(null, "", `/welcome.html${hash}`);
  const mod = await import("/welcome.js");
  // The module started on import; start again for this page's state.
  await mod.start();
}
const text = (id: string) => document.getElementById(id)?.textContent ?? "";
const settle = () => new Promise((r) => setTimeout(r, 10));

beforeEach(() => vi.resetModules());
afterEach(() => vi.unstubAllGlobals());

describe("the welcome page — decision 0593", () => {
  it("says who the invitation is for, then sets the password with the code", async () => {
    const calls: Call[] = [];
    stub(calls, [200, { email: "ana@acme.example", customerName: "Acme Ltd", status: "pending", expiresAt: "2026-10-05T09:00:00Z" }]);
    await openPage(`#t=${TOKEN}`);
    expect(text("welcome-sub")).toBe("ana@acme.example, for Acme Ltd. Enter the 6-digit code from your email and choose your password.");
    expect(calls.at(-1)).toEqual({ path: "/api/invitations/view", body: { token: TOKEN } });
    expect(document.getElementById("welcome-form")!.hidden).toBe(false);
    (document.getElementById("welcome-code") as HTMLInputElement).value = "123 456";
    (document.getElementById("welcome-password") as HTMLInputElement).value = "a long enough passphrase";
    (document.getElementById("welcome-again") as HTMLInputElement).value = "a long enough passphrase";
    (document.getElementById("welcome-submit") as HTMLButtonElement).click();
    await settle();
    expect(calls.at(-1)).toEqual({ path: "/api/invitations/accept", body: { token: TOKEN, code: "123 456", password: "a long enough passphrase" } });
    expect(text("welcome-done")).toBe("Your password is set. Sign in as ana@acme.example.");
    expect(document.getElementById("welcome-form")!.hidden).toBe(true);
    expect(document.getElementById("welcome-signin")!.hidden).toBe(false);
    // The spent link leaves the address bar.
    expect(location.hash).toBe("");
  });

  it("checks the password before sending it, and says a wrong code and the tries left", async () => {
    const calls: Call[] = [];
    stub(calls, [200, { email: "ana@acme.example", customerName: "Acme Ltd", status: "pending" }], [422, { reason: "wrong_code", attemptsLeft: 3 }]);
    await openPage(`#t=${TOKEN}`);
    (document.getElementById("welcome-code") as HTMLInputElement).value = "000000";
    const set = (pw: string, again: string) => {
      (document.getElementById("welcome-password") as HTMLInputElement).value = pw;
      (document.getElementById("welcome-again") as HTMLInputElement).value = again;
      (document.getElementById("welcome-submit") as HTMLButtonElement).click();
    };
    set("short", "short");
    await settle();
    expect(text("welcome-problem")).toBe("The password must be at least 12 characters.");
    set("a long enough passphrase", "a different passphrase");
    await settle();
    expect(text("welcome-problem")).toBe("The two passwords are not the same.");
    expect(calls.filter((c) => c.path.endsWith("/accept"))).toHaveLength(0);
    set("a long enough passphrase", "a long enough passphrase");
    await settle();
    expect(text("welcome-problem")).toBe("That code is not right. 3 tries left.");
    expect(document.getElementById("welcome-form")!.hidden).toBe(false);
  });

  it("says why an invitation cannot be used: no token, not valid, expired, already accepted", async () => {
    stub([], [404, { reason: "not_valid" }]);
    await openPage("");
    expect(text("welcome-problem")).toBe("This invitation link is not valid. Ask for a new invitation.");
    await openPage(`#t=${TOKEN}`);
    expect(text("welcome-problem")).toBe("This invitation link is not valid. Ask for a new invitation.");
    stub([], [200, { email: "a@b.example", customerName: "Acme Ltd", status: "expired" }]);
    await openPage(`#t=${TOKEN}`);
    expect(text("welcome-problem")).toBe("This invitation has expired. Ask for a new one.");
    expect(document.getElementById("welcome-form")!.hidden).toBe(true);
    stub([], [200, { email: "a@b.example", customerName: "Acme Ltd", status: "accepted" }]);
    await openPage(`#t=${TOKEN}`);
    expect(text("welcome-problem")).toBe("This invitation has already been used. Sign in with the password you chose.");
    expect(document.getElementById("welcome-signin")!.hidden).toBe(false);
  });
});
