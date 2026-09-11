import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Signing in, and being told what went wrong — decision 0190.
 *
 * **A refusal and a failure are not the same thing.** Decision 0094's
 * rule is that every *authentication* failure gives the same message,
 * so the screen cannot be used to discover which accounts exist. A 500
 * is not an authentication failure.
 */

function mountSignIn() {
  document.body.innerHTML = `
    <main id="signin-view">
      <h1 id="product"></h1>
      <form id="signin">
        <input id="email" value="alice@acme.com">
        <input id="password" type="password" value="hunter2">
        <!-- The form refuses to submit without one, which is its own
             check and not what these tests are about. -->
        <select id="environment"><option value="Acme-production">Acme (eu)</option></select>
        <button id="submit">Continue</button>
      </form>
      <div id="problem"></div>
      <div id="since"></div>
    </main>
    <main id="shell" hidden></main>
    <main id="viewer" hidden></main>`;
}

const STRINGS = {
  locale: "en",
  strings: {
    "signin.unavailable":
      "We could not reach the sign-in service. This is not your password — please try again shortly.",
    "signin.reachedfailed":
      "Signed in, but we could not reach your environment. Please try again shortly.",
  },
};

function stubFetch(routes: Record<string, { ok: boolean; status: number; body: unknown }>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const path = String(url).split("?")[0];
      const entry = routes[path];
      if (!entry) throw new Error(`no stub for ${path}`);
      return {
        ok: entry.ok,
        status: entry.status,
        json: async () => entry.body,
      } as Response;
    })
  );
}

async function signIn(routes: Record<string, { ok: boolean; status: number; body: unknown }>) {
  stubFetch({
    "/api/ui-strings": { ok: true, status: 200, body: STRINGS },
    ...routes,
  });

  const { loadStrings } = await import("/strings.js");
  await loadStrings();
  await import("/signin.js");

  /**
   * **Blur, not submit.** `my-environments` runs when the password
   * field loses focus — that is how the environment list is filled —
   * and it was the call that returned 500 while the screen blamed the
   * password.
   */
  document
    .getElementById("password")
    ?.dispatchEvent(new Event("blur", { bubbles: true }));
  await new Promise((r) => setTimeout(r, 30));
}

beforeEach(() => {
  mountSignIn();
  vi.resetModules();
});

/**
 * **A stub that outlives its file** — decision 0227, applied to every
 * file rather than the one that had the symptom.
 *
 * `vi.stubGlobal` is not undone between files, so whichever ran next
 * inherited this one's `fetch` — and failed **depending on the order
 * the two were scheduled in**.
 */
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("when the service could not answer", () => {
  /**
   * **This is the one that cost an hour.** `vf-licence` was left
   * carrying an origin that no longer existed, `my-environments`
   * returned 500, and the screen said *"Sign-in failed"* — so a
   * correct password was retyped carefully, twice.
   */
  it("says it is not the password", async () => {
    await signIn({
      "/api/my-environments": { ok: false, status: 500, body: { error: "boom" } },
    });

    expect(document.getElementById("problem")?.textContent).toContain("not your password");
  });

  it("does not leak the upstream error", async () => {
    // A 500's body may name a binding, a table, or a stack frame.
    await signIn({
      "/api/my-environments": {
        ok: false,
        status: 500,
        body: { error: "no such column: worker_url" },
      },
    });

    expect(document.getElementById("problem")?.textContent).not.toContain("worker_url");
  });
});

describe("when the credentials were refused", () => {
  it("still gives one message for every authentication failure", async () => {
    // **Decision 0094 stands.** No account, wrong password and nothing
    // to reach must be indistinguishable, or the screen becomes a way
    // to discover which accounts exist.
    await signIn({
      "/api/my-environments": { ok: false, status: 401, body: { error: "Sign-in failed" } },
    });

    const shown = document.getElementById("problem")?.textContent ?? "";
    expect(shown).toContain("Sign-in failed");
    expect(shown).not.toContain("not your password");
  });
});
