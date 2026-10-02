import { loadStrings, applyStrings, t } from "/strings.js";

/**
 * **Accepting an invitation — decision 0593.** Reads the token from the
 * fragment, says who the invitation is for and where, then takes the
 * 6-digit code and a chosen password. Accepted, the person signs in on
 * the usual page.
 */

const $ = (id) => document.getElementById(id);

async function post(path, body) {
  try {
    const response = await fetch(`/api${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { ok: response.ok, status: response.status, body: await response.json().catch(() => ({})) };
  } catch {
    return { ok: false, status: 0, body: {} };
  }
}

/** The refusal in words: the reason's own string where there is one. */
function why(body) {
  const key = `welcome.error.${body?.reason ?? "failed"}`;
  const words = t(key);
  if (words === key) return t("welcome.error.failed");
  return body?.reason === "wrong_code" ? words.replace("{n}", String(body.attemptsLeft ?? "")) : words;
}

export function tokenFrom(hash) {
  const m = /(?:^#|&)t=([A-Za-z0-9_-]+)/.exec(hash ?? "");
  return m ? m[1] : null;
}

export async function start() {
  await loadStrings();
  applyStrings();
  $("welcome").hidden = false;
  const token = tokenFrom(location.hash);
  const problem = $("welcome-problem");
  if (!token) {
    problem.textContent = t("welcome.error.not_valid");
    return;
  }
  const seen = await post("/invitations/view", { token });
  if (!seen.ok) {
    problem.textContent = why(seen.body);
    return;
  }
  $("welcome-sub").textContent = t("welcome.for").replace("{email}", seen.body.email).replace("{customer}", seen.body.customerName);
  if (seen.body.status !== "pending") {
    problem.textContent = why({ reason: seen.body.status });
    if (seen.body.status === "accepted") $("welcome-signin").hidden = false;
    return;
  }
  // For a password manager: which account the new password belongs to.
  $("welcome-email").value = seen.body.email;
  const form = $("welcome-form");
  form.hidden = false;
  form.onsubmit = async (event) => {
    event.preventDefault();
    problem.textContent = "";
    const password = $("welcome-password").value;
    if (password.length < 12) {
      problem.textContent = t("welcome.error.short_password");
      return;
    }
    if (password !== $("welcome-again").value) {
      problem.textContent = t("welcome.error.mismatch");
      return;
    }
    $("welcome-submit").disabled = true;
    const r = await post("/invitations/accept", { token, code: $("welcome-code").value, password });
    $("welcome-submit").disabled = false;
    if (!r.ok) {
      problem.textContent = why(r.body);
      if (r.status === 410) form.hidden = true;
      return;
    }
    form.hidden = true;
    // The link is spent; take it out of the address bar and history.
    history.replaceState(null, "", location.pathname);
    $("welcome-done").textContent = t("welcome.done").replace("{email}", r.body.email);
    $("welcome-signin").hidden = false;
  };
}

start();
