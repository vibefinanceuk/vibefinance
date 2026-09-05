/**
 * Signing in — decision 0099.
 *
 * Two steps, because the environment selector cannot be populated until
 * somebody has proved who they are. Decision 0083 section 5: the
 * selector **lists what you can reach, not what the customer owns**, and
 * answering that unauthenticated would turn an email address into a map
 * of a customer's estate.
 *
 *   1. `POST /my-environments` — email and password, back comes the list
 *      of instances this person may reach.
 *   2. `POST /login` — the same credentials plus the chosen environment,
 *      back comes a session token scoped to it.
 *
 * The password is sent twice. That is deliberate rather than
 * unfortunate: the alternative is a first-stage token, which is a second
 * credential type to design, scope and expire for the sake of one round
 * trip.
 */

/**
 * Every call goes to this origin — decision 0102.
 *
 * `vf-ui` is a backend-for-frontend: it holds the session token in an
 * `HttpOnly` cookie and attaches it on the browser's behalf. So there
 * is no API address to configure, no cross-origin request, and **no
 * token anywhere JavaScript can read**.
 */

const form = document.getElementById("signin");
const emailField = document.getElementById("email");
const passwordField = document.getElementById("password");
const environmentField = document.getElementById("environment");
const submit = document.getElementById("submit");
const problem = document.getElementById("problem");
const since = document.getElementById("since");

/**
 * What the page knows about the session.
 *
 * **Not the token.** That is in a cookie this script cannot read, which
 * is the whole point of decision 0102 — an injected script cannot
 * exfiltrate what it cannot see. This holds only what the interface
 * needs to display.
 */
let session = null;

function show(message) {
  problem.textContent = message;
}

/**
 * Apply a customer's livery once one is known (decision 0096).
 *
 * The colours arrive as CSS variables and apply themselves. The **name**
 * does not: `--brand-name` is a token nothing consumes, which the first
 * screenshot showed plainly — the bar turned blue and the heading still
 * read "VibeFinance". A declared value nothing reads is the pattern this
 * project has found nine times elsewhere; it turns up in CSS too.
 *
 * Read after the stylesheet loads, because the variable does not exist
 * until it has.
 */
function applyBranding(customerId) {
  if (!customerId) return;

  const link = document.getElementById("brand");
  link.addEventListener(
    "load",
    () => {
      const name = getComputedStyle(document.documentElement)
        .getPropertyValue("--brand-name")
        .trim()
        .replace(/^"|"$/g, "");
      // textContent, never innerHTML — the value comes from an API.
      if (name) document.getElementById("product").textContent = name;
    },
    { once: true }
  );

  link.href = `/api/branding/${encodeURIComponent(customerId)}/tokens.css`;
}

/**
 * Stage one: who is this, and where may they go?
 *
 * Runs when the person leaves the password field with both filled in —
 * so the selector is populated by the time they reach it, rather than
 * making them submit twice.
 */
async function loadEnvironments() {
  const email = emailField.value.trim();
  const password = passwordField.value;
  if (!email || !password) return;

  show("");
  submit.disabled = true;

  try {
    const response = await fetch("/api/my-environments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    if (!response.ok) {
      // The same message the API gives, which is the same for every
      // failure — no account, wrong password, nothing to reach. Saying
      // more here would undo that deliberately (decision 0094).
      const body = await response.json().catch(() => ({}));
      show(body.error ?? "Sign-in failed");
      return;
    }

    const { environments } = await response.json();
    environmentField.replaceChildren();

    if (environments.length === 0) {
      // Somebody with a credential and no grant. Correct, and worth
      // saying plainly rather than presenting an empty menu.
      show("You have no instances to sign in to. An administrator can grant access.");
      return;
    }

    // One instance is the common case, and making somebody choose from
    // a list of one is a step that exists only because a list exists.
    if (environments.length === 1) environmentField.value = environments[0].id;

    for (const environment of environments) {
      const option = document.createElement("option");
      option.value = environment.id;
      option.textContent = `${environment.id} (${environment.region})`;
      option.dataset.instanceUrl = environment.instanceUrl;
      environmentField.append(option);
    }
    // Enabled only once it has something to offer. A dropdown holding
    // "Sign in to choose" that can be opened is an invitation to do
    // nothing.
    environmentField.disabled = false;

    // The customer is the part of the id before the kind, which is how
    // decision 0084 composes it.
    applyBranding(environments[0].id.split("-")[0]);
  } catch {
    show("Could not reach the sign-in service.");
  } finally {
    submit.disabled = false;
  }
}

passwordField.addEventListener("blur", loadEnvironments);

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  show("");
  since.replaceChildren();

  const environmentId = environmentField.value;
  if (!environmentId) {
    show("Choose an environment.");
    return;
  }

  submit.disabled = true;

  try {
    const response = await fetch("/api/sign-in", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: emailField.value.trim(),
        password: passwordField.value,
        environmentId,
      }),
    });

    const body = await response.json().catch(() => ({}));

    if (response.status === 429) {
      // Telling somebody to wait is not a leak — they already know the
      // attempt failed (decision 0094).
      show(`Too many recent attempts. Try again in ${body.retryAfterSeconds ?? "a moment"} seconds.`);
      return;
    }

    if (!response.ok) {
      show(body.error ?? "Sign-in failed");
      return;
    }

    // No token here. It arrived as an HttpOnly cookie and this script
    // never sees it — the response deliberately omits it.
    session = {
      expiresAt: body.expiresAt,
      environmentId: body.environmentId,
    };

    reportAttemptsSince(body);

    // Then hand over to the Task Manager. The attempts report stays
    // visible for a moment because it is the one thing a person should
    // read before moving on (ISO 27001 A.8.5) -- but a sign-in screen
    // that just sat there looked as though nothing had happened.
    const { start } = await import("/tasks.js");
    setTimeout(async () => {
      if (await start()) {
        document.getElementById("signin-view").hidden = true;
        document.getElementById("shell").hidden = false;
      }
    }, 1200);
  } catch {
    show("Could not reach the sign-in service.");
  } finally {
    submit.disabled = false;
  }
});

/**
 * What ISO 27001:2022 Annex A 8.5 asks be shown after a successful
 * sign-in.
 *
 * Not decoration. Somebody who does not recognise an attempt here knows
 * something an audit log read by nobody never tells them — which is the
 * whole reason attempts are kept after a success rather than cleared
 * (decision 0090).
 */
function reportAttemptsSince(body) {
  const lines = [];

  lines.push(
    body.lastSignedInAt
      ? `Signed in. You last signed in at ${body.lastSignedInAt}.`
      : "Signed in. This is your first sign-in."
  );

  const paragraph = document.createElement("p");
  paragraph.textContent = lines.join(" ");
  since.append(paragraph);

  const failures = body.failedAttemptsSince ?? [];
  if (failures.length === 0) return;

  const heading = document.createElement("p");
  heading.textContent =
    failures.length === 1
      ? "There was 1 failed attempt since then:"
      : `There were ${failures.length} failed attempts since then:`;
  since.append(heading);

  const list = document.createElement("ul");
  for (const attempt of failures) {
    const item = document.createElement("li");
    // textContent, never innerHTML: this is data from an API rendered
    // into a page, and a source address is exactly the field somebody
    // would try to put a script tag in.
    item.textContent = attempt.sourceIp
      ? `${attempt.attemptedAt} from ${attempt.sourceIp}`
      : attempt.attemptedAt;
    list.append(item);
  }
  since.append(list);
}

export { session };
