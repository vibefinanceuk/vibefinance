import { loadStrings, t, fill } from "/strings.js";

/**
 * **Accepting an invitation — decision 0717.** The code from the email and
 * a password: a new one for someone new, their own for someone who already
 * uses the network. Accepted, they are signed in and taken to their list.
 */

const $ = (id) => document.getElementById(id);

export function tokenFromHash(hash) {
  const m = /(?:^#|&)t=([A-Za-z0-9_-]{20,100})/.exec(hash ?? "");
  return m ? m[1] : null;
}

/** What a refusal says, in the person's words. */
export function refusal(status, body) {
  if (body.reason === "wrong_code") return t("network.welcome.wrongcode", { n: body.attemptsLeft ?? "" });
  if (body.reason === "wrong_password") return t("network.welcome.wrongpassword", { n: body.attemptsLeft ?? "" });
  if (body.reason === "short_password") return t("network.welcome.short");
  if (status === 410) return t("network.welcome.gone");
  if (status === 404) return t("network.welcome.invalid");
  return t("network.welcome.failed");
}

export async function start() {
  await loadStrings();
  fill();
  $("welcome").hidden = false;
  const token = tokenFromHash(location.hash);
  if (!token) {
    $("welcome-problem").textContent = t("network.welcome.invalid");
    return;
  }
  const res = await fetch("/api/invitation/view", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
  const view = await res.json().catch(() => ({}));
  if (!res.ok || view.status !== "pending") {
    $("welcome-problem").textContent = res.ok ? t("network.welcome.gone") : refusal(res.status, view);
    return;
  }
  $("welcome-sub").textContent = t("network.welcome.sub", { customer: view.customerName, supplier: view.supplierName, companies: (view.orgUnits ?? []).join(", ") });
  $("welcome-email").value = view.email ?? "";
  // Someone who already uses the network gives their own password; someone new chooses one, twice.
  $("welcome-password-label").textContent = t(view.hasLogin ? "network.welcome.existing" : "network.welcome.newpassword");
  $("welcome-password").autocomplete = view.hasLogin ? "current-password" : "new-password";
  $("welcome-again-field").hidden = !!view.hasLogin;
  $("welcome-form").hidden = false;
  $("welcome-code").focus();

  $("welcome-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("welcome-problem").textContent = "";
    const password = $("welcome-password").value;
    if (!view.hasLogin && password !== $("welcome-again").value) {
      $("welcome-problem").textContent = t("network.welcome.mismatch");
      return;
    }
    $("welcome-submit").disabled = true;
    const accepted = await fetch("/api/invitation/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, code: $("welcome-code").value, password }),
    });
    const body = await accepted.json().catch(() => ({}));
    $("welcome-submit").disabled = false;
    if (accepted.ok) {
      // The token leaves the address bar with the page.
      location.replace("/");
      return;
    }
    $("welcome-problem").textContent = refusal(accepted.status, body);
  });
}

if (!globalThis.__VF_TEST__) start();
