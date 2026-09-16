/**
 * Which screen to show — decision 0103.
 *
 * **The session survives a refresh and nothing was asking.** The token
 * lives in an `HttpOnly` cookie (decision 0102), so a reload arrives
 * perfectly authenticated — and until now the page rendered an empty
 * sign-in form regardless, because it never checked.
 *
 * So: ask first, then decide. A signed-in person sees their default
 * landing screen — the Dashboard, or Tasks for anyone who cannot see
 * one (decision 0359) — a signed-out one sees the form.
 */
import { start } from "/tasks.js";
import { loadStrings, applyStrings, t } from "/strings.js";

const signIn = document.getElementById("signin-view");
const shell = document.getElementById("shell");

async function boot() {
  // Words first. Rendering in English and then swapping would be a
  // visible flicker in whichever language the person does not read —
  // the same reasoning that hides both views until we know which one
  // to show.
  await loadStrings();
  applyStrings();
  // The product name is the customer's livery (decision 0096) and is
  // set again when one is known. This is the fallback for the moment
  // before that.
  document.getElementById("product").textContent = t("product.name");

  // Both start hidden. Whichever is right becomes visible once
  // /api/whoami answers, so nothing flashes in between — a sign-in form
  // appearing and vanishing on every refresh looks like a session
  // failing and recovering.
  const signedIn = await start();

  signIn.hidden = signedIn;
  shell.hidden = !signedIn;
  /**
   * **Set here, not by whichever screen happens to render first —
   * decision 0360.** Reported live: "It's initial width is narrow on
   * the page though. When I click tasks and then dashboard again, it
   * resizes to full width." `body`'s own default (`display: grid;
   * place-items: center`) exists to centre the sign-in form; `working`
   * switches it to the full-width layout the signed-in app itself
   * needs, and until now the only place that ever added it was
   * `tasks.js`'s own `render()` — a fact true only because `start()`
   * used to render Tasks unconditionally, before decision 0359 gave
   * it a second, equally valid destination that never touched `body`
   * at all. This is the one place that already knows, for certain,
   * whether the app is showing regardless of which screen inside it
   * renders first.
   */
  document.body.classList.toggle("working", signedIn);

  // The sign-in behaviour is only loaded when it is needed. It attaches
  // listeners to fields that do not otherwise matter.
  if (!signedIn) await import("/signin.js");
}

boot();
