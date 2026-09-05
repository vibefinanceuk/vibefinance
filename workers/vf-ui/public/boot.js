/**
 * Which screen to show — decision 0103.
 *
 * **The session survives a refresh and nothing was asking.** The token
 * lives in an `HttpOnly` cookie (decision 0102), so a reload arrives
 * perfectly authenticated — and until now the page rendered an empty
 * sign-in form regardless, because it never checked.
 *
 * So: ask first, then decide. A signed-in person sees their tasks; a
 * signed-out one sees the form.
 */
import { start } from "/tasks.js";

const signIn = document.getElementById("signin-view");
const shell = document.getElementById("shell");

async function boot() {
  const signedIn = await start();

  signIn.hidden = signedIn;
  shell.hidden = !signedIn;

  // The sign-in behaviour is only loaded when it is needed. It attaches
  // listeners to fields that do not otherwise matter.
  if (!signedIn) await import("/signin.js");
}

boot();
