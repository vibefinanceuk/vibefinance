/**
 * The Validation viewer — decision 0106.
 *
 * One screen for a document intake could not read: the original on the
 * left, the fields it should have yielded on the right, and the actions
 * the task says are available.
 *
 * Design reasoning in `docs/design/operator-interface.md` section 3, and
 * the mockup it is built from is
 * `docs/design/mockups/key-from-document.html`.
 */

import { t } from "/strings.js";
import { el, frame, topbar, refreshTask } from "/tasks.js";
import { icon } from "/icons.js";
import { processRow } from "/process-row.js";
import { buildActivityTab } from "/activity.js";
import { buildCollaboratorsControl } from "/collaborators.js";
import { pageViewer } from "/page-renderer.js";

let current = null;
/** The line table's working state — decision 0109. */
let lines = [];

/**
 * The current exceptions — decision 0119.
 *
 * Held so the panel and the field highlighting draw from **one
 * source**: a field marked as failing and a row explaining why must
 * never disagree, which they would the moment each kept its own copy.
 */
let exceptions = [];

/**
 * The current confirmations — decision 0400, the positive twin of
 * `exceptions`. No panel reads this (the exceptions panel is about
 * exceptions); it exists only so `markFields()` can mark a field green
 * from the same kind of source-of-truth `exceptions` already is,
 * rather than inferring "confirmed" from "not flagged" — which would
 * be true of a field no check ever looked at, not just one that passed.
 */
let confirms = [];

/** Set on open, from what the stage permits (decision 0142). */
let canEditAnything = true;

/**
 * The invoice as stored — decision 0120.
 *
 * **Fetched, not inferred from the task list.** The task list carries a
 * summary of five fields for a queue row; the keying screen needs
 * everything somebody typed, and every line. Building `existing` from
 * the summary meant a person keyed ten fields, saved, came back and saw
 * five — and reasonably concluded nothing had saved.
 */
let stored = { facts: {}, lines: [], document: null };

/**
 * Where this invoice has been — decision 0151.
 *
 * The operator's idea, from the rules screen's chevrons: **the same
 * display at the head of the viewer**, with the current stage marked
 * and how long each took beneath.
 *
 * Nothing had to be recorded for it. `stage_visits` has held a
 * timestamp per visit since decision 0009; leaving is the next visit's
 * arrival, and the duration is the gap.
 */
let progress = { inProcess: false, stages: [] };

/**
 * Which tab the document panel is showing — decision 0269.
 *
 * **Resets to "doc" per document opened**, in `openViewer()` itself,
 * the same discipline `activity.js`'s own state reset uses: arriving
 * at invoice B must not show whichever tab invoice A was left on.
 */
let docPanelTab = "doc";

async function loadProgress(invoiceId) {
  progress = { inProcess: false, stages: [] };
  try {
    const response = await fetch(`/api/invoices/${encodeURIComponent(invoiceId)}/progress`);
    if (response.ok) progress = await response.json();
  } catch {
    // A path nobody can show is not a document nobody can key. The
    // viewer works without it.
  }
}

/**
 * The chevron row, with what happened at each stage beneath.
 *
 * **Time, in the unit a person would use.** "4d 5h" and "40m", because
 * somebody scanning wants to know whether a stage took a moment or a
 * fortnight — the server decides the words, so a German customer reads
 * them in German.
 */
/**
 * **A process stopped is not a process waiting** — decision 0435.
 *
 * `progressRow()` below shows where an invoice IS; this shows why it
 * is not moving, when that reason is a real error rather than an
 * ordinary open task. Found live: a rule fired `assign_task` against
 * a stage with no declared permission, task creation was refused, and
 * the invoice sat at Validation with nothing visible to explain it —
 * indistinguishable from a document genuinely waiting on a person.
 *
 * The raw error is shown as it was recorded, not translated — this is
 * a configuration/engine detail rather than closed vocabulary like
 * `supplier.unmatchedReason`'s three reasons, so there is no fixed set
 * of strings to translate it into.
 */
function workflowErrorPanel() {
  if (!stored.workflowStageError) return null;
  return el("div", { class: "panel needsattention" }, [
    el("div", { class: "warn" }, [
      el("strong", { text: t("viewer.workflow.stageerror") }),
      el("span", { text: ` ${stored.workflowStageError}` }),
    ]),
  ]);
}

function progressRow() {
  if (!progress.inProcess || progress.stages.length === 0) return null;

  return el("div", { class: "panel" }, [
    processRow(
      progress.stages.map((stage) => ({
        ...stage,
        /**
         * **Every period, in the one box** — the operator's
         * refinement:
         *
         * > If a process stage is returned to, we do not need another
         * > box in the flow — we simply add another entry and exit
         * > timestamp in the same stage box.
         *
         * A stage entered twice took time twice, and the second time is
         * often the interesting one: it is what happened after somebody
         * sent the document back.
         */
        detail: (stage.periods ?? [])
          .map((period) =>
            period.leftAt
              ? period.duration
              : // Still here: how long it has been, rather than a blank
                // where a duration would go.
                t("progress.since").replace("{when}", shortWhen(period.enteredAt))
          )
          .filter(Boolean)
          .join(" · "),
      })),
      progress.currentStageId,
      // **No handler.** A chevron here reports where the document has
      // been; it is not a place to send it.
      null
    ),
  ]);
}

/** A timestamp somebody can read at a glance. */
function shortWhen(when) {
  if (!when) return "";
  return when.slice(0, 16).replace(" ", " ");
}

export async function loadInvoice(invoiceId) {
  stored = { facts: {}, lines: [], document: null };
  exceptions = [];
  confirms = [];
  try {
    const response = await fetch(`/api/invoices/${encodeURIComponent(invoiceId)}`);
    if (!response.ok) return;
    const body = await response.json();
    stored = {
      facts: body.facts ?? {},
      lines: body.lines ?? [],
      document: body.document ?? null,
      // The original specifically, for the XML tab — decision 0273.
      originalDocument: body.originalDocument ?? null,
      // The embedded XML of a hybrid PDF, for the same tab — decision
      // 0383. Present only for a Factur-X/ZUGFeRD invoice; null for
      // everything else, same as originalDocument above for a PDF or
      // image original.
      embeddedXmlDocument: body.embeddedXmlDocument ?? null,
      // Whether the document could be read at all — decision 0161.
      intake: body.intake ?? null,
      // Who we matched this invoice to — decision 0219.
      supplier: body.supplier ?? null,
      // And which of our own units it is for — decision 0224.
      buyer: body.buyer ?? null,
      buyerUnplaced: body.buyerUnplaced ?? null,
      // Why processing stopped, where it did — decision 0435.
      workflowStageError: body.workflowStageError ?? null,
      /**
       * **Which unit this document belongs to** — decision 0198, and
       * kept because it decides which fields may be edited (decision
       * 0197). Reported by the route since decision 0036 and read by
       * nothing until now.
       */
      orgUnitId: body.orgUnitId ?? null,
    };
    // **What is wrong on arrival**, not only after saving. Somebody
    // opening a document with three failures should be told, rather
    // than having to change something first (decision 0119).
    exceptions = body.validation?.involves ?? [];
    // decision 0400's own green tier, the same "on arrival" reasoning.
    confirms = body.validation?.confirms ?? [];
  } catch {
    // An empty form is wrong, and a form showing another invoice's
    // values would be worse.
  }
}

/**
 * The standard's own code lists — decision 0113.
 *
 * Fetched once and held, because they are the same for every invoice
 * and every customer. **A dropdown rather than a text box**: `EUR` is
 * valid, `EURO` and `eur` are not, and a person typing a currency
 * should not have to know which.
 */
let codeLists = {};

async function loadCodeLists() {
  if (Object.keys(codeLists).length > 0) return;
  try {
    const response = await fetch("/api/code-lists");
    if (response.ok) codeLists = (await response.json()).fields ?? {};
  } catch {
    // A text box is worse than a dropdown and better than no screen.
  }
}


/**
 * The convenience columns `invoice_lines` also stores.
 *
 * They are **derived from the facts**, not typed separately: the item
 * name is the description a person reads back, and the line net amount
 * is the amount. Letting somebody type them independently is how a
 * column and a fact come to disagree.
 */
function columnsFor(line) {
  return {
    description: String(line["BT-153"] ?? "").trim(),
    amount: line["BT-131"] === "" || line["BT-131"] === undefined ? null : Number(line["BT-131"]),
    costCentre: String(line["BT-133"] ?? "").trim() || undefined,
  };
}

/**
 * What this stage shows, and what may be edited — decision 0114.
 *
 * **Fetched, not hardcoded.** Both lists here were constants until the
 * configuration existed, which made a customer's arrangement of their
 * own screen unreachable. The resolver's `line` flag says which belong
 * to a line, so the interface keeps no second list of its own — one
 * that would drift the first time a line field was added.
 */
let headerFields = [];
let lineFields = [];

async function loadFields(stageId, unitId) {
  try {
    const parts = [];
    if (stageId) parts.push(`stage=${encodeURIComponent(stageId)}`);
    // Absent means the group's answer, which is what every caller got
    // before decision 0198.
    if (unitId) parts.push(`unit=${encodeURIComponent(unitId)}`);
    const query = parts.length > 0 ? `?${parts.join("&")}` : "";
    const response = await fetch(`/api/field-visibility${query}`);
    if (!response.ok) return;
    const { fields } = await response.json();
    headerFields = fields.filter((f) => !f.line);
    lineFields = fields.filter((f) => f.line);
  } catch {
    // Rendering nothing is honest; guessing a field list is not.
  }
}




/**
 * An input, or a picker where the standard closes the value.
 *
 * The **empty option matters**: a field a document did not supply must
 * stay unset rather than silently acquire the first code in the list.
 * Absent and "the first currency alphabetically" are very different
 * claims about a document.
 */
function codeInput(code, id, value) {
  const list = codeLists[code];
  if (!list) return null;

  const select = el("select", { id });
  select.append(el("option", { value: "", text: "—" }));
  for (const entry of list.codes) {
    // The code and its name together: `C62` means nothing without
    // "One (unit)" beside it.
    select.append(el("option", { value: entry.code, text: `${entry.code} · ${entry.label}` }));
  }
  select.value = value ?? "";

  // A value a document carried that the list does not know. Kept and
  // shown rather than silently dropped — losing what a supplier sent
  // would be worse than displaying something unfamiliar.
  if (value && !list.codes.some((entry) => entry.code === value)) {
    const unknown = el("option", { value, text: `${value} · not in ${list.id}` });
    select.append(unknown);
    select.value = value;
  }
  return select;
}

/**
 * @param options.id Override for the control's own DOM id, `f-${field}`
 * by default. Used when the same field needs a second, genuinely
 * distinct rendering elsewhere on the page — decision 0293's own
 * pop-out copy of a field the card already shows, which must not
 * share the card's own id.
 * @param options.forceReadOnly Renders read-only text regardless of
 * the field's own visibility. For the same pop-out copy: the field is
 * already editable on the card, and a second, differently-id'd
 * `<input>` for it would be a real one `save()` never reads from,
 * since that only ever looks for `f-${field}` by its own, singular
 * name — an edit typed into a second copy would look accepted and
 * then silently not exist.
 */
function field(spec, existing, options = {}) {
  const value = existing?.[spec.field] ?? "";
  const id = options.id ?? `f-${spec.field}`;

  /**
   * A read-only field is **text, not a disabled input** — decision
   * 0114.
   *
   * A greyed-out box invites clicking and reads as broken. Plain text
   * says the value is information rather than something to change,
   * which is what `read` means: *"approvers should approve data, not
   * edit data."*
   *
   * **`!canEditAnything` joins the field's own visibility, decision
   * 0288.** Without it, a field the stage marks `edit` rendered as a
   * real `<input>` for anyone who could open the task at all —
   * unclaimed or someone-else's-locked included, since this only ever
   * asked the field what it allowed, never who was asking. The
   * `canEditAnything` flag above already answers that; a field
   * ignoring it once it had rendered would leave every input on
   * screen editable-looking with nowhere to save the result, which is
   * a worse state than either read-only or genuinely editable.
   */
  const control =
    spec.visibility === "read" || !canEditAnything || options.forceReadOnly
      ? el("div", {
          class: "readonly",
          id,
          text: value === "" ? "—" : String(value),
        })
      : codeInput(spec.field, id, value) ??
        el("input", {
          type: spec.type === "number" ? "number" : spec.type === "date" ? "date" : "text",
          id,
          step: spec.type === "number" ? "0.01" : undefined,
          // What is already known is shown, so somebody correcting one
          // value does not have to retype the rest.
          value,
        });

  return el("div", { class: "kf" }, [
    // Labels by key, so a customer's language reaches the fields too.
    el("label", {
      for: id,
      // The vocabulary's own description as a tooltip, so an
      // unfamiliar code is explicable without leaving the screen.
      title: spec.description,
      text: t(`field.${spec.field.toLowerCase()}`),
    }),
    control,
  ]);
}

/**
 * A signed URL for the retained original — decision 0073.
 *
 * Minted on demand rather than held, because it expires in five minutes
 * and a URL fetched at render time would be stale before somebody
 * pressed anything.
 */
async function documentUrl(invoiceId, type) {
  const qs = type ? `?type=${encodeURIComponent(type)}` : "";
  const response = await fetch(`/api/invoices/${encodeURIComponent(invoiceId)}/document-url${qs}`, {
    method: "POST",
  });
  if (!response.ok) return null;
  return (await response.json()).url ?? null;
}

/**
 * Expand into a page of our own, not the raw file — decision 0384,
 * phase 4 of `docs/design/document-viewer.md`.
 *
 * **Retires decision 0073's `window.open(rawSignedUrl)`.** That opened
 * a blank tab with no app chrome at all — no tabs, no Timeline/Chat,
 * nothing but the bytes. `document-window.html` is a second real page
 * of this app, same origin, same session cookie, so it fetches and
 * renders the document exactly as the embedded panel does — the
 * signed-URL scheme decision 0073 built still does the one job it was
 * ever for, minting a link for the *bytes*, not for the chrome around
 * them.
 *
 * **One window, always, never several.** The operator's own answer
 * when this phase was scoped: *"The user's attention should only ever
 * be on one document/task... there should not be a situation where
 * the user has multiple pop-out windows open."* A fixed name
 * (`POPOUT_NAME`) makes the browser itself enforce that — `window.
 * open(url, name)` navigates whichever window already has that name
 * rather than opening a new one, even if `popoutHandle` below had
 * somehow been lost.
 */
/**
 * Exported so any other page can target the same named window with a
 * plain `<a target={POPOUT_NAME}>` — the browser itself then reuses or
 * focuses this exact window if one is already open, no JS required,
 * the same "one window, always" guarantee this constant already gives
 * `openDocumentWindow` below. Decision 0430's sixth addendum, for the
 * AP Assistant's own document links (`ap-assistant.js`), so a link
 * clicked from chat can never spawn a second pop-out competing with
 * one the Documents screen's own Expand button already opened.
 */
export const POPOUT_NAME = "vibefinance-document-window";
/** The open pop-out's own window handle, or null if none is open. */
let popoutHandle = null;
/** Which invoice the pop-out is currently showing, to skip a pointless re-navigation to the page it is already on. */
let popoutInvoiceId = null;
/** Set by `documentPanel()` on every render — toggles its own "open elsewhere" placeholder. Module-level because the poll below and `openDocumentWindow()` are not the code that built the panel currently on screen. */
let popoutStateSetter = null;
let popoutClosedPoll = null;

function popoutUrl(invoiceId) {
  return `/document-window.html?task=${encodeURIComponent(invoiceId)}`;
}

function popoutIsOpen() {
  return Boolean(popoutHandle && !popoutHandle.closed);
}

/**
 * Poll for the pop-out closing.
 *
 * `window.open` gives no event for "the other window just closed" —
 * `.closed` is the only signal there is, and it only answers when
 * asked. A short interval rather than nothing: the main window's
 * document card should not go on claiming a window is open once it
 * plainly is not, whether that window closed by its own Close button,
 * the operating system's, or the tab simply being shut.
 */
function watchPopout() {
  if (popoutClosedPoll) return;
  popoutClosedPoll = setInterval(() => {
    if (!popoutIsOpen()) {
      clearInterval(popoutClosedPoll);
      popoutClosedPoll = null;
      popoutHandle = null;
      popoutInvoiceId = null;
      popoutStateSetter?.(false);
    }
  }, 700);
}

/**
 * The Expand button's own action now — open, or bring forward, the one
 * document window.
 */
function openDocumentWindow(invoiceId) {
  if (popoutIsOpen() && popoutInvoiceId === invoiceId) {
    popoutHandle.focus();
    return;
  }
  popoutHandle = window.open(popoutUrl(invoiceId), POPOUT_NAME);
  if (!popoutHandle) {
    note(t("viewer.popupblocked"));
    return;
  }
  popoutInvoiceId = invoiceId;
  popoutHandle.focus();
  popoutStateSetter?.(true);
  watchPopout();
}

/**
 * Retarget an already-open pop-out the moment a different task opens
 * — the operator's own answer, verbatim: *"if another task is opened
 * and the document window is popped-out and showing a previous
 * document, the same window should open the new document for the new
 * task."* Ordinary navigation, the same as clicking Expand would do;
 * no `postMessage`, no `BroadcastChannel` — the pop-out is just
 * another page that reads its invoice id from its own URL on load, so
 * pointing it at a new URL is the whole mechanism.
 */
function retargetPopoutIfOpen(invoiceId) {
  if (!popoutIsOpen() || popoutInvoiceId === invoiceId) return;
  popoutInvoiceId = invoiceId;
  popoutHandle.location.href = popoutUrl(invoiceId);
}

/**
 * Mount the whole document panel into a page of its own — decision
 * 0384, phase 4. `document-window.js` calls this once, after loading
 * strings the same way `boot.js` loads them for the main shell — this
 * function assumes `t()` already has words to give it, the same
 * assumption every other function in this file already makes.
 *
 * **The same `buildDocTabs()` the embedded panel uses, not a second
 * copy of it.** A pop-out that rendered its own idea of the Document/
 * XML/Timeline-Chat tabs could drift from what Expand promised to
 * open; this way it cannot, because there is only the one
 * implementation.
 *
 * No placeholder wiring here — that toggle exists to give the
 * *embedded* card something to show while it has handed its space to
 * this window; this window has no second window of its own to hand
 * anything to.
 *
 * **Timeline / Chat is a standing right-hand column here, not a third
 * tab** — decision 0394, asked for directly: *"the timeline / chat
 * should appear on the right of the invoice image... when expanded in
 * the separate window only."* Still built from `buildDocTabs()`'s own
 * unmodified `tabs` array — the pop-out pulls the `timeline` entry out
 * of the tab row and always shows its pane, rather than
 * `buildDocTabs()` growing a second layout mode the embedded card
 * would have to ignore. The shared `select()` closure (inside
 * `buildDocTabs()`) still loops over *every* entry when Document or
 * XML is clicked, timeline included, hiding whatever is not the
 * clicked key — so each remaining button's own handler re-shows the
 * timeline pane immediately after, the one place this function reaches
 * back into what `select()` did rather than around it.
 */
export async function initDocumentWindow(invoiceId, root) {
  await loadInvoice(invoiceId);
  docPanelTab = "doc";

  const { tabs } = buildDocTabs(invoiceId);
  const closeButton = actionLink("close", { onclick: () => window.close() });

  const timelineEntry = tabs.find((entry) => entry.key === "timeline");
  const otherEntries = tabs.filter((entry) => entry.key !== "timeline");

  if (timelineEntry) {
    timelineEntry.pane.hidden = false;
    timelineEntry.pane.classList.add("docwindowtimeline");
    for (const entry of otherEntries) {
      const selectThisTab = entry.button.onclick;
      entry.button.onclick = () => {
        selectThisTab();
        timelineEntry.pane.hidden = false;
      };
    }
  }

  const splitRow = timelineEntry
    ? el("div", { class: "docwindowsplit" }, [
        el(
          "div",
          { class: "docwindowsplitleft" },
          otherEntries.map((entry) => entry.pane)
        ),
        el("div", { class: "docwindowsplitright" }, [timelineEntry.pane]),
      ])
    : null;

  root.replaceChildren(
    el("div", { class: "panel" }, [
      el("div", { class: "cardhead" }, [
        el("div", { class: "doctabs" }, otherEntries.map((entry) => entry.button)),
        closeButton,
      ]),
      // Falls back to the plain, un-split layout `tabs.map()` always
      // built when there is no timeline entry to split out — not
      // expected in practice (every document has a Timeline / Chat
      // pane), but this function should not assume it.
      ...(splitRow ? [splitRow] : tabs.map((entry) => entry.pane)),
    ])
  );

  // Not awaited, matching `openViewer()`'s own reasoning: the tabs are
  // usable while a slow R2 fetch is still in flight.
  showPreview(invoiceId, stored.document?.contentType);
  showXmlPreview(invoiceId);
}

/**
 * The document, in the panel — decision 0382, phase 2 of
 * `docs/design/document-viewer.md`, replacing the `<img>`/`<iframe>`
 * split decision 0123 built.
 *
 * **We render it now, not the browser.** `pageViewer()`
 * (`page-renderer.js`) draws every page — a multi-page pending-document
 * invoice's own retained pages (decision 0381), or a single retained
 * document, image or PDF — into a canvas with our own thumbnail rail,
 * zoom and rotate, the same controls regardless of which kind of
 * document this is.
 *
 * **This also retires decision 0380's whole problem, rather than
 * fixing it again here.** That frame's five-minute link could go stale
 * while a person sat looking at it, because an `<iframe>` is a live
 * connection to a URL. A canvas is pixels already drawn — nothing
 * reloads it, so nothing can ask a token that has since expired. The
 * link is used once, at load, and never held open.
 *
 * **A generated rendering is neither** — decision 0406. `resolvePages()`
 * only knows `pdf` and "everything else is an image": a UBL invoice's
 * `generated_rendering` (decision 0205, `text/html`) has no page count
 * pdf.js can read and cannot be decoded as an image either, so it fell
 * into the plain-image branch, tried to load HTML through `new
 * Image().src`, and failed silently — a document that genuinely existed
 * in R2 and simply never appeared. Nobody had ever seen this case
 * before today: rendering itself never once succeeded until decision
 * 0405, so this gap was invisible the whole time 0380–0382 were built.
 * Routed to `documentFrame()` instead — the same signed-URL-refresh
 * iframe `showXmlPreview()` already uses below, since an HTML page is
 * exactly what an iframe is for and nothing about it benefits from a
 * thumbnail rail, zoom or rotation built for a scanned photograph.
 */
async function showPreview(invoiceId, type) {
  const holder = document.getElementById("vpreview");
  if (!holder) return;

  if (/html/i.test(type ?? "")) {
    const url = await documentUrl(invoiceId);
    if (!url) {
      holder.replaceChildren(el("div", { class: "vthumb", text: t("viewer.nodocument") }));
      return;
    }
    holder.replaceChildren(
      documentFrame(url, () => documentUrl(invoiceId), { class: "vframe", title: t("viewer.document") })
    );
    return;
  }

  holder.replaceChildren(pageViewer(invoiceId, type));
}

/**
 * A frame that asks for a fresh signed URL whenever it loads again —
 * decision 0380.
 *
 * **The signal is the frame's own `load` event, not a timer and not
 * the tab becoming visible.** Measured in a real Chromium against a
 * server refusing expired links the way `vf-app` does: hiding and
 * showing the pane, scrolling the PDF, resizing, CSS zoom, printing
 * and switching tabs away and back requested nothing at all — the
 * frame kept showing the document long after its URL had expired. Only
 * a frame that loaded again (moved in the page, or reloaded from its
 * own context menu) asked the server a second time, and got the error.
 *
 * So refreshing on a timer, or on returning to the tab as this file's
 * comment once claimed, would **reload a frame that was working** —
 * throwing away where somebody had scrolled to and how far they had
 * zoomed, every time they came back from another window — to fix
 * nothing.
 *
 * **Any load the viewer did not cause gets a fresh URL.** No expiry
 * arithmetic, so no clock on this machine to disagree with the one
 * that signed the token and no second copy of `TOKEN_TTL_SECONDS` to
 * drift from the first. A frame that reloads while its link is still
 * valid gets minted one it did not strictly need — one extra request,
 * on an event that measurement found rare.
 *
 * **It cannot loop.** The replacement URL is set by the viewer, so its
 * own load is expected and ignored — even if that load fails too. And
 * a mint that comes back empty (the document gone, the session gone)
 * leaves the frame as it is rather than retrying.
 */
function documentFrame(firstUrl, mint, attributes) {
  const frame = el("iframe", attributes);
  let expectingLoad = false;

  const point = (url) => {
    expectingLoad = true;
    frame.src = url;
  };

  frame.addEventListener("load", async () => {
    if (expectingLoad) {
      expectingLoad = false;
      return;
    }
    const url = await mint();
    if (url) point(url);
  });

  point(firstUrl);
  return frame;
}

/**
 * The XML tab's own content — decision 0273, widened by decision 0383.
 *
 * **Always an iframe, never an image.** Unlike `showPreview()`, there
 * is no image case to branch on: the document this asks for is only
 * ever fetched when `documentPanel()` has already checked, before this
 * tab is even offered, that one of the two XML-shaped types below
 * genuinely exists.
 *
 * **Which type, decided once, here — not guessed from content type.**
 * A bare-XML invoice's own `original` is the XML; a hybrid PDF's
 * `original` is the outer PDF, and its XML is the separate
 * `embedded_xml` artifact decision 0383 added. `stored.embeddedXmlDocument`
 * says which invoice this is, the same fact `documentPanel()` already
 * read to decide whether to offer this tab at all.
 */
async function showXmlPreview(invoiceId) {
  const holder = document.getElementById("vxml");
  if (!holder) return;

  const type = stored.embeddedXmlDocument ? "embedded_xml" : "original";
  const url = await documentUrl(invoiceId, type);
  if (!url) {
    holder.replaceChildren(el("div", { class: "vthumb", text: t("viewer.nodocument") }));
    return;
  }

  holder.replaceChildren(
    documentFrame(url, () => documentUrl(invoiceId, type), { class: "vframe", title: t("viewer.xmltab") })
  );
}

function note(message) {
  const box = document.getElementById("viewer-note");
  if (box) box.textContent = message;
}

/**
 * The running comparison — decision 0109.
 *
 * **Advisory, never blocking.** An invoice whose lines do not sum to
 * its printed total is a fact to record faithfully, not an input to
 * prevent — the same principle decision 0072 established for
 * validation, applied where a person can see it.
 *
 * It says what it found. It does not stop anybody saving.
 */
function updateTotals() {
  const summed = lines.reduce((total, line) => total + (Number(line["BT-131"]) || 0), 0);
  const printed = Number(document.getElementById("f-BT-112")?.value) || 0;

  const box = document.getElementById("linetotal");
  if (!box) return;

  const difference = Math.round((summed - printed) * 100) / 100;
  box.textContent =
    printed === 0
      ? `${t("viewer.linetotal")} ${summed.toFixed(2)}`
      : `${t("viewer.linetotal")} ${summed.toFixed(2)} · ${
          difference === 0 ? t("viewer.matches") : `${t("viewer.differs")} ${difference.toFixed(2)}`
        }`;
  box.className = difference === 0 || printed === 0 ? "linetotal" : "linetotal off";
}

function lineRow(line, index) {
  const cell = (spec) => {
    /**
     * **`canEditAnything` joins the field's own visibility here too** —
     * decision 0402's follow-up. `field()` (the header) already checks
     * it (decision 0142/0288: a document must be claimed to be edited,
     * not just opened); this line-table cell only ever checked the
     * field's own visibility, so an unclaimed document's line items
     * stayed editable — and saveable — while its header correctly went
     * read-only. Same shape as the bug `read-only-stage.test.ts`
     * documents for a stage's own read-only flag: a check added to the
     * header and never carried to the line table.
     */
    if (spec.visibility === "read" || !canEditAnything) {
      return el("td", {}, [el("div", { class: "readonly", text: line[spec.field] ?? "—" })]);
    }

    // BT-130 is a UN/ECE code, so the line table picks one too.
    const picker = codeInput(spec.field, undefined, line[spec.field]);
    const input =
      picker ??
      el("input", {
        type: spec.type === "number" ? "number" : "text",
        step: spec.type === "number" ? "0.01" : undefined,
        value: line[spec.field] ?? "",
      });

    input.addEventListener(picker ? "change" : "input", (event) => {
      line[spec.field] = event.target.value;
      updateTotals();
    });

    // BT-130 is three characters, so its column is narrow.
    return el("td", { class: spec.field === "BT-130" ? "short" : undefined }, [input]);
  };

  return el("tr", {}, [
    ...lineFields.map(cell),
    el("td", { class: "lineactions" }, [
      /**
       * **Always shown, not gated on `canEditAnything`** — decision
       * 0453, the same reasoning `headerSummary()`'s own "Header
       * Fields" action already carries: looking up a line's own coding
       * is not an edit, so it stays reachable on a read-only stage too
       * (the pop-out itself still refuses to change anything nothing
       * configured editable permits, the same as every field already
       * does — see `openLineCodingPopout`).
       */
      (() => {
        const button = el("button", { class: "rm", title: t("action.coding"), onclick: () => openLineCodingPopout(line) });
        button.append(icon("coding"));
        return button;
      })(),
      /**
       * **Structure, not a field** — decision 0144.
       *
       * Field visibility governs fields. Adding and removing a line
       * changes the shape of the document, and nothing governed it —
       * so an approver on a read-only stage could add a line and save
       * it, with every field on that line rendered as text.
       */
      ...(canEditAnything
        ? [
            el("button", {
              class: "rm",
              text: "×",
              title: t("viewer.removeline"),
              onclick: () => {
                lines.splice(index, 1);
                renderLines();
                renderExceptions();
              },
            }),
          ]
        : []),
    ]),
  ]);
}

/**
 * **The Coding pop-out's own four fields — decision 0453.** Cost
 * Centre keeps its own dedicated table and route (`ledger-route.ts`'s
 * `handleListCostCentresDetailed`); Project, Commodity Code, and
 * General Ledger Code share the generic one (`coding-list-route.ts`'s
 * `handleListCodingListEntries`) — `listType` says which, so
 * `fetchCodingEntries` (below) can tell without a second lookup.
 *
 * `filterKeys` is exactly `coding_list_type_filters`'s own declared
 * shape (migration 0076): General Ledger Code is the only field
 * "linked" to two others; Project and Commodity Code declare no
 * filter at all and are offered unnarrowed, the same as their own
 * AP Setup picker (`coding-lists.js`'s `openCodingEntryForm`) already
 * does.
 */
const CODING_PICKER_FIELDS = [
  { field: "BT-133", listType: "cost_centre", filterKeys: [] },
  { field: "coding.project", listType: "project", filterKeys: [] },
  { field: "coding.commodity_code", listType: "commodity_code", filterKeys: [] },
  { field: "coding.gl_code", listType: "gl_code", filterKeys: ["company_code", "commodity_code"] },
];

/**
 * A `filterKeys` entry's own display label — decision 0459, so a
 * filtered field's own "no matches" note (`searchableEntryPicker`'s
 * `scopeNote`) can name what narrowed it in words a person already
 * reads elsewhere (AP Setup's own Account Coding tab uses these same
 * two keys).
 */
const FILTER_FIELD_LABEL_KEYS = {
  company_code: "apsetup.codingtab.companycode",
  commodity_code: "apsetup.codingtab.commoditycode",
};

/**
 * One read, for whichever of the four lists a picker asks about —
 * decision 0453. Cost Centre's own richer route returns
 * `{costCentres: [...]}`; the other three's shared route returns
 * `{entries: [...]}` — normalised here to the one shape a picker
 * actually needs, `{id, name}[]`, so `searchableEntryPicker` itself
 * never has to know which kind of list it is showing.
 *
 * **Read-only, `AP.Validate`-gated on the server** (decision 0453's
 * own widening of both routes' own permission check) — this is a
 * person keying a line, not configuring Account Coding, so it never
 * calls either route's own `Admin.Configure`-only write side.
 */
async function fetchCodingEntries(listType, search, filters = {}) {
  const params = new URLSearchParams({ search, pageSize: "25" });
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(`filter.${key}`, value);
  }
  const url =
    listType === "cost_centre"
      ? `/api/org/cost-centres?${params}`
      : `/api/coding-lists/${listType}?${params}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error();
  const body = await response.json();
  return (listType === "cost_centre" ? body.costCentres : body.entries).map((e) => ({ id: e.id, name: e.name }));
}

/**
 * Account Coding suggestions for the invoice currently open — decision
 * 0457, Phase 1 of the autocode idea the operator raised. One call per
 * pop-out open, not per field: the route already computes all four at
 * once. Failure is silent and falls back to no suggestions at all —
 * the pop-out is fully usable without this, exactly as it was before
 * this decision, so a suggestion that can't be fetched should never
 * block the person from coding the line by hand.
 */
async function fetchCodingSuggestions() {
  try {
    const response = await fetch(`/api/invoices/${encodeURIComponent(current.subject.id)}/coding-suggestions`);
    if (!response.ok) return {};
    const body = await response.json();
    return body.suggestions ?? {};
  } catch {
    return {};
  }
}

/**
 * **One results area, shared by every field in the pop-out** —
 * decision 0458. Before this, each field owned its own results list,
 * so the pop-out's own size grew and shrank on every keystroke —
 * reported live, from a mock-up, as unwanted flex. Now there is one
 * `resultsList`/`resultsLabel` pair, and whichever field was searched
 * most recently owns it.
 *
 * **`next()`/token, not a per-field "only the newest answer counts"
 * guard** — the previous per-field version (each picker kept its own
 * `latest` counter) is no longer enough once the results area is
 * shared: a slow fetch from a field the person has since left could
 * otherwise land after a fast fetch from the field they moved to and
 * silently overwrite it. Every field asks this controller for a token
 * before it starts fetching and presents that same token when it's
 * ready to show or clear; a token that is no longer the newest one
 * issued is a stale answer and is dropped, regardless of which field
 * it came from.
 */
function codingResultsController(resultsLabel, resultsList) {
  let generation = 0;
  return {
    next: () => ++generation,
    // Reads the current token without minting a new one — decision
    // 0460's own `onfocus` uses this to tell "nothing else has
    // searched since I was asked to" from "somebody moved on while I
    // was waiting," the one case the token guard below cannot catch by
    // itself: a *new*, genuinely-latest request triggered late by a
    // stale event, not a slow answer to an old one.
    peek: () => generation,
    show(token, fieldLabel, children) {
      if (token !== generation) return;
      resultsLabel.textContent = `${t("viewer.coding.resultsfor")} ${fieldLabel}`;
      resultsList.replaceChildren(...children);
    },
    clear(token) {
      if (token !== generation) return;
      resultsLabel.textContent = "";
      resultsList.replaceChildren();
    },
  };
}

/**
 * A single search-as-you-type field, embedded in a form rather than
 * `openSearch()`'s own full pop-out — decision 0453. **Not a second
 * copy of that debounce-free "only the newest answer counts" guard**;
 * restated here because `openSearch` itself always closes the whole
 * pop-out and reopens the document on a choice (right for changing the
 * Seller or Buyer, wrong here — choosing a Cost Centre should not
 * close a form with three more fields still to fill in).
 *
 * `resolveCurrent`, called once at build time, turns the line's own
 * already-keyed raw id into a readable name for the box to start
 * with — the same "shown, not silently dropped" courtesy `codeInput`
 * already gives a BT-130 unit code the active list does not know.
 *
 * `fieldLabel` and `results` (a `codingResultsController`) are new in
 * decision 0458 — this field no longer owns its own results list, only
 * the input and its clear button; what it finds is shown in the
 * pop-out's one shared area instead, labelled with `fieldLabel` so
 * it's unambiguous which field a click there will fill.
 *
 * **Every field shows its own first 25 the moment it gets focus, not
 * only once somebody has typed — decision 0460.** The operator's own
 * ask: *"automatically show the first 25 available rows, when a Line
 * coding element has focus, limited by what is already typed into the
 * box, but if nothing is typed simply show available fields."*
 * `runSearch` is the one place that happens, called with whatever the
 * box already holds (`input.value` — empty, or partially typed) both
 * from `onfocus` and from `oninput`, so focusing and typing are the
 * same code path rather than two that could drift apart. This also
 * replaces decision 0459's own dedicated `preload` flag, which only
 * ever covered Cost Centre on the pop-out's own initial open — that
 * case still works exactly as before, since `openLineCodingPopout`'s
 * own `.focus()` call on that field dispatches a real `focus` event,
 * which this now already handles generally. **No minimum length any
 * more** — a single typed character, or none, both now search
 * (a blank query is exactly the list's own first page, the same
 * request the server already serves for "no search clause").
 * `onfocus` also waits for `resolveCurrent`'s own rename (below) to
 * settle first, so a field opened already holding a value never has a
 * fleeting moment where it searches on the raw id still sitting in the
 * box rather than the name about to replace it there.
 *
 * **`scopeNote`, decision 0459** — read live at search time, the same
 * reason `filters()` itself is a closure rather than a value: a field
 * whose results come back empty because it is narrowed by another
 * field (General Ledger Code, by Company Code and Commodity Code)
 * should say so, rather than look identical to a field with no
 * narrowing at all that simply has no matching entries. Returns the
 * currently-active filter labels, or an empty array for none.
 */
function searchableEntryPicker({ current, hint, fetchResults, resolveCurrent, onChoose, fieldLabel, results, scopeNote = () => [] }) {
  const input = el("input", { type: "text", class: "searchbox", placeholder: hint, value: current ?? "" });

  const runSearch = async (q) => {
    const token = results.next();
    try {
      const found = await fetchResults(q);
      if (found.length === 0) {
        const activeScopes = scopeNote();
        results.show(token, fieldLabel, [
          el("div", { class: "codingresultsempty muted", text: t("viewer.coding.nomatches") }),
          ...(activeScopes.length
            ? [el("div", { class: "codingresultsempty muted sm", text: `${t("viewer.coding.nomatchesscoped")} ${activeScopes.join(", ")}` })]
            : []),
        ]);
        return;
      }
      results.show(
        token,
        fieldLabel,
        found.map((item) => {
          const row = el("button", { class: "searchresult", title: item.name }, [
            el("span", { class: "resultname", text: item.name }),
            el("span", { class: "resultid muted", text: item.id }),
          ]);
          row.onclick = () => {
            input.value = item.name;
            results.clear(results.next());
            onChoose(item);
          };
          return row;
        })
      );
    } catch {
      results.show(token, fieldLabel, [el("div", { class: "codingresultsempty warn", text: t("viewer.coding.searchfailed") })]);
    }
  };

  const clearButton = el("button", {
    class: "rm",
    text: "×",
    title: t("viewer.coding.clear"),
    onclick: () => {
      input.value = "";
      onChoose(null);
      // Empty now, so the same "nothing typed" rule applies as a fresh
      // focus would — the field's own first page, not a blanked panel.
      runSearch("");
    },
  });

  // **Resolved before the box's own first focus-triggered search reads
  // it — decision 0460.** Without this, Cost Centre's own auto-focus
  // (decision 0459) can fire while this is still in flight, and
  // `onfocus` below would search on the raw id sitting in the box
  // rather than the name the person is about to see replace it — a
  // narrower, coincidental result rather than the field's own genuine
  // first page.
  const currentResolved =
    current && resolveCurrent
      ? resolveCurrent()
          .then((match) => {
            if (match) input.value = match.name;
          })
          .catch(() => {
            // The raw id stays in the box — shown, not silently dropped.
          })
      : Promise.resolve();

  input.oninput = () => runSearch(input.value);
  input.onfocus = async () => {
    const seenGeneration = results.peek();
    await currentResolved;
    // Something else has already searched while this was waiting on
    // `currentResolved` — the person moved on before it settled, so
    // this focus event is stale and must not now issue the "newest"
    // request and steal the results area back.
    if (results.peek() !== seenGeneration) return;
    runSearch(input.value);
  };

  return el("div", { class: "codingsearch" }, [input, clearButton]);
}

/**
 * **The invoice-line Coding pop-out** — decision 0453, the operator's
 * own ask: *"a pop-out, that is accessible from a Coding icon on the
 * invoice line... show the Org / Company Code and optional Cost
 * Center or Project, then provide the linked Commodity and General
 * Ledger Code. Each should expose a searchable drop-down that searches
 * across the already created Account Coding lists."*
 *
 * **Additive, not a replacement** for the line table's own generic
 * inline `<input>` (see `cell()`) — decided in the decision doc
 * itself rather than here: both read and write the exact same
 * `line[spec.field]`, so either entry point works and neither can
 * drift from the other. A field not configured `edit` at this stage
 * renders read-only here too, the same rule `cell()` already applies
 * — this pop-out has no route of its own into a field's own
 * visibility, only into its value.
 *
 * **`Save` reads `line[spec.field]` the moment it runs, from
 * anywhere** — this pop-out never calls `/key` itself. Choosing a
 * value here sets the same in-memory field the inline cell already
 * writes to, so the page's own existing Save button persists it,
 * exactly the way it already persists every other line field.
 */
async function openLineCodingPopout(line) {
  const suggestions = await fetchCodingSuggestions();

  const chosen = {};
  // Which fields are showing a suggestion nobody has confirmed yet —
  // cleared the moment a person actually chooses anything for that
  // field, whether that turns out to be the same value or a
  // different one. Never silently promoted to a real choice: the
  // person still has to act, the same "advisory, not automatic"
  // posture every other automated thing in this product already
  // takes (a compiled rule needs activation, a stage error is
  // surfaced rather than acted on).
  const stillSuggested = {};
  for (const spec of CODING_PICKER_FIELDS) {
    const existing = line[spec.field] || null;
    const suggestion = suggestions[spec.field];
    if (existing) {
      chosen[spec.field] = existing;
    } else if (suggestion) {
      chosen[spec.field] = suggestion.value;
      stillSuggested[spec.field] = true;
    } else {
      chosen[spec.field] = null;
    }
  }

  const companyCodeRow = [
    el("label", { text: t("apsetup.codingtab.companycode") }),
    // `codingcompanycode`, decision 0460 — matched in `app.css` to the
    // same height and width as the four searchable fields beneath it,
    // reported live as visibly inconsistent otherwise (a plain
    // `.readonly` box is both shorter, decision 0402's own 32px vs. a
    // real input's 38px, and full column width where the search boxes
    // below are now only 2/3 of it).
    el("div", { class: "readonly codingcompanycode", text: stored.buyer?.entityName ?? "—" }),
  ];

  // One shared results area for all four pickers — decision 0458. See
  // `codingResultsController`'s own doc comment for why a shared area
  // needs a generation token rather than each field's own guard.
  const resultsLabel = el("div", { class: "codingresultslabel muted sm" });
  const resultsList = el("div", { class: "codingresultslist" });
  const results = codingResultsController(resultsLabel, resultsList);

  // The box a person lands in the moment the pop-out opens — decision
  // 0459: *"Could we auto-focus on the Cost Center and pre-load the
  // screen with values for that field."* Cost Centre is always the
  // first editable field when it is shown at all, so it is filled in
  // once the field loop below finds it, and focused once the pop-out
  // is actually in the document (a detached element cannot take focus).
  let costCentreInput = null;

  const fieldRows = CODING_PICKER_FIELDS.flatMap((spec) => {
    const fieldLabel = t(`field.${spec.field.toLowerCase()}`);
    const label = el("label", { text: fieldLabel });
    const resolved = lineFields.find((f) => f.field === spec.field);

    if (!resolved || resolved.visibility !== "edit") {
      return [
        label,
        el("div", {}, [
          el("div", { class: "readonly", text: line[spec.field] || "—" }),
          ...(resolved?.visibility === "read"
            ? []
            : [el("div", { class: "muted sm", text: t("viewer.coding.noteditable") })]),
        ]),
      ];
    }

    // Read live, at fetch time, not captured once — a later field's
    // own choice (Commodity Code) has to reach General Ledger Code's
    // own filter even though it is chosen after this closure is
    // built.
    const filters = () =>
      Object.fromEntries(
        spec.filterKeys.map((key) => [key, key === "company_code" ? stored.orgUnitId : chosen["coding.commodity_code"]])
      );

    const suggestedNote = stillSuggested[spec.field]
      ? el("div", { class: "muted sm", id: `codingsuggested-${spec.field}`, text: t("viewer.coding.suggested") })
      : null;

    const picker = searchableEntryPicker({
      current: chosen[spec.field],
      hint: t("viewer.coding.searchhint"),
      resolveCurrent: chosen[spec.field]
        ? async () => {
            const found = await fetchCodingEntries(spec.listType, chosen[spec.field]);
            return found.find((e) => e.id === chosen[spec.field]) ?? null;
          }
        : null,
      fetchResults: (q) => fetchCodingEntries(spec.listType, q, filters()),
      fieldLabel,
      results,
      // Read live, same reason `filters()` above is — which of this
      // field's own declared filters is actually set right now.
      scopeNote: () => spec.filterKeys.filter((key) => filters()[key]).map((key) => t(FILTER_FIELD_LABEL_KEYS[key] ?? key)),
      onChoose: (item) => {
        chosen[spec.field] = item?.id ?? null;
        line[spec.field] = item?.id ?? "";
        // A real choice, so the suggestion note no longer applies —
        // even re-choosing the same value is now the person's own
        // decision, not the default they hadn't looked at yet.
        if (stillSuggested[spec.field]) {
          delete stillSuggested[spec.field];
          document.getElementById(`codingsuggested-${spec.field}`)?.remove();
        }
      },
    });
    if (spec.field === "BT-133") costCentreInput = picker.querySelector(".searchbox");
    return suggestedNote ? [label, el("div", {}, [picker, suggestedNote])] : [label, picker];
  });

  // A pre-filled suggestion is written into `line` immediately, the
  // same way an already-keyed value already was — Save persists
  // whatever `line[spec.field]` holds regardless of how it got there
  // (this function's own doc comment). Written here rather than
  // inside the loop above so it happens exactly once, after every
  // field's own current-vs-suggested state is settled.
  for (const field of Object.keys(stillSuggested)) {
    line[field] = chosen[field];
  }

  const close = () => {
    backdrop.remove();
    // So the line table's own inline cell (if this same field is also
    // shown there) reflects what was just chosen here — both read and
    // write the identical `line[spec.field]`, per this function's own
    // doc comment.
    renderLines();
  };
  const backdrop = el("div", { class: "backdrop" }, [
    el("div", { class: "popout codingpopout" }, [
      el("div", { class: "cardhead" }, [
        el("h3", { text: t("viewer.coding.heading") }),
        actionLink("close", { onclick: close }),
      ]),
      el("div", { class: "editgrid" }, [...companyCodeRow, ...fieldRows]),
      el("div", { class: "codingresults" }, [resultsLabel, resultsList]),
    ]),
  ]);
  backdrop.onclick = (e) => {
    if (e.target === backdrop) close();
  };
  document.body.append(backdrop);
  // Only takes effect once the element is actually in the document —
  // decision 0459.
  costCentreInput?.focus();
}

function renderLines() {
  const body = document.getElementById("lines");
  if (!body) return;
  body.replaceChildren(...lines.map((line, index) => lineRow(line, index)));
  updateTotals();
}

function linePanel() {
  return el("div", { class: "panel" }, [
    el("h3", { text: t("viewer.lines") }),
    el("table", { class: "linetable" }, [
      el("thead", {}, [
        el("tr", {}, [
          // **No row counter** — decision 0173. Line no. carries the
          // sequence where a document does not give one, so a second
          // column of the same numbers said nothing.
          ...lineFields.map((spec) =>
            el("th", {
              class: spec.type === "number" ? "num" : undefined,
              title: spec.description,
              text: t(`field.${spec.field.toLowerCase()}`),
            })
          ),
          el("th", { text: "" }),
        ]),
      ]),
      el("tbody", { id: "lines" }),
    ]),
    el("div", { class: "linefoot" }, [
      // Structure, not a field — decision 0144. See `lineRow`.
      ...(canEditAnything
        ? [
            el("button", {
              text: t("viewer.addline"),
              onclick: () => {
                lines.push({});
                renderLines();
                renderExceptions();
              },
            }),
          ]
        : []),
      el("div", { class: "linetotal", id: "linetotal" }),
    ]),
  ]);
}

/**
 * The validation panel — decision 0119.
 *
 * **Fixed height and scrolling**, so a document with fourteen
 * exceptions does not push the fields it is complaining about off the
 * screen. The panel is a companion to the form, not a thing that
 * displaces it.
 */
/**
 * What a task action needs, beyond a task id — decision 0138.
 *
 * **Returning and returning to a supplier need a reason.** Decision
 * 0075 made that a requirement rather than a courtesy: a document that
 * came back with no explanation is one the next person cannot act on.
 *
 * Discarding needs one too (0078) — *"nothing goes back"*, so the
 * record of why is all there is.
 */
const ACTIONS_NEEDING_A_REASON = ["return", "return_to_supplier", "discard"];

/**
 * Do something to this task.
 *
 * **The server decides what may be done** (decision 0103); this only
 * asks. A refusal is shown rather than swallowed, because a button that
 * appears to work and does not is worse than one that is absent.
 */
async function runAction(name, task, onClose) {
  let body = {};

  if (ACTIONS_NEEDING_A_REASON.includes(name)) {
    const reason = window.prompt(t(`action.${name}`) + "\n\n" + t("action.whyreason"));
    // **Cancelled means cancelled**, and an empty reason is not a
    // reason — decision 0075 refuses one server-side too.
    if (reason === null || reason.trim() === "") return;
    body = { reason: reason.trim() };
  }

  const path = name.replace(/_/g, "-");
  const response = await fetch(`/api/tasks/${encodeURIComponent(task.id)}/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const failure = await response.json().catch(() => ({}));
    note(failure.error ?? t("viewer.actionfailed"));
    return;
  }

  /**
   * **Claiming only changes who holds the lock — decision 0414,**
   * reported live: *"Upon selecting Claim, I am redirected to the task
   * list. However it would be preferable to open the same viewer in
   * edit mode, now that I have claimed the document."* Every other
   * action here finishes the task or moves it away, which is what the
   * `onClose()` below is actually for; claiming does neither, so the
   * same document at the same stage should stay on screen, now unlocked.
   *
   * **Reopened on a fresh task, not the stale one already in hand** —
   * `canEditAnything` reads `task.ownership` from whatever `openViewer()`
   * was handed, and `task` here still carries whatever it was before
   * this claim succeeded. `refreshTask()` re-fetches it.
   */
  if (name === "claim") {
    const fresh = await refreshTask(task.id);
    if (fresh) {
      await openViewer(fresh, onClose);
      return;
    }
    // Claimed, but no longer in the list this screen would refresh to
    // — most likely a view filtered to unclaimed work. Nothing fresh
    // to reopen, so this falls through to the same close every other
    // action already takes below.
  }

  // The task is finished or moved, so the viewer has nothing left to
  // show. Closing returns to the list, which is where the answer is.
  onClose();
}

/**
 * One action: icon above its label, in a row — decision 0122.
 *
 * **Still the server's decision** which appear (decision 0103). Giving
 * them icons changes how they look, not where they are decided.
 */
/**
 * **Exported since decision 0234**, because the supplier screen's own
 * actions are the same kind of thing: an icon, a label a person can
 * read, and a disabled state where there is nothing to do.
 *
 * A second copy would drift — and the first thing to drift would be the
 * `title`, which is the part that makes the icon legible.
 */
export function actionLink(name, { onclick, primary, label } = {}) {
  // label lets a caller override the shared action.<name> text while
  // still reusing that name's own icon and button styling — decision
  // 0374's own need: Purchase Orders wants "Load CSV" and "CSV
  // Template" rather than the generic "Load"/"Download" every other
  // screen shares, without renaming the shared strings out from under
  // Suppliers, which still wants the generic ones.
  const text = label ?? t(`action.${name}`);
  const node = el("button", {
    class: primary ? "actionlink primary" : "actionlink",
    // A label a person can read, because an icon alone is a guess. The
    // reference this came from labels every one of its three.
    title: text,
    ...(onclick ? { onclick } : { disabled: "disabled" }),
  });
  node.append(icon(name), el("span", { text }));
  return node;
}

/**
 * A document nothing could read — decision 0161.
 *
 * **Said before the exceptions, because it explains them.** Every
 * arithmetic check fails on an invoice with no facts, and a person
 * reading *"net plus VAT does not equal the total"* on an empty form
 * is being told the wrong thing.
 *
 * Decision 0055 made an unreadable document an invoice with no facts,
 * waiting for a person to key it — which is right. Nobody told the
 * person.
 */
function exceptionPanel() {
  return el("div", { class: "panel exceptions" }, [
    el("h3", { text: t("viewer.exceptions") }),
    el("div", { class: "exlist", id: "exlist" }),
  ]);
}

/**
 * The document panel — tabs sharing one space, decisions 0269 and
 * 0273.
 *
 * **Replaces the drawer decision 0267 shipped**, at the operator's own
 * request: "two tabs, reading 'Document' and 'Timeline / Chat'," in
 * the same panel the preview has always occupied, rather than the
 * feed opening in a strip below it. A third tab, "XML," was added
 * after: "include after document, the original XML document in
 * another tab (if it exists)."
 *
 * **No invoice id, no second tab.** A task can in principle have no
 * real subject — the tab needing something to fetch activity for is
 * exactly what the old drawer already guarded with the same check.
 *
 * **Built as N tabs, not two hand-wired ones.** Adding "XML" to a
 * design that hard-coded "doc" and "timeline" everywhere would have
 * meant touching every branch a second time; each tab is instead an
 * entry in one list, and `select()` treats all of them alike.
 */

/**
 * Save, and whatever the task itself offers — decision 0298, moved
 * out of `documentPanel()`'s own footer and into the topbar, beside
 * Back.
 *
 * **Extracted rather than duplicated.** These buttons used to be
 * built once, inline, inside `documentPanel()`'s own `actionsRow`.
 * `topbar()` is called earlier in the render than `documentPanel()`
 * is, so the same logic needed a home either function could reach —
 * a shared helper, not a second, drifting copy of the same rules.
 */
function taskActionButtons(task, onClose) {
  return [
    // **Save appears where something can be saved** — decision 0142.
    // An approval task has every field read-only (decision 0114), so
    // a Save that submits nothing is a button promising an effect it
    // cannot have — which decision 0122 already called worse than an
    // absent one.
    ...(canEditAnything ? [actionLink("save", { onclick: () => save(null), primary: true })] : []),
    // What else this task offers is the SERVER's decision (decision
    // 0103) — collecting them visually does not move where they are
    // decided.
    ...(task.actions ?? [])
      .filter((a) => a !== "key")
      .map((a, index) =>
        actionLink(a, {
          onclick: () => runAction(a, task, onClose),
          // With nothing to save, the first thing the task offers is
          // what somebody came to do.
          primary: !canEditAnything && index === 0,
          /**
           * **"Approve," not the generic "Complete" — decision 0471.**
           * Still the same action and the same route
           * (`POST /tasks/:id/complete`) every stage already uses —
           * only the label changes, the same `label` override decision
           * 0374 already added `actionLink` for Purchase Orders' own
           * "Load CSV"/"CSV Template." A Business Approver's task
           * always carries `requiredPermission: "Procurement.Approve"`
           * (`approval-hierarchy.ts`'s own `resolveNonPoApprovers`),
           * so this reads directly off data the task already has,
           * rather than guessing from the stage's name.
           */
          label: a === "complete" && task.requiredPermission === "Procurement.Approve" ? t("action.approve") : undefined,
        })
      ),
  ];
}

/**
 * Build the Document / XML / Timeline-Chat tabs — decision 0382 (phase
 * 2), widened by 0383 (phase 3), extracted by 0384 (phase 4).
 *
 * **Shared with `document-window.html`, not duplicated.** The pop-out
 * shows exactly this — the same three tabs, the same panes — and a
 * second copy of this logic is exactly the kind of drift this project
 * has caught and fixed elsewhere (SUPERSEDED.md). One function, called
 * from the embedded panel below and from `initDocumentWindow()`.
 */
export function buildDocTabs(invoiceId) {
  const docPane = el("div", { class: "vpreview", id: "vpreview" }, [
    el("div", { class: "vthumb", text: t("viewer.document") }),
  ]);

  /**
   * **Offered when the original genuinely is XML, or a hybrid PDF
   * retained one inside it** — decision 0273's "if it exists," widened
   * by decision 0383. Most invoices arrive as a PDF or an image; their
   * own original is not a second, different thing worth a tab of its
   * own the way a bare-XML original is next to its generated rendering
   * — or the way a Factur-X/ZUGFeRD PDF's embedded invoice now is.
   */
  const hasXml = /xml/i.test(stored.originalDocument?.contentType ?? "") || Boolean(stored.embeddedXmlDocument);
  const xmlContent = hasXml
    ? el("div", { class: "vpreview", id: "vxml" }, [el("div", { class: "vthumb", text: t("viewer.document") })])
    : null;
  /**
   * **No fallback needed here** — `openViewer()` already resets
   * `docPanelTab` to `"doc"` unconditionally for every document it
   * opens (decision 0269), before `documentPanel()` ever runs. A
   * check here for "was `xml` selected on a document with none" would
   * be checking a condition that can never be true by the time this
   * function sees it — confirmed by removing the reset in
   * `openViewer()` and watching the tab-switch test fail, not this
   * one.
   */

  const { content: timelineContent, countBadge } = buildActivityTab(invoiceId);
  const { content: collaboratorsContent } = buildCollaboratorsControl(invoiceId);

  /**
   * **The unreadable-document note now lives here, not beneath the
   * image** — decision 0271. Reported live: *"I would rather this
   * information appeared in the Timeline / Chat... to make room for
   * the image."* A standing note about the document, not a timestamped
   * event, so it sits as its own banner above the feed rather than
   * mixed in among comments and stage completions.
   *
   * **Wrapping `timelineContent` rather than hiding it directly.**
   * `activity.js` replaces `timelineContent`'s own children on every
   * load, post, and error — a banner appended straight into it would
   * be wiped out the moment the eager load finishes. The wrapper is
   * the stable node; `activity.js` never touches it.
   *
   * **`collaboratorsContent` sits above both** — "Add person to
   * conversation" (decision 0470) is about who is in this document's
   * own conversation at all, ahead of the unreadable-document alert
   * (about the document) and the feed (what happened in it).
   * `collaborators.js` owns and updates it the same self-contained way
   * `activity.js` owns `timelineContent`.
   */
  const timelinePane = el(
    "div",
    {},
    [
      collaboratorsContent,
      !stored.intake || stored.intake.readable
        ? null
        : el("div", { class: "systemalert" }, [
            el("div", { class: "icon" }, [icon("systemalert")]),
            el("div", {}, [
              el("div", { class: "systemalertlabel", text: t("activity.systemalert") }),
              el("div", { class: "systemalertheadline", text: t("viewer.unreadable") }),
              ...(stored.intake.attempted
                ? [el("div", { class: "systemalertdetail", text: `${t("viewer.tried")} ${stored.intake.attempted}` })]
                : []),
            ]),
          ]),
      timelineContent,
    ].filter(Boolean)
  );

  const tabs = [{ key: "doc", label: t("viewer.document"), pane: docPane }];
  if (hasXml) tabs.push({ key: "xml", label: t("viewer.xmltab"), pane: xmlContent });
  tabs.push({ key: "timeline", label: t("activity.timelinetab"), pane: timelinePane, badge: countBadge });

  /**
   * **Toggled directly, not re-rendered** — switching tabs must not
   * call the viewer's own `render()`, which would tear down
   * `#vpreview` after `showPreview()` has already filled it and
   * discard whatever the timeline or XML tab has already loaded.
   */
  function select(which) {
    docPanelTab = which;
    for (const entry of tabs) {
      entry.button.className = entry.key === which ? "doctab on" : "doctab";
      entry.pane.hidden = entry.key !== which;
    }
  }

  for (const entry of tabs) {
    entry.button = el("button", { class: entry.key === docPanelTab ? "doctab on" : "doctab" }, [
      el("span", { text: entry.label }),
      entry.badge ?? null,
    ].filter(Boolean));
    entry.button.onclick = () => select(entry.key);
    entry.pane.hidden = entry.key !== docPanelTab;
  }

  return { tabs };
}

function documentPanel(task, onPoppedOutChange) {
  const invoiceId = task.subject?.id ?? null;

  const docPane = el("div", { class: "vpreview", id: "vpreview" }, [
    el("div", { class: "vthumb", text: t("viewer.document") }),
  ]);
  /**
   * **Top right of the document image, beside its own tabs** —
   * decision 0298. It used to sit in a row of its own beneath the
   * image, alongside Save and whatever the task offered; those moved
   * to the topbar (see `taskActionButtons()`), and Expand moved here
   * rather than being left to anchor a now much shorter row by
   * itself.
   *
   * **Opens a page of our own, not the raw file — decision 0384.**
   */
  const expandButton = actionLink("expand", { onclick: () => openDocumentWindow(invoiceId) });

  if (!invoiceId) {
    // Nothing to show a timeline for — the old, un-tabbed panel.
    return el("div", { class: "panel" }, [
      el("div", { class: "cardhead" }, [el("h3", { text: t("viewer.document") }), expandButton]),
      docPane,
    ]);
  }

  const { tabs } = buildDocTabs(invoiceId);

  const normalBody = el("div", {}, tabs.map((entry) => entry.pane));
  /**
   * **The card gives up its space once a pop-out is open** — the
   * design document's own phrase for what decision 0384 built. Two
   * sibling bodies, toggled by `.hidden` the same way `select()`
   * above toggles between tabs, rather than torn down and rebuilt:
   * whichever tab was showing is still exactly as it was the moment
   * the pop-out closes and `normalBody` reappears.
   */
  const placeholderBody = el("div", { class: "vpreview vpoppedout", hidden: true }, [
    el("div", { class: "vthumb" }, [
      el("div", { class: "vpoppedouttext", text: t("viewer.openinwindow") }),
      el("div", { class: "vpoppedoutactions" }, [
        actionLink("expand", { label: t("viewer.bringtofront"), onclick: () => popoutHandle?.focus() }),
        actionLink("close", { label: t("viewer.showhere"), onclick: () => popoutHandle?.close() }),
      ]),
    ]),
  ]);

  popoutStateSetter = (open) => {
    normalBody.hidden = open;
    placeholderBody.hidden = !open;
    // **The rest of the row reflows too** — decision 0392. Everything
    // the Document card no longer needs (Seller, Buyer and Header's
    // own three separate rows) is a CSS concern the caller owns, not
    // this function's — `onPoppedOutChange` is the only seam it needs
    // to reach it, the same way `popoutStateSetter` itself already
    // reaches into `documentPanel()` from outside.
    onPoppedOutChange?.(open);
  };
  popoutStateSetter(popoutIsOpen());

  return el("div", { class: "panel" }, [
    el("div", { class: "cardhead" }, [
      el("div", { class: "doctabs" }, tabs.map((entry) => entry.button)),
      expandButton,
    ]),
    normalBody,
    placeholderBody,
  ]);
}

/** One row: what is wrong, and where. */
function exceptionRow(failure) {
  const where = failure.line ? ` · ${t("viewer.online")} ${failure.line}` : "";
  const value = failure.value ? ` · ${failure.value}` : "";
  // Danger-severity failures get a class so the (currently hidden) panel's
  // `.exrow.danger .extext` rule can pick them out, same as the key fields.
  const rowClass = failure.severity === "danger" ? "exrow danger" : "exrow";

  return el("div", { class: rowClass }, [
    el("div", { class: "extext", text: t(`check.${failure.check}`) }),
    el("div", {
      class: "exwhere",
      // The fields it involves, so a person can look at the panel and
      // know where to go without hovering anything.
      text: failure.fields.map((f) => t(`field.${f.toLowerCase()}`)).join(", ") + where + value,
    }),
  ]);
}

/**
 * Mark the fields an exception involves, and say why on hover.
 *
 * **The reason travels with the highlight.** A red box that does not
 * explain itself makes somebody hunt through a list to find out which
 * of fourteen exceptions is theirs.
 */
/**
 * The three tiers a field can carry — decision 0400. Applied by
 * `markFields()` below; kept as one place so a `.kf` box and a
 * `.linetable` cell are marked identically.
 *
 * **A dot only on `.kf`, never the line table.** The mock-up's own
 * small marker sits beside a field's label; a table cell has no label
 * to sit beside, and a dot in every cell of a wide row would compete
 * with the numbers themselves rather than read as a field-level cue.
 */
function setSeverity(node, severity, reason) {
  // Remove any tier a still-earlier pass left, so a field a failure
  // later claims never keeps an "ok" from a confirmation for the same
  // field alongside it — one tier wins, not all of them at once.
  node.classList.remove("danger", "warning", "ok");
  node.classList.add(severity);
  node.title = reason;
  if (!node.classList.contains("kf")) return;
  const label = node.querySelector("label");
  if (label && !label.querySelector(".kf-dot")) {
    label.prepend(el("span", { class: "kf-dot" }));
  }
}

function markFields() {
  for (const node of document.querySelectorAll(
    ".kf.danger, .kf.warning, .kf.ok, .linetable td.danger, .linetable td.warning, .linetable td.ok"
  )) {
    node.classList.remove("danger", "warning", "ok");
    node.removeAttribute("title");
  }
  for (const dot of document.querySelectorAll(".kf-dot")) dot.remove();

  /**
   * **Least urgent first, most urgent last — explicitly, not by
   * whatever order the API happened to list things in.** Two different
   * checks can disagree about the same field (`vat_arithmetic`
   * confirming BT-112 does not mean a linked purchase order's own
   * `po_mismatch` agrees), and painting in this fixed order means a
   * `danger` always wins the field over a `warning` or an `ok`, and a
   * `warning` always wins over an `ok` — never the reverse, and never
   * dependent on which entry `validateInvoiceFacts` happened to push
   * first.
   */
  for (const confirmed of confirms) markOne(confirmed, "ok", t(`check.${confirmed.check}`));
  for (const failure of exceptions.filter((f) => f.severity === "warning")) {
    markOne(failure, "warning", t(`check.${failure.check}`));
  }
  for (const failure of exceptions.filter((f) => f.severity === "danger")) {
    markOne(failure, "danger", t(`check.${failure.check}`));
  }
}

/** Marks every field (and line-table cell) one `involves`/`confirms`
 *  entry names, with the given tier and tooltip. */
function markOne(entry, severity, reason) {
  for (const code of entry.fields) {
    const control = document.getElementById(`f-${code}`);
    // A field this stage does not show cannot be marked, and that is
    // not an error: the exception still appears in the panel (a
    // confirmation has no panel to appear in at all).
    if (control?.closest(".kf")) {
      setSeverity(control.closest(".kf"), severity, reason);
    }

    // Line fields, on the row the entry names — or every row, when it
    // names none, because line_sum (and a header-level po_mismatch)
    // are about all of them.
    //
    // **A pre-existing off-by-one, found and fixed here** (decision
    // 0400): `lineRow()` builds each row as exactly `lineFields.map(cell)`
    // followed by one trailing remove-button `<td>` — no leading row-
    // counter column (decision 0173 removed the last one). So a field
    // at `lineFields` position `index` sits at `row.children[index]`,
    // not `index + 1`. The `+ 1` silently marked the wrong cell (or,
    // for the last line field, the remove button itself — visible here
    // only as a hijacked tooltip, since no CSS rule targets it) under
    // the old single-tier `.failing` class too; it went unnoticed
    // because nothing before this change screenshotted a line cell.
    const rows = document.querySelectorAll("#lines tr");
    const index = lineFields.findIndex((f) => f.field === code);
    if (index >= 0) {
      for (const [n, row] of rows.entries()) {
        if (entry.line && entry.line !== n + 1) continue;
        const cell = row.children[index];
        if (cell) setSeverity(cell, severity, reason);
      }
    }
  }
}

function renderExceptions() {
  const list = document.getElementById("exlist");
  if (!list) return;

  list.replaceChildren(
    ...(exceptions.length
      ? exceptions.map(exceptionRow)
      : [el("div", { class: "exrow muted", text: t("viewer.noexceptions") })])
  );
  markFields();
}

async function save(close) {
  const facts = {};
  // Only what this person could edit. A read-only value is information
  // they were shown, not a fact they supplied.
  for (const spec of headerFields.filter((f) => f.visibility === "edit")) {
    const control = document.getElementById(`f-${spec.field}`);
    if (!control) continue;
    const raw = String(control.value ?? "").trim();
    if (raw === "") continue; // Partial keying is allowed (decision 0071).
    facts[spec.field] = spec.type === "number" ? Number(raw) : raw;
  }

  // **Every line, not just the changed ones.** The writer replaces the
  // whole set (`DELETE` then reinsert), so sending a subset would
  // delete the rest. The server works out what actually changed for the
  // provenance trail (decision 0109).
  const payload = { facts };
  const usable = lines
    .filter((row) => lineFields.some((spec) => String(row[spec.field] ?? "").trim() !== ""))
    .map((line, index) => {
      const facts = {};
      // **Only editable fields are sent.** A read-only value the screen
      // displayed is not something this person changed, and submitting
      // it would record them as having keyed it (decision 0109).
      for (const spec of lineFields.filter((f) => f.visibility === "edit")) {
        const raw = line[spec.field];
        if (raw === undefined || raw === null || String(raw).trim() === "") continue;
        if (spec.type === "number") {
          facts[spec.field] = Number(raw);
        } else if (spec.field === "BT-130") {
          // A UN/ECE code, so it is upper-cased rather than stored in
          // whatever case somebody typed. `hur` and `HUR` are the same
          // unit and should not be two values.
          facts[spec.field] = String(raw).trim().toUpperCase();
        } else {
          facts[spec.field] = String(raw).trim();
        }
      }

      // BT-126 is the line identifier and is mandatory. Where a person
      // is typing a document nobody could read, its position IS its
      // identifier — stated rather than left blank.
      facts["BT-126"] = String(index + 1);

      return { lineNumber: index + 1, ...columnsFor(line), facts };
    });
  if (usable.length > 0) payload.lines = usable;

  if (Object.keys(facts).length === 0 && usable.length === 0) {
    note(t("viewer.nothing"));
    return;
  }

  const response = await fetch(`/api/invoices/${encodeURIComponent(current.subject.id)}/key`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    note(body.error ?? t("viewer.savefailed"));
    return;
  }

  /**
   * **The verdict is advisory** (decision 0072). Validation is re-run
   * and reported, and nothing re-evaluates the rules — so this says
   * whether the document would now pass, not that anything has moved.
   *
   * The panel carries the detail now, so the note says only that the
   * save worked. **An English sentence was built here in JavaScript**
   * until decision 0119 — a German customer read it in English, which
   * is the thing decision 0107 exists to prevent.
   */
  exceptions = body.validation?.involves ?? [];
  // Same as loadInvoice(): the green tier is re-read here too, or a
  // field that just started passing would stay unmarked until reload.
  confirms = body.validation?.confirms ?? [];
  renderExceptions();
  note(t("viewer.saved"));

  if (close) close();
}

/**
 * Render the viewer for a task.
 *
 * `onClose` returns to the list. Keying does not complete the task —
 * those are separate acts, and somebody may key what they can read and
 * leave the rest for later.
 */
/**
 * What a person needs before they start — decisions 0175, 0176.
 *
 * **Inside the topbar**, above its rule, because these identify the
 * document rather than being the first row of content about it.
 */
function subhead(task) {
  return el("div", { class: "subhead sm muted" }, [
    // Omitted rather than invented on a document nobody is waiting on
    // (decision 0167).
    ...(task.createdAt
      ? [el("div", { text: `${t("viewer.waitinglabel")} ${waited(task.createdAt)}` })]
      : []),
    /**
     * **An address, not "Mine"** — decision 0175.
     *
     * *"Owner: Mine"* tells the person holding a task the one thing
     * they already know, and tells everybody else nothing.
     *
     * A task nobody has claimed **says so** rather than saying nothing:
     * an absent line reads as a screen that forgot, and unclaimed is a
     * real and useful answer — it means anybody may take it.
     */
    /**
     * **Who it belongs to, not who has locked it** — decision 0180.
     *
     * This read `lockedBy`, which is set only once somebody **claims**
     * a task — so a task sitting in its own owner's queue reported
     * *"Owner: Nobody yet"*.
     *
     * Assignment and claiming are different facts (decision 0104: a
     * claim **is** a lock). The owner is who it belongs to; a claim
     * says somebody is working on it now.
     */
    ...(task.stageId
      ? [
          el("div", {
            text: `${t("viewer.ownerlabel")} ${
              task.ownedBy?.email ?? task.ownedBy?.name ?? t("tasks.unclaimed")
            }`,
          }),
        ]
      : []),
  ]);
}

/**
 * The exact `task` object the viewer is currently open on, or `null`
 * if it never opened one — decision 0413.
 *
 * **For `tasks.js`'s own `relaunchAfterLanguageChange()`.** Re-opening
 * the viewer in a newly chosen language needs to call `openViewer()`
 * again with the same task, and this module is already the one place
 * holding it — set below, the same line `openViewer()` itself has
 * always kept it at.
 */
export function currentTask() {
  return current;
}

export async function openViewer(task, onClose) {
  docPanelTab = "doc";

  /**
   * **Retarget an already-open pop-out before anything else renders**
   * — decision 0384. Opening a task is exactly the moment the
   * operator said the pop-out should follow: done here, once, rather
   * than leaving every caller of `openViewer()` to remember it.
   */
  if (task.subject?.id) retargetPopoutIfOpen(task.subject.id);

  // Before rendering, so a field never appears as a text box and then
  // becomes a picker under somebody's hands.
  await loadCodeLists();

  /**
   * **The invoice first, because its unit decides what may be edited**
   * — decision 0198.
   *
   * Decision 0197 let a unit override a stage's field visibility and
   * the route enforced it while this asked without a unit — so a French
   * keyer saw an editable field and got a 403 on save. Decision 0144
   * inverted: the route stricter than the screen.
   *
   * These were the other way round, because until now nothing about the
   * document affected which fields it offered.
   */
  await loadInvoice(task.subject.id);

  // The STAGE decides what may be edited, so this cannot be fetched
  // once and reused across tasks sitting at different stages — and now
  // the UNIT does too.
  await loadFields(task.stageId, stored.orgUnitId ?? null);
  /**
   * Whether anything on this screen can be changed — decision 0142.
   *
   * Read from what the stage permits rather than from its name: a
   * customer who makes Validation read-only gets a read-only Validation
   * screen, which is what decision 0114 is for.
   *
   * **A second condition, decision 0288 — the operator's own question,
   * answered.** "A document can be opened in read-only mode, when it
   * is not claimed, however in order to act on the document in Edit
   * mode, it must be claimed." Before this, a stage permitting edits
   * permitted them for *anyone* who could open the task at all — an
   * unclaimed or someone-else's-locked document included, since
   * nothing here had ever asked whose it was. `task.ownership` already
   * answers that: `"mine"` only for a task assigned to this person
   * directly or claimed by them (`task-list-route.ts`'s own
   * `ownershipOf`). A document opened outside any task at all (the
   * Documents screen's own use of this viewer, decision 0167) has no
   * `ownership` field to be `"mine"`, so it stays read-only exactly as
   * it already did — this adds a real gate where none existed, rather
   * than changing behaviour that was already correct.
   */
  canEditAnything =
    (headerFields.some((f) => f.visibility === "edit") ||
      lineFields.some((f) => f.visibility === "edit")) &&
    task.ownership === "mine";

  current = task;
  // Already loaded above, because its unit decides which fields are
  // editable (decision 0198). Cleared and filled by `loadInvoice`, so
  // one document's exceptions never appear against another.
  await loadProgress(task.subject.id);
  // The lines as stored, so keyed ones come back. Held by field code,
  // which is what the table edits.
  lines = stored.lines.map((line) => ({ ...line.facts }));

  const shell = document.getElementById("viewer");

  const known = task.subject ?? {};
  /**
   * Everything the document carries, by field code — decision 0120.
   *
   * The facts are the truth (decision 0109), so the summary's five
   * columns are only a fallback for a field the facts happen not to
   * hold.
   */
  const existing = {
    "BT-31": known.supplierVatId ?? "",
    "BT-27": known.supplierName ?? "",
    "BT-5": known.currency ?? "",
    "BT-2": known.issueDate ?? "",
    "BT-112": known.totalWithVat ?? "",
    ...stored.facts,
  };

  /**
   * Which fields describe the seller, the buyer, and neither —
   * decision 0115.
   *
   * **Derived from the standard, not listed here.** BG-4 collects the
   * seller's terms and BG-7 the buyer's, so an interface that kept its
   * own list would drift the first time a party field was added — which
   * is exactly what happened to the line fields before decision 0114.
   */
  const SELLER_FIELDS = ["BT-27", "BT-31", "BT-34", "BT-40"];
  /**
   * **No longer a panel of its own** — decision 0224. The Buyer card
   * shows our record of the unit an invoice is for, the way the Seller
   * card shows our record of the supplier.
   *
   * The list stays, because these fields must still be **kept out of
   * the main form**: they describe a party and the form below is
   * everything else. `SELLER_FIELDS` is read twice now — once for that,
   * and once as what the Seller card falls back to when nothing
   * matched.
   */
  const BUYER_FIELDS = ["BT-44", "BT-48", "BT-49", "BT-55", "BT-10"];

  /**
   * **A curated summary, not every configured field** — decision 0291,
   * from the operator's own mock-up. `.vfields`'s auto-fit grid showed
   * every header field in whatever order the field-visibility API
   * returned them, which is what let two technical, URN-valued fields
   * (Business process, Specification) land beside short ones and
   * overlap them — reported live as *"the fields beneath the word
   * Seller appear to be aligned to the bottom,"* the same root cause
   * decision 0290 already fixed once for the Seller card's own
   * sub-line.
   *
   * **Five columns, each a fixed set of slots**, not a reflowing grid:
   * a field a particular customer doesn't use leaves its own slot
   * empty rather than the layout rearranging around it, so the card
   * looks the same shape for everyone.
   *
   * **Total with VAT stayed, against the operator's own mock-up.**
   * Their sketch paired Amount due alone in the last column; the VAT
   * arithmetic check (decision 0119) highlights Net before VAT, VAT
   * amount and Total with VAT together as the one relationship it
   * checks. Leaving Total with VAT out of the card would leave a
   * third of that highlight nowhere visible without opening Header
   * Fields first, for the one check on this screen most likely to
   * actually fail. The column holds both rather than dropping either.
   *
   * **Cost centre never belonged here, decision 0295** — a genuine
   * mistake in the mock-up itself, not a field-visibility
   * configuration gap the way the operator's own screenshot first
   * read: `shared/interpreter/vocabulary.ts`'s own
   * `INVOICE_LINE_FIELDS` includes BT-133 by name (`"BT-133", //
   * line accounting/cost centre reference`), and
   * `field-visibility-route.ts` sets `line: INVOICE_LINE_FIELDS
   * .includes(field)` when building its response — BT-133 is
   * structurally a per-line value, and `headerFields` filters those
   * out unconditionally. No amount of configuration could ever have
   * put it on this card; it was never reachable in the first place.
   *
   * **Payment terms took its slot, decision 0296.** Not a field the
   * system already had, unlike Due date or Purchase order — BT-20 was
   * added to the closed vocabulary itself for this, with the document
   * parser taught to actually extract it from a real invoice's own
   * `cac:PaymentTerms/cbc:Note`, on the same reasoning `field-coverage
   * .test.ts` already enforces for every other declared field: one
   * nothing can ever populate is a rule nobody can write, and here, a
   * slot on a card nothing could ever fill.
   */
  const HEADER_SUMMARY_FIELDS = [
    "BT-1",
    "BT-5",
    "BT-2",
    "BT-9",
    "BT-13",
    "BT-20",
    "BT-106",
    "BT-110",
    "BT-112",
    "BT-115",
  ];
  const HEADER_SUMMARY_COLUMNS = [
    ["BT-1", "BT-5"],
    ["BT-2", "BT-9"],
    ["BT-13", "BT-20"],
    ["BT-106", "BT-110"],
    ["BT-112", "BT-115"],
  ];

  /**
   * **Header Fields' own reading order, decision 0297** — the
   * operator's own mock-up, field by field, rather than whatever
   * order the field-visibility API happens to return: a customer's
   * own `sort_order` is theirs to set for other purposes, and this
   * pop-out reads better as one deliberate sequence — identity, then
   * dates, then references, then money, then what's genuinely
   * technical — than left to drift with it. A field not named here
   * (a customer's own custom field, say) is not dropped — it simply
   * sorts after everything that is, in whatever order it already had.
   */
  const HEADER_FIELDS_ORDER = [
    "BT-1",
    "BT-3",
    "BT-5",
    "BT-2",
    "BT-9",
    "BT-13",
    "BT-20",
    "BT-106",
    "BT-110",
    "BT-112",
    "BT-115",
    "BT-23",
    "BT-24",
  ];
  // A field not named above sorts after everything that is, rather
  // than being dropped or thrown to the front by a -1 index.
  const headerFieldsOrderIndex = (fieldCode) => {
    const i = HEADER_FIELDS_ORDER.indexOf(fieldCode);
    return i === -1 ? HEADER_FIELDS_ORDER.length : i;
  };

  /**
   * A pop-out that finds one thing and attaches it — decisions 0222 and
   * 0224.
   *
   * **One box, not a form.** Somebody looking at an invoice has a name,
   * or a VAT number, or an address on the page, and does not know which
   * of those we hold. Asking them to pick a field first is asking them
   * to guess what we stored.
   *
   * Shared by the supplier and buyer searches because they differ only
   * in **where they look and what they say** — two near-copies would
   * drift, and the second would get the debounce wrong.
   */
  function openSearch({ heading, hint, note, search, describe, choose, alsoOffer }) {
    const input = el("input", { type: "text", class: "searchbox", placeholder: hint });
    const results = el("div", { class: "searchresults" });
    const box = el("div", { class: "popout" }, [
      el("h3", { text: heading }),
      el("p", { class: "muted", text: note }),
      input,
      results,
      /**
       * **An offer, not a default.** Somebody should look for the
       * supplier before recording a second one — so this sits below the
       * search rather than beside the heading.
       */
      alsoOffer
        ? el("button", {
            class: "secondary",
            text: alsoOffer.label,
            onclick: async () => {
              try {
                const response = await alsoOffer.run();
                if (!response.ok) {
                  const body = await response.json();
                  results.replaceChildren(el("div", { class: "warn", text: body.error }));
                  return;
                }
                close();
                await openViewer(current, onClose);
              } catch {
                results.replaceChildren(
                  el("div", { class: "warn", text: t("viewer.supplier.choosefailed") })
                );
              }
            },
          })
        : null,
      // One icon for closing, everywhere (decision 0236).
      actionLink("close"),
    ].filter(Boolean));

    const backdrop = el("div", { class: "backdrop" }, [box]);
    const close = () => backdrop.remove();
    // The last button is Close; an offer may sit before it.
    box.querySelectorAll("button")[box.querySelectorAll("button").length - 1].onclick = close;
    backdrop.onclick = (e) => {
      if (e.target === backdrop) close();
    };

    let latest = 0;
    input.oninput = async () => {
      const q = input.value;
      /**
       * **Only the newest answer counts.** Typing is faster than the
       * network, and an earlier reply arriving late would replace a
       * later one — the list would then not match the box above it.
       */
      const mine = ++latest;

      if (q.trim().length < 2) {
        results.replaceChildren();
        return;
      }

      try {
        const found = await search(q);
        if (mine !== latest) return;

        if (found.length === 0) {
          results.replaceChildren(
            el("div", { class: "muted", text: t("viewer.supplier.nomatches") })
          );
          return;
        }

        results.replaceChildren(
          ...found.map((item) => {
            const [title, detail] = describe(item);
            const row = el("button", { class: "searchresult" }, [
              el("div", { text: title }),
              // **Everything a person might have searched on**, so they
              // can see why this row came back and whether it is right.
              el("div", { class: "muted", text: detail }),
            ]);

            row.onclick = async () => {
              try {
                const response = await choose(item);
                if (!response.ok) {
                  const body = await response.json();
                  results.replaceChildren(el("div", { class: "warn", text: body.error }));
                  return;
                }
                close();
                // Reopen on the same task, so the card redraws with the
                // choice applied.
                await openViewer(current, onClose);
              } catch {
                results.replaceChildren(
                  el("div", { class: "warn", text: t("viewer.supplier.choosefailed") })
                );
              }
            };

            return row;
          })
        );
      } catch {
        if (mine === latest) {
          results.replaceChildren(
            el("div", { class: "warn", text: t("viewer.supplier.searchfailed") })
          );
        }
      }
    };

    document.body.append(backdrop);
    input.focus();
  }

  /**
   * Finding a supplier by hand — decision 0222.
   *
   * **Leaving it is a real answer**, which the note says out loud: the
   * document may be from a genuinely new supplier, and the person
   * keying it cannot create one because we are the mirror.
   */
  function openSupplierSearch() {
    openSearch({
      heading: t("viewer.supplier.findheading"),
      hint: t("viewer.supplier.searchhint"),
      note: t("viewer.supplier.orleave"),
      /**
       * **Recording the supplier from the invoice in front of you** —
       * decision 0233.
       *
       * The operator: *"a new invoice from a new supplier could be
       * received. We want a way to capture the supplier information and
       * save it, but that would trigger a new supplier process."*
       *
       * **Pre-filled from what the document said**, because a person
       * who has just read it should not retype it — and because the
       * facts extracted are exactly what the team creating the ERP
       * record will need.
       */
      alsoOffer: {
        label: t("viewer.supplier.record"),
        run: async () => {
          const facts = stored.facts ?? {};
          const response = await fetch("/api/suppliers", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: facts["BT-27"] ?? "",
              vatId: facts["BT-31"] ?? "",
              electronicAddress: facts["BT-34"] ?? "",
              country: facts["BT-40"] ?? "",
            }),
          });
          if (!response.ok) return response;

          // And attach this invoice to it, which is why we are here.
          const { id } = await response.json();
          return fetch(`/api/invoices/${encodeURIComponent(current.subject.id)}/supplier`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ supplierId: id }),
          });
        },
      },
      /**
       * **`orgUnitId`, so results rank by the invoice's own buying
       * entity — decision 0433.** `stored.orgUnitId` (decision 0198)
       * is exactly what `matchSupplier`'s own automatic tiebreak
       * already narrows by; this hands the same signal to the person
       * doing by hand what the automatic match could not finish.
       */
      search: async (q) => {
        const response = await fetch(
          `/api/suppliers/search?q=${encodeURIComponent(q)}&orgUnitId=${encodeURIComponent(stored.orgUnitId ?? "")}`
        );
        if (!response.ok) throw new Error();
        return (await response.json()).suppliers;
      },
      describe: (s) => [
        s.name,
        [
          s.erp_identifier,
          s.erp_site_identifier,
          // **Ahead of the pay-site marker — decision 0433.** Read in
          // the same order the list is sorted: why a row is near the
          // top comes before what kind of site it is.
          s.org_match ? t("suppliers.sameorg") : null,
          s.is_pay_site ? t("suppliers.pay") : null,
          s.vat_id,
          [s.address_line, s.city, s.postal_code].filter(Boolean).join(", "),
        ]
          .filter(Boolean)
          .join(" · "),
      ],
      choose: (s) =>
        fetch(`/api/invoices/${encodeURIComponent(current.subject.id)}/supplier`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ supplierId: s.id }),
        }),
    });
  }

  /**
   * Finding one of our own units by hand — decision 0224.
   *
   * **The same pop-out as decision 0222's**, with a different endpoint
   * and a different sentence: a supplier that is not on file may be
   * genuinely new and leaving it is a real answer, where an invoice in
   * no unit **stops at the org gate** (decision 0037) and one in the
   * wrong unit is handled wrongly by every stage after it.
   *
   * So this one does not say *"leave it"*.
   */
  function openBuyerSearch() {
    openSearch({
      heading: t("viewer.buyer.findheading"),
      hint: t("viewer.buyer.searchhint"),
      note: t("viewer.buyer.why"),
      search: async (q) => {
        const response = await fetch(`/api/org/units/search?q=${encodeURIComponent(q)}`);
        if (!response.ok) throw new Error();
        return (await response.json()).units;
      },
      describe: (u) => [
        u.name,
        [u.parent_name, u.parent_vat_id ?? u.vat_id, u.city].filter(Boolean).join(" · "),
      ],
      choose: async (u) => {
        const put = await fetch(
          `/api/invoices/${encodeURIComponent(current.subject.id)}/org`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ unitId: u.id }),
          }
        );
        return put;
      },
    });
  }

  /**
   * A card's title, with its own action beside it — decision 0228.
   *
   * **Top right, in space the heading already leaves empty.** The
   * operator: *"it might extend the card size if we place at the bottom
   * right. There is space in the top right already."*
   *
   * Which is the whole argument — a footer adds height to a card in a
   * column that is already short of it, and the heading row has room
   * doing nothing.
   *
   * **Re-routing is offered even when a match was found**, because a
   * wrong answer is worse than none: none stops at the org gate
   * (decision 0037), and a wrong one sails through every org-scoped
   * stage after it behaving correctly.
   */
  /**
   * **The action only where editing is allowed at all, decision
   * 0289** — reported live: "I was able to click the Change Seller
   * and Change Buyer buttons on invoices that are not claimed to my
   * user." Reassigning who an invoice is from or billed to is exactly
   * the kind of edit decision 0288 already gates behind `"mine"`
   * ownership; `cardHead()` rendered its own action unconditionally,
   * the same gap decision 0288 closed for `field()` and the Save
   * button, just not reached yet here.
   */
  const cardHead = (title, action, onclick) =>
    el("div", { class: "cardhead" }, [
      el("h3", { text: title }),
      ...(canEditAnything ? [actionLink(action, { onclick })] : []),
    ]);

  /**
   * **Label and value on one line** — decision 0221, from the
   * operator's own mock-up, and shared by both party cards since
   * decision 0224.
   *
   * Decision 0219 stacked them, which is how the keying form works
   * **because its values are inputs**. These are short, read-only and
   * scanned against a document — a label above each doubles the height
   * for nothing.
   */
  const pair = (label, value) =>
    el("div", { class: "sfield" }, [
      el("span", { class: "slabel", text: label }),
      el("span", { class: value ? "" : "muted", text: value || "—" }),
    ]);

  /**
   * **The address as a block, under one label.** Four labelled rows is
   * four labels for one thing, and an invoice prints an address as
   * lines.
   *
   * **The short country code, not the expanded Peppol name** —
   * decision 0389, superseding 0221's own reasoning ("an invoice
   * prints *United Kingdom*; our record holds `GB`. A card that
   * exists to be compared against an image should say what the image
   * says"). Asked directly, with "GB" becoming "United Kingdom of
   * Great Britain and Northern Ireland" as the example: "I think in
   * all cases, we can stick with the short form country code."
   * `party.countryName` is left unread here rather than deleted from
   * the response `invoice-facts-route.ts` still sends it in — nothing
   * else in this file, or checked elsewhere, reads it either.
   *
   * **The country sits beside the city, not beneath it — decision
   * 0393.** Asked for directly: "the 2 digit country code appears
   * next to the City, on the same line." The two are joined with
   * `", "` into one line rather than each keeping its own `<div>`;
   * `postalCode` stays a separate line, which was not part of the
   * ask.
   */
  const addressBlock = (party, label) => {
    const cityCountry = [party.city, party.country].filter(Boolean).join(", ");
    const lines = [party.addressLine, cityCountry, party.postalCode].filter(Boolean);

    return el("div", { class: "sfield" }, [
      el("span", { class: "slabel", text: label }),
      lines.length > 0
        ? el("span", {}, lines.map((line) => el("div", { text: line })))
        : el("span", { class: "muted", text: "—" }),
    ]);
  };

  /**
   * The Buyer card — decision 0224.
   *
   * **The same shape as the Seller's, because it is the same question
   * from the other side**: our record of who this invoice is for, set
   * beside the image so a person can see it is addressed to us.
   *
   * The operator's reason it matters:
   *
   *   The Buyer Org should be defined before validation, or validation
   *   at the latest, because subsequent stages — Matching, Coding,
   *   Approval — are impacted by Org specific configurations.
   *
   * Which is exact. Decision 0196 scopes rule sets to a unit, decision
   * 0197 field visibility, decision 0199 who may act, decision 0202 who
   * is shown the work. **An invoice in the wrong unit is one every
   * later stage handles wrongly**, and silently.
   */
  const buyerPanel = () => {
    const b = stored.buyer;

    if (!b) {
      // Amber and a reason — the same ribbon as the Seller's, for the
      // reason decision 0161 gave.
      return el("div", { class: "panel needsattention" }, [
        cardHead(t("viewer.buyer"), "changebuyer", () => openBuyerSearch()),
        el("div", { class: "warn", text: t(`viewer.buyer.${stored.buyerUnplaced ?? "none"}`) }),
      ]);
    }

    return el("div", { class: "panel" }, [
      cardHead(t("viewer.buyer"), "changebuyer", () => openBuyerSearch()),
      /**
       * **No sub-line here** — decision 0227.
       *
       * It named the entity and the unit, which decision 0224 needed
       * when an invoice was assigned to a department beneath a company.
       * **Since decision 0226 the header names the company**, so the
       * two are the same row and the line repeated the Name directly
       * beneath it.
       *
       * The Seller card keeps its sub-line, and that is not an
       * inconsistency: it carries the ERP number, the site and whether
       * the site takes payment — none of which appears anywhere else on
       * the card.
       */
      el("div", { class: "sellergrid" }, [
        pair(t("viewer.supplier.name"), b.entityName),
        pair(t("viewer.supplier.vat"), b.vatId),
        addressBlock(b, t("viewer.supplier.street")),
        /**
         * **Phone, back beneath the address — decision 0393.** Decision
         * 0387 dropped it along with E-address and E-mail to give the
         * card back a column; asked to reintroduce this one alone, in
         * the vertical order it was asked for. `b.phone` is still
         * fetched onto `stored.buyer` — 0387 stopped reading it, it
         * never stopped arriving.
         */
        pair(t("viewer.supplier.phone"), b.phone),
      ]),
    ]);
  };


  /**
   * The Seller card — decision 0220.
   *
   * **One card, not two.** Decision 0219 added a second panel beside
   * this one, which the operator refused for a plain reason: *"screen
   * real-estate constraints."* A viewer that shows the document and the
   * form side by side has no room for a card that repeats what the card
   * above it says differently.
   *
   * **Matched, it shows our record**; unmatched, what the document
   * said. Never both — the two answer the same question and showing
   * both makes a person compare them instead of comparing our record
   * against the image, which is the comparison that matters.
   */
  const sellerPanel = () => {
    const s = stored.supplier;

    if (!s) {
      /**
       * **What was extracted**, which is all there is — plus why no
       * supplier was found, because three causes need three actions.
       */
      const shown = headerFields.filter((f) => SELLER_FIELDS.includes(f.field));
      const why = stored.facts?.["supplier.unmatchedReason"];

      /**
       * **An amber ribbon, like decision 0161's unreadable notice** —
       * whose own words fit this exactly: *"nothing went wrong, and
       * there is something for a person to do."*
       *
       * An unmatched supplier is not an error. The document may be from
       * a genuinely new supplier, and leaving it is a real answer —
       * decision 0222's *"the user can just leave it, to be picked up
       * later in AP Review."*
       */
      return el("div", { class: "panel needsattention" }, [
        cardHead(t("viewer.seller"), "changeseller", () => openSupplierSearch()),
        el("div", { class: "warn", text: t(`viewer.supplier.${why ?? "none"}`) }),
        shown.length > 0
          ? el("div", { class: "vfields" }, shown.map((spec) => field(spec, existing)))
          : null,
      ].filter(Boolean));
    }

    return el("div", { class: "panel" }, [
      cardHead(t("viewer.seller"), "changeseller", () => openSupplierSearch()),
      /**
       * **Which site, and what it is for.** The reason this invoice
       * reached this record rather than one of its siblings — and since
       * decision 0218 that reason is a pay-site flag, which is nowhere
       * on the document.
       *
       * **Omitted entirely when there is nothing to say, decision
       * 0290.** Reported live: "The fields beneath the word Seller
       * appear to be aligned to the bottom of the card." This rendered
       * unconditionally, so a supplier with no ERP identifier, no
       * site, and not a pay site still produced an empty `.sub` line —
       * present in the layout, carrying its own margin, saying
       * nothing. An empty line reserving space is never the right
       * default, the same reasoning behind every other "show nothing
       * rather than something with nothing in it" choice already made
       * throughout this screen.
       */
      ...(s.erpIdentifier || s.erpSiteIdentifier || s.isPaySite
        ? [
            el("div", {
              class: "sub",
              text: [s.erpIdentifier, s.erpSiteIdentifier, s.isPaySite ? t("suppliers.pay") : null]
                .filter(Boolean)
                .join(" · "),
            }),
          ]
        : []),
      s.onHold
        ? el("div", { class: "warn", text: `${t("viewer.supplier.onhold")} ${s.holdReason ?? ""}` })
        : null,
      el("div", { class: "sellergrid" }, [
        pair(t("viewer.supplier.name"), s.name),
        pair(t("viewer.supplier.vat"), s.vatId),
        addressBlock(s, t("viewer.supplier.street")),
        // Phone, back beneath the address — decision 0393. See the
        // matching comment in buyerPanel(), the same call for the
        // same reason.
        pair(t("viewer.supplier.phone"), s.phone),
      ]),
      /**
       * **Change Seller is not here** — it lives top right, in
       * `cardHead()`. Decision 0228 first placed it bottom right, "like
       * the document's own actions", and moved it on the operator's
       * own reasoning: "It might extend the card size if we place at
       * the bottom right." This comment went on saying bottom right
       * after the button had left; corrected in decision 0380.
       */
    ].filter(Boolean));
  };


  /**
   * The curated summary's own overflow — decision 0291, editable
   * where permitted since decision 0292.
   *
   * **A pop-out, matching the Supplier screen's own pattern** rather
   * than a new one invented for this card: `.popout` inside
   * `.backdrop`, the same box `suppliers.js`'s own detail view already
   * opens on a row click, here opened by "Header Fields" instead.
   *
   * **Every configured field, not only the overflow** — decision 0293
   * corrected decision 0292's own narrower reading: the pop-out's
   * title has always said "All invoice header fields," and only
   * showing what the card omitted made that title wrong about what
   * was actually inside it. A field the card already shows renders
   * here too, forced read-only under its own `hf-${field}` id rather
   * than the card's own `f-${field}` — `field()` renders a live
   * `<input id="f-${field}">` when a field is editable, and a second
   * one under the card's own id would put two elements with the same
   * id on the page, with only one of them ever read back on save.
   *
   * **Hidden on close, never removed.** `save()` reads a field's value
   * from `document.getElementById`, wherever in the page that element
   * happens to live — an input built here and then deleted from the
   * DOM on close would silently lose whatever was typed into it the
   * moment Save is next pressed, since nothing would exist left to
   * read. Hiding keeps it exactly where it is.
   *
   * **Reopened, never rebuilt**, for the same reason: a second call
   * to `field()` for the same spec on a second open would be exactly
   * the duplicate-id problem the `hf-` prefix above exists to avoid,
   * just deferred to a re-open instead. `popoutBackdrop` remembers the
   * one already built.
   */
  let popoutBackdrop = null;

  /**
   * **Every configured field, matching its own title** — decision
   * 0293. The operator's own correction: "I had thought that the
   * pop-out would show fields on the card, and any additional fields
   * not shown on the card... Hence the pop-out title — 'All invoice
   * header fields.'" Showing only the overflow (decision 0292) made
   * the title wrong about what was actually in it.
   *
   * **A field already on the card renders here too, forced read-only
   * under its own, different id.** The card already has the one real,
   * editable copy; a second editable one here — even genuinely
   * distinct in the DOM — would be an input `save()` never reads,
   * since that looks for `f-${field}` specifically and nothing else.
   * An edit typed into this copy would look accepted and then
   * silently not exist. Read-only here says correctly that this is
   * the same value shown a second time, not a second place to change
   * it.
   */
  function openHeaderFieldsPopout() {
    if (popoutBackdrop) {
      popoutBackdrop.hidden = false;
      return;
    }

    const shown = headerFields
      .filter((spec) => ![...SELLER_FIELDS, ...BUYER_FIELDS].includes(spec.field))
      .slice()
      .sort((a, b) => headerFieldsOrderIndex(a.field) - headerFieldsOrderIndex(b.field));

    const rows = shown.map((spec) =>
      HEADER_SUMMARY_FIELDS.includes(spec.field)
        ? field(spec, existing, { id: `hf-${spec.field}`, forceReadOnly: true })
        : field(spec, existing)
    );

    const close = () => {
      popoutBackdrop.hidden = true;
    };
    const backdrop = el("div", { class: "backdrop" }, [
      el("div", { class: "popout" }, [
        el("div", { class: "cardhead" }, [
          el("h3", { text: t("viewer.allheaderfields") }),
          /**
           * **Top right, not the footer** — the operator's own
           * request, matching every other card's own action
           * (`cardHead()`'s Change Seller, `headerSummary()`'s own
           * Header Fields). Not `cardHead()` itself: closing has to
           * stay reachable even when `canEditAnything` is false — the
           * same reasoning "Header Fields" itself already carries.
           */
          actionLink("close", { onclick: close }),
        ]),
        el("div", { class: "hffields" }, rows),
      ]),
    ]);
    backdrop.onclick = (e) => {
      if (e.target === backdrop) close();
    };
    document.body.append(backdrop);
    popoutBackdrop = backdrop;
  }

  /**
   * The card itself — decision 0291's curated replacement for the flat
   * `.vfields` grid every header field used to share.
   *
   * **"Header Fields" only appears when there is something in it.** A
   * customer whose every configured header field already fits the nine
   * curated slots has nothing left to show, and an action promising
   * more fields with none behind it is worse than no action at all —
   * decision 0122's own reasoning, applied here rather than restated.
   *
   * **Not `cardHead()`.** That helper gates its action on
   * `canEditAnything`, correct for Change Seller and Change Buyer —
   * genuine edits, rightly locked down for an unclaimed task by
   * decision 0289. Looking up a field's own value is not an edit; it
   * stays available the same way Expand does regardless of
   * `canEditAnything`, so this builds its own header rather than
   * inheriting a gate written for a different kind of action.
   */
  function headerSummary() {
    const overflow = headerFields.some(
      (spec) =>
        ![...SELLER_FIELDS, ...BUYER_FIELDS, ...HEADER_SUMMARY_FIELDS].includes(spec.field)
    );

    return el("div", { class: "panel" }, [
      el("div", { class: "cardhead" }, [
        el("h3", { text: t("viewer.fields") }),
        ...(overflow
          ? [actionLink("headerfields", { onclick: () => openHeaderFieldsPopout() })]
          : []),
      ]),
      el(
        "div",
        { class: "headersummary" },
        HEADER_SUMMARY_COLUMNS.map((column) =>
          column
            .map((code) => headerFields.find((spec) => spec.field === code))
            .filter(Boolean)
        )
          /**
           * **A column with nothing in it is not rendered at all** —
           * reported live, from a screenshot: "I am missing some
           * fields on the card." A customer whose own configuration
           * leaves an entire column empty (neither field in it
           * configured as visible) still had that column's own grid
           * track reserved, since `auto-fit` counts every element
           * passed to it, empty or not — an empty `<div>` is still one
           * more column for the grid to divide the row into, which
           * read as a wide, unexplained gap rather than nothing. One
           * field missing from a column that still has the other
           * looks like a made choice; a whole column of blank space
           * does not.
           */
          .filter((specs) => specs.length > 0)
          .map((specs) => el("div", { class: "hscolumn" }, specs.map((spec) => field(spec, existing))))
      ),
    ]);
  }


  /**
   * One status panel, not four — decision 0115.
   *
   * The operator's observation: four panels for four short values took
   * a lot of room to say very little. **Status, stage, waiting and
   * owner belong together** — they are one sentence about where this
   * document is, and reading them as a row of separate cards makes
   * that harder rather than easier.
   *
   * The space they were using now belongs to the seller and the buyer,
   * which the screen had nowhere to show at all.
   */

  /**
   * The status panel is gone — decision 0175.
   *
   * It carried four things and **none of them earned a card**. The
   * status read *"Not yet keyed · 0/4 fields known"* on every document,
   * counting four fields nobody chose. The stage was already the
   * heading. Waiting and Owner were real and belonged beside the
   * document's own identity rather than below it.
   *
   * Removing it moves the process row (decision 0151) up a screenful,
   * which is what somebody opening an invoice actually looks at.
   */

  /**
   * **Built in two steps, not inline** — decision 0392. `columnsEl`
   * has to already exist, not still be mid-construction, the moment
   * `documentPanel()` calls `setDocPoppedOut` for its own first,
   * synchronous read of whether a pop-out is already open (line ~1061
   * above): `popoutStateSetter(popoutIsOpen())` runs before
   * `documentPanel()` even returns, let alone before the surrounding
   * `el("div", { class: "columns" }, [...])` call that would
   * otherwise still be evaluating its own children array — a `const`
   * assigned from that same expression is not initialized until the
   * whole expression finishes, so a callback reaching for it that
   * early would find only the temporal dead zone.
   */
  const columnsEl = el("div", { class: "columns" });
  /**
   * **Seller, Buyer and Header share the row the Document card no
   * longer needs — decision 0392**, asked for directly: *"When
   * expanded, the original window still shows a card for the invoice
   * image, but this space is no longer used... the Seller card, buyer
   * card and Invoice Header card can all occupy the same row."*
   * `#viewer .columns.docpoppedout` in `app.css` carries the actual
   * reflow — a different `grid-template-areas` and column widths, at
   * 25%/25%/50% (Header, at 50%, keeps its own field grid's natural
   * width rather than being squeezed into wrapping — measured against
   * both this and a 30/30/40 split before choosing it, the operator's
   * own choice between the two). This function only toggles the class
   * that selects it; nothing here moves a single DOM node between
   * containers — Header stays exactly where it always sat, as
   * `.c-parties`'s own sibling, and the CSS alone decides whether that
   * sibling gets its own row or shares one.
   */
  function setDocPoppedOut(open) {
    columnsEl.classList.toggle("docpoppedout", open);
  }
  // Named grid areas (decision 0388) — the Document card spans
  // exactly the process+parties+header rows, its bottom landing
  // on the header card's own bottom, with Lines full width
  // beneath both rather than confined to this column. (Decision
  // 0392 above changes what those areas are once popped out.)
  columnsEl.append(
    el("div", { class: "c-process" }, [workflowErrorPanel(), progressRow()].filter(Boolean)),
    el("div", { class: "c-document" }, [
      documentPanel(task, setDocPoppedOut),
      exceptionPanel(),
    ].filter(Boolean)),
    el("div", { class: "c-parties" }, [
      // Seller and buyer side by side, in the space the four
      // status panels were using (decision 0115).
      el("div", { class: "parties" }, [sellerPanel(), buyerPanel()].filter(Boolean)),
    ]),
    el("div", { class: "c-header" }, [headerSummary()].filter(Boolean)),
    el("div", { class: "c-lines" }, [linePanel()].filter(Boolean)),
    el("div", { class: "c-note" }, [
      el("div", { class: "problem", id: "viewer-note", role: "status" }),
    ])
  );

  shell.replaceChildren(
    frame(
      el("div", {}, [
        /**
         * **The document's own reference, not the stage, decision
         * 0312** — reported live: "we state the 'Stage: <stage
         * name>'... this information is duplicated, because it is
         * highlighted in the Process flow, which shows the current
         * stage highlighted, on the same page." `processRow()` (below,
         * via `progressRow()`) already labels every chevron with its
         * own `stage.name`, and marks the current one with its own
         * `.here` class — the heading naming the stage again was
         * saying the same fact twice on the same screen.
         *
         * **The one accepted gap**: a task with no real process
         * instance (`!progress.inProcess`) shows neither the chevron
         * row nor a stage name anywhere — the operator's own call,
         * choosing simplicity over covering a case confirmed to be
         * rare rather than carrying the duplication everywhere else to
         * guard against it.
         *
         * Beneath it, what identifies the document and what a person
         * needs before they start: how long it has waited and who has
         * it, in `subhead()`. All three were in a card below the fold
         * before decision 0175, where the last two were the only ones
         * worth reading.
         */
        topbar(
          /**
           * **Which line, where a task is about one** — decision 0183,
           * carried over from the stage heading this replaces. A stage
           * scoped `per_line` raises a task per invoice line, and the
           * viewer opens the whole document either way. Without saying
           * which line, somebody approving line three has to work out
           * that it is line three.
           */
          task.subject?.id
            ? `${t("viewer.reflabel")} ${task.subject.id}${
                task.lineNumber ? ` · ${t("tasks.line")} ${task.lineNumber}` : ""
              }`
            : t("viewer.title"),
          "",
          [
            /**
             * **Save and the task's own actions, beside Back** —
             * decision 0298, the operator's own request: "move Save,
             * Complete, Release and Return buttons to the top right
             * of the page, next to the Back button. This will free
             * space below the document image." Built once, in
             * `taskActionButtons()`, since `topbar()` is called here,
             * before `documentPanel()` — which used to build the same
             * buttons itself — ever runs.
             */
            ...taskActionButtons(task, onClose),
            el(
              "button",
              { class: "actionlink", title: t("viewer.back"), onclick: onClose },
              [icon("back"), el("span", { text: t("viewer.back") })]
            ),
          ],
          [subhead(task)]
        ),

        columnsEl,
      ].filter(Boolean))
    )
  );

  renderLines();
  renderExceptions();
  // Not awaited: the form is usable while the document loads, and a
  // slow R2 fetch should not hold up somebody who knows what to type.
  showPreview(task.subject.id, stored.document?.contentType);
  // **A no-op when the XML tab was not offered** — `#vxml` only exists
  // when `documentPanel()` built it, and `showXmlPreview()` already
  // checks for the element before doing anything.
  showXmlPreview(task.subject.id);
  // The comparison follows the printed total as it is typed, not only
  // when a line changes.
  document.getElementById("f-BT-112")?.addEventListener("input", updateTotals);
}

/** How long this has waited, which is the thing that costs money. */
function waited(iso) {
  const then = new Date(iso.replace(" ", "T") + "Z").getTime();
  const days = Math.floor((Date.now() - then) / 86400000);
  return days >= 1 ? `${days}d` : `${Math.max(1, Math.floor((Date.now() - then) / 3600000))}h`;
}
