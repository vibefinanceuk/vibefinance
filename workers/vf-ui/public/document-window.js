/**
 * The document window's own bootstrap — decision 0384, phase 4 of
 * docs/design/document-viewer.md.
 *
 * **Deliberately thin.** Everything that draws the panel already
 * lives in viewer.js (`initDocumentWindow`, itself built from the same
 * `buildDocTabs()` the embedded card uses) — this file's whole job is
 * reading which invoice from the URL, the same way `boot.js` decides
 * which screen to show before rendering anything, and handing off.
 *
 * **A fresh module realm, not a second copy of the app's state.**
 * This page is loaded in its own window, so every module it imports —
 * viewer.js included — runs as its own instance with its own module-
 * level variables. Nothing here can collide with the opener's own
 * `stored`, `docPanelTab`, or pop-out bookkeeping, and nothing needs
 * to.
 *
 * **Watches for the main window's own mood/language button —
 * decision 0412.** This window carries neither button itself (only
 * the main window's topbar does), so the only way either setting ever
 * changes here is somebody choosing it in the *other* window while
 * this one is already open — `watchMoodChanges()`/`watchLocaleChanges()`
 * are what pick that up.
 */
import { loadStrings, applyStrings, t, watchLocaleChanges } from "/strings.js";
import { watchMoodChanges } from "/mood.js";
import { initDocumentWindow } from "/viewer.js";

async function boot() {
  watchMoodChanges();
  watchLocaleChanges();

  await loadStrings();
  applyStrings();

  const root = document.getElementById("docwindow-root");
  const invoiceId = new URLSearchParams(location.search).get("task");

  if (!invoiceId) {
    root.textContent = t("viewer.nodocument");
    return;
  }

  document.title = t("viewer.document");
  await initDocumentWindow(invoiceId, root);
}

boot();
