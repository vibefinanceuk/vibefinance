import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleUiStrings } from "../src/ui-strings.js";
import { INVOICE_FIELDS } from "@vibefinance/shared";

/**
 * Every key the interface asks for must exist — decision 0107.
 *
 * **Reported from the screen, not caught here.** The line table's
 * headers read `field.bt-129` and `field.bt-131`, because `t()` falls
 * back to the key when a string is missing and nothing had seeded those
 * two.
 *
 * The fallback is deliberate and worked. What was missing is this: a
 * check that the words a screen asks for are words somebody wrote.
 *
 * Modelled on `field-coverage.test.ts` in `shared`, which refuses any
 * declared vocabulary field the parser cannot produce. Same principle,
 * different pair of layers: **a key nothing defines is a label nobody
 * can read.**
 */

/**
 * The keys the interface uses that are **written out** in the source.
 *
 * A hand-maintained list, deliberately: a scraper would have to parse
 * every computed key and would quietly stop finding them the first time
 * somebody built one a different way.
 *
 * **But the hand is the weakness**, and it showed. Decisions 0110, 0112
 * and 0114 added fields to the screen and nobody added them here, so a
 * live screen read `field.bt-34` and `field.bt-27` — the second time
 * this exact bug was reported from a browser rather than caught here.
 *
 * So the **field** labels are no longer listed by hand. They are
 * derived from the vocabulary below, because the vocabulary is the one
 * place that knows every field, and a field cannot now be declared
 * without a label being demanded for it.
 */
const KEYS_THE_INTERFACE_USES = [
  // Sign-in (index.html, via data-t)
  "product.name",
  "signin.title",
  "signin.email",
  "signin.password",
  "signin.environment",
  "signin.choose",
  "signin.continue",
  "signin.failed",
  "signin.unreachable",
  "signin.noaccess",
  "signin.first",
  // The frame and the task list
  "nav.tasks",
  // The sources screen (decision 0126).
  "nav.sources",
  // The rules screen (decision 0149).
  "nav.rules",
  "rules.subtitle",
  "rules.atstage",
  "rules.order",
  "rules.empty",
  "rules.norules",
  "rules.failed",
  "rules.new",
  "rulestate.live",
  "rulestate.paused",
  "rulestate.awaiting_confirmation",
  "rulestate.draft",
  // An invoice's path (decision 0151).
  "progress.since",
  "progress.revisited",
  "operator.is",
  "operator.is_not",
  "operator.in",
  "operator.not_in",
  "operator.greater_than",
  "operator.less_than",
  "operator.between",
  "operator.starts_with",
  "operator.contains",
  "operator.is_present",
  "operator.is_empty",
  "operator.older_than_days",
  "operator.within_days",
  "readback.the",
  "readback.or",
  "readback.then",
  "readback.when_all",
  "readback.when_any",
  "readback.nested_all",
  "readback.nested_any",
  "readback.check",
  "compose.title",
  "compose.write",
  "compose.compile",
  "compose.plain",
  "compose.needsentence",
  "compose.namelabel",
  "compose.nameplaceholder",
  "compose.compiling",
  "compose.failed",
  "compose.cannot",
  "compose.nothingsaved",
  "compose.willdo",
  "compose.examples",
  "compose.examplesnote",
  "compose.fires",
  "compose.quiet",
  "compose.confirm",
  "compose.confirmed",
  "compose.activate",
  "compose.confirmfirst",
  "compose.allconfirmed",
  "compose.morefacts",
  "rule.title",
  "rule.version",
  "rule.pause",
  "rule.resume",
  "rule.newversion",
  "rule.running",
  "rule.rename",
  "rule.namethis",
  "rule.unnamed",
  "activity.timelinetab",
  "activity.systemalert",
  "viewer.xmltab",
  // The page renderer (decision 0382, phase 2 of
  // docs/design/document-viewer.md).
  "viewer.zoomin",
  "viewer.zoomout",
  "viewer.rotate",
  "viewer.pageof",
  "viewer.thumbnails",
  // Page cycling and the highlight tool, added to the same control
  // row (decision 0394).
  "viewer.previouspage",
  "viewer.nextpage",
  "viewer.highlight",
  // The document pop-out window (decision 0384, phase 4 of
  // docs/design/document-viewer.md).
  "viewer.popupblocked",
  "viewer.openinwindow",
  "viewer.bringtofront",
  "viewer.showhere",
  "activity.loading",
  "activity.empty",
  "activity.placeholder",
  "activity.post",
  "activity.loadfailed",
  "activity.postfailed",
  "activity.received",
  "activity.stagecompleted",
  "activity.rulefired",
  // Decision 0488 — Timeline/Chat entries for claim/release/return/
  // return-to-supplier/discard, derived (not stored) read-time by
  // activity-route.ts's own taskActionEvents/taskEndedEvents.
  "activity.claimed",
  "activity.released",
  "activity.returned",
  "activity.returnedtosupplier",
  "activity.discarded",
  // Decision 0489 — Reassign.
  "action.reassign",
  "action.reassign.wholabel",
  "action.reassign.commentlabel",
  "action.reassign.nonefound",
  "activity.reassigned",
  // Decision 0490 — Return's own picker; the AP Setup section is
  // listed alongside apsetup.stagerestrictions.* further down.
  "action.return.wholabel",
  "action.return.reasonlabel",
  "action.return.nonefound",
  // Decision 0492 — note()'s own pop-out alert, the one label on its
  // single dismiss button. Shared by all nine of note()'s callers.
  "action.ok",
  // Decision 0495 — Route To Approver's own picker.
  "action.route_to_approver",
  "action.route_to_approver.wholabel",
  "action.route_to_approver.nonefound",
  // Decision 0497 — Route To Approver's own optional comment, and its
  // Timeline/Chat line.
  "action.route_to_approver.commentlabel",
  "activity.routedtoapprover",
  // Decision 0498 — Return To Supplier's own picker: reason, comment,
  // the address it will go to, and the CC checkbox.
  "action.return_to_supplier.nonefound",
  "action.return_to_supplier.reasonlabel",
  "action.return_to_supplier.commentlabel",
  "action.return_to_supplier.willgoto",
  "action.return_to_supplier.noemail",
  "action.return_to_supplier.ccapteam",
  "activity.email.sent",
  "activity.email.delivered",
  "activity.email.bounced",
  "activity.email.complained",
  "activity.email.delayed",
  "activity.email.send_failed",
  "rule.notrunning",
  "rule.approvedby",
  "compose.newversion",
  // The mood control (decision 0139).
  "mood.label",
  "mood.day",
  "mood.night",
  "sources.subtitle",
  "sources.name",
  "sources.mechanism",
  "sources.process",
  "sources.address",
  "sources.claim",
  "sources.empty",
  "sources.failed",
  "routing.not_configured",
  "routing.active",
  "routing.suspended",
  // The create form (decision 0128).
  "sources.new",
  "sources.create",
  "sources.needname",
  "sources.nameexample",
  "sources.noprocess",
  "sources.nostages",
  "sources.needletters",
  "sources.toolong",
  "sources.retire",
  "sources.rename",
  "sources.retired",
  // What happened to a source, in the reader's language (0132).
  "outcome.never_used",
  "outcome.documents_arrived",
  "outcome.address_issued",
  "outcome.address_taken",
  "outcome.name_unusable",
  "outcome.not_routed_yet",
  "outcome.no_ingestion_domain",
  "outcome.address_released",
  "outcome.address_would_be_released",
  "sources.confirmrelease",
  "mechanism.email",
  "mechanism.https",
  "mechanism.sftp",
  "mechanism.file_import",
  "mechanism.edi",
  "tasks.signout",
  "tasks.allstages",
  "tasks.everything",
  "tasks.mine",
  "tasks.available",
  "tasks.locked",
  "tasks.stage",
  "tasks.supplier",
  "tasks.amount",
  "tasks.waiting",
  "tasks.owner",
  "tasks.empty",
  "tasks.notkeyed",
  "tasks.nodocument",
  "tasks.loadfailed",
  // The search box and pagination controls — decision 0449. The
  // pagination controls themselves reuse `purchaseorders.*`, already
  // listed below for Documents' own decision-0448 controls.
  "tasks.searchhint",
  "tasks.nomatch",
  "tasks.countsline",
  // Every action a task can report (decisions 0103, 0104)
  "action.claim",
  // The action row (decision 0122).
  "action.expand",
  "action.whyreason",
  "viewer.actionfailed",
  "viewer.unreadable",
  "viewer.tried",
  "viewer.stagelabel",
  "viewer.reflabel",
  "tasks.unclaimed",
  "tasks.line",
  "signin.unavailable",
  "column.unit",
  "nav.suppliers",
  "suppliers.heading",
  "suppliers.mirror",
  "suppliers.failed",
  "suppliers.none",
  "suppliers.neverloaded",
  "suppliers.loadedago",
  "suppliers.hadrefusals",
  "suppliers.loadheading",
  "suppliers.loadhelp",
  "suppliers.loadbutton",
  "suppliers.loading",
  "suppliers.nofile",
  "suppliers.loadfailed",
  "suppliers.loadbroke",
  // The purchase order load screen — decision 0371.
  "nav.purchaseorders",
  "purchaseorders.heading",
  "purchaseorders.subtitle",
  "purchaseorders.loadheading",
  "purchaseorders.loadhelp",
  "purchaseorders.nofile",
  "purchaseorders.loadfailed",
  "purchaseorders.loadbroke",
  "purchaseorders.ordersloaded",
  "purchaseorders.ordersreplaced",
  "purchaseorders.linesloaded",
  "purchaseorders.refusedheading",
  "purchaseorders.refusedorder",
  "purchaseorders.refusedmore",
  // The purchase order list and detail pop-out — decision 0372.
  "purchaseorders.ordernumber",
  "purchaseorders.issuedate",
  "purchaseorders.seller",
  "purchaseorders.buyer",
  "purchaseorders.total",
  "purchaseorders.lines",
  "purchaseorders.none",
  "purchaseorders.failed",
  "purchaseorders.loading",
  "purchaseorders.detailfailed",
  "purchaseorders.ordertype",
  "purchaseorders.currency",
  "purchaseorders.netamount",
  "purchaseorders.taxexclusive",
  "purchaseorders.taxinclusive",
  "purchaseorders.payable",
  "purchaseorders.requisition",
  "purchaseorders.line",
  "purchaseorders.item",
  "purchaseorders.description",
  "purchaseorders.sku",
  "purchaseorders.standardid",
  "purchaseorders.quantity",
  "purchaseorders.unit",
  "purchaseorders.price",
  "purchaseorders.amount",
  // The CSV format reference and template download — decision 0373.
  "action.download",
  "purchaseorders.viewformat",
  "purchaseorders.fieldname",
  "purchaseorders.acceptedcolumns",
  "purchaseorders.required",
  "purchaseorders.headercolumns",
  "purchaseorders.linecolumns",
  // Screen-specific button labels — decision 0373 addendum.
  "purchaseorders.loadbutton",
  "purchaseorders.templatebutton",
  "purchaseorders.org",
  "purchaseorders.searchplaceholder",
  "purchaseorders.rows",
  "purchaseorders.rangeof",
  "purchaseorders.firstpage",
  "purchaseorders.previouspage",
  "purchaseorders.nextpage",
  "purchaseorders.lastpage",
  "purchaseorders.nomatches",
  "purchaseorders.statusheading",
  "purchaseorders.statuslabel",
  "purchaseorders.status.active",
  "purchaseorders.status.onhold",
  "purchaseorders.status.closed",
  "purchaseorders.status.invoicedpart",
  "purchaseorders.status.invoicedfull",
  "purchaseorders.hold",
  "purchaseorders.holdreason",
  "purchaseorders.holdreasonhint",
  "purchaseorders.holdconfirm",
  "purchaseorders.closeorder",
  "purchaseorders.closeconfirm",
  "purchaseorders.statuschangefailed",
  "purchaseorders.nostatusdata",
  "viewer.supplier",
  "viewer.supplier.name",
  "viewer.supplier.vat",
  "viewer.supplier.endpoint",
  "viewer.supplier.email",
  "viewer.supplier.phone",
  "viewer.supplier.find",
  "viewer.supplier.findheading",
  "viewer.supplier.searchhint",
  "viewer.supplier.orleave",
  "viewer.supplier.nomatches",
  "viewer.supplier.searchfailed",
  "viewer.supplier.choosefailed",
  "viewer.supplier.close",
  "viewer.buyer.find",
  "viewer.buyer.change",
  "action.changebuyer",
  "action.headerfields",
  "viewer.allheaderfields",
  "action.hold",
  "action.releasehold",
  "action.deactivate",
  "action.activate",
  "action.close",
  "action.newsupplier",
  "action.load",
  "nav.dashboard",
  "nav.vibeap",
  "nav.collapse",
  "nav.expand",
  "dash.heading",
  "dash.sub",
  "dash.waiting",
  "dash.waitingsub",
  "dash.acrossstages",
  "dash.myclock",
  "dash.myclocksub",
  "dash.nothingmine",
  "dash.supplier",
  "dash.held",
  "dash.due",
  "dash.value",
  "dash.today",
  "dash.overdue",
  "dash.duein",
  "dash.duetoday",
  "dash.mine",
  "dash.theirs",
  "dash.unclaimed",
  "dash.showmine",
  "dash.sort.held",
  "dash.sort.due",
  "dash.sort.value",
  "dash.wherethings",
  "dash.bystage",
  "dash.nothinginflight",
  "dash.astage",
  "dash.stagegone",
  "dash.waitinghere",
  "dash.ageing",
  "dash.ageingsub",
  "dash.done",
  "dash.donesub",
  "dash.thisweek",
  "dash.day.mon",
  "dash.day.tue",
  "dash.day.wed",
  "dash.day.thu",
  "dash.day.fri",
  "dash.day.sat",
  "dash.day.sun",
  "dash.received",
  "dash.receivedsub",
  "dash.nonereceived",
  "dash.exceptions",
  "dash.exceptionssub",
  "dash.noexceptions",
  "dash.needssomebody",
  "dash.needssomebodysub",
  "dash.unplaced",
  "dash.awaitingerp",
  "dash.duplicates",
  "dash.allclear",
  "dash.arrange",
  "dash.done_arranging",
  "dash.addcard",
  "dash.add",
  "dash.remove",
  "dash.reset",
  "dash.whichstage",
  "dash.pickone",
  "dash.savefailed",
  "dash.hiddencards",
  "dash.displayedcards",
  "dash.savechanges",
  "dash.items_at_stage",
  "dash.about.waiting_for_me",
  "dash.about.on_my_clock",
  "dash.about.where_things_are",
  "dash.about.items_at_stage",
  "dash.about.ageing",
  "dash.about.done",
  "dash.about.received",
  "dash.about.exceptions_by_supplier",
  "dash.about.needs_somebody",
  "action.changeseller",
  "viewer.buyer.findheading",
  "viewer.buyer.searchhint",
  "viewer.buyer.why",
  "viewer.buyer.none",
  "viewer.buyer.no_identifier",
  "viewer.buyer.no_match",
  "viewer.buyer.ambiguous_unit",
  "viewer.buyer.no_operating_unit",
  "viewer.supplier.street",
  "viewer.supplier.city",
  "viewer.supplier.postcode",
  "viewer.supplier.country",
  "viewer.supplier.onhold",
  "viewer.supplier.none",
  "viewer.supplier.no_identifier",
  "viewer.supplier.no_match",
  "viewer.supplier.ambiguous_site",
  "suppliers.holdaction",
  "suppliers.release",
  "suppliers.activate",
  "suppliers.deactivate",
  "suppliers.holdreason",
  "suppliers.holdreasonhint",
  "suppliers.holdconfirm",
  "suppliers.save",
  "suppliers.saveanyway",
  "suppliers.mastersays",
  "suppliers.changefailed",
  "suppliers.new",
  "suppliers.create",
  "suppliers.newhelp",
  "suppliers.awaitingerp",
  "suppliers.showingawaiting",
  "suppliers.noneawaiting",
  "suppliers.adopted",
  "viewer.supplier.record",
  "suppliers.site",
  "suppliers.purpose",
  "suppliers.address",
  "suppliers.pay",
  "suppliers.procurement",
  "suppliers.loaded",
  "suppliers.deactivated",
  "suppliers.rematched",
  "suppliers.refusedheading",
  "suppliers.refusedrow",
  "suppliers.refusedmore",
  "suppliers.erpid",
  "suppliers.name",
  "suppliers.vat",
  "suppliers.country",
  "suppliers.terms",
  "suppliers.hold",
  "suppliers.status",
  "suppliers.searchplaceholder",
  "suppliers.rows",
  "suppliers.rangeof",
  "suppliers.firstpage",
  "suppliers.previouspage",
  "suppliers.nextpage",
  "suppliers.lastpage",
  "suppliers.nomatches",
  "suppliers.nostatusdata",
  "sources.org",
  "sources.orgautomatic",
  "sources.orgfailed",
  "documents.nounit",
  "documents.allunits",
  "signin.reachedfailed",
  "viewer.waitinglabel",
  "viewer.ownerlabel",
  "nav.documents",
  "documents.subtitle",
  "documents.searchhint",
  "documents.choosecolumns",
  "documents.none",
  "documents.nomatch",

  /**
   * **`documents.searchedcount` is now orphaned — decision 0448.** It
   * was the "N of M looked through" honesty message for the old
   * in-Worker, load-window search. `documents.js` now sends real
   * `page`/`pageSize` and gets a real `total` back from
   * `documents-route.ts`, covered by `purchaseorders.rangeof` (already
   * listed above, under Purchase Orders — string reuse, not a new
   * pair of keys, the same discipline decision 0447 applied). The row
   * in migration 0044 is left as-is — migrations are append-only and
   * never edited.
   */
  "documents.unreadable",
  "documents.notread",
  "documents.unknownsender",
  "documents.noprocess",
  "documents.straightthrough",
  "documents.handcount",
  "documents.showing.unplaced",
  "documents.showing.duplicates",
  "documents.clearfilter",
  "documents.showing.stage",
  "documents.showing.donebyme",
  "documents.showing.exceptionsupplier",
  "documents.showing.aging",
  "column.number",
  "column.type",
  "column.status",
  "column.amount",
  "column.sender",
  "column.recipient",
  "column.received",
  "column.due",
  "column.stage",
  "column.hands",
  "column.expand",
  "docstatus.waiting",
  "docstatus.moving",
  "docstatus.done",
  "docstatus.unreadable",
  "docstatus.outside",
  "docstatus.returned",
  "docstatus.archived",
  "action.discard.reasonlabel",
  "apsetup.stagerestrictions.discardallowed",
  "doctype.380",
  "doctype.381",
  "doctype.389",
  "doctype.unknown",
  "action.release",
  "action.key",
  "action.complete",
  // The Business Approver's own label for the same complete action —
  // decision 0471, viewer.js's taskActionButtons.
  "action.approve",
  "action.return",
  "action.return_to_supplier",
  "action.discard",
  // The viewer
  "viewer.title",
  "viewer.back",
  "viewer.open",
  "viewer.document",
  "viewer.save",
  "viewer.nodocument",
  "viewer.nothing",
  "viewer.saved",
  "viewer.savefailed",
  "viewer.status",
  "viewer.known",
  "viewer.fields",
  "viewer.actions",
  // The party panels (decision 0115).
  "viewer.seller",
  "viewer.buyer",
  // The validation panel (decision 0119).
  "viewer.exceptions",
  "viewer.noexceptions",
  "viewer.online",
  "viewer.notchecked",
  "check.total_missing",
  "check.vat_arithmetic",
  "check.amount_due_mismatch",
  "check.date_order",
  "check.line_sum",
  "check.code_list",
  "check.po_mismatch", // decision 0400 — PO three-way-match, tagged severity "danger".
  "viewer.lines",
  "viewer.description",
  "viewer.addline",
  "viewer.removeline",
  "viewer.linetotal",
  "viewer.matches",
  "viewer.differs",
  /**
   * **AP Setup's own Account Coding tab (decision 0444).** Its
   * sibling tabs' own strings (decisions 0440, 0442, 0443) were found,
   * while adding these, to have never been added to this list either
   * — a pre-existing gap this decision does not attempt to backfill,
   * named here rather than silently left for the next person to
   * re-discover. Only this decision's own new keys are added below.
   */
  "apsetup.codingtab.companycode",
  "apsetup.codingtab.costcentre",
  "apsetup.codingtab.project",
  "apsetup.codingtab.commoditycode",
  "apsetup.codingtab.glcode",
  "apsetup.codingcompanycodesub",
  "apsetup.codingcostcentresub",
  "apsetup.codingprojectsub",
  "apsetup.codingcommoditycodesub",
  "apsetup.codingglcodesub",
  "apsetup.nocompanycodes",
  "apsetup.nocostcentres",
  "apsetup.noprojects",
  "apsetup.nocommoditycodes",
  "apsetup.noglcodes",
  "apsetup.codingid",
  "apsetup.codingname",
  "apsetup.codingparent",
  "apsetup.codingdefault",
  "apsetup.codingapprover",
  "apsetup.codingapprovallimit",
  "apsetup.codingentrysavefailed",
  /**
   * **Cost-Object Priority — decision 0452.** The Approval Hierarchy
   * tab's own new panel, shown only when Approval mode is Cost-Object;
   * turns decision 0450's mock-up into the real screen.
   */
  "apsetup.costobjectpriority",
  "apsetup.costobjectprioritysub",
  "apsetup.costobjectenable",
  "apsetup.costobjectsavefailed",
  /**
   * **The Matching tab — decision 0472.** Stops being a placeholder:
   * the org-wide default tolerance and quantity-matching toggle
   * `org_matching_config` has held since migration 0078 gets a real
   * form.
   */
  "apsetup.matchingsub",
  "apsetup.amounttolerance",
  "apsetup.quantitytolerance",
  "apsetup.quantitymatchingenabled",
  "apsetup.savematchingfailed",

  /**
   * **Standard matching rules — decision 0474.** A second panel on the
   * same Matching tab: checkboxes that enable/disable a standard rule
   * that already exists. Never compiles or activates one.
   */
  "apsetup.standardrules",
  "apsetup.standardrulessub",
  "apsetup.standardrulenotcreated",
  "apsetup.standardrulesuggested",
  "apsetup.standardrulepending",
  "apsetup.standardrulesavefailed",

  /**
   * **The invoice-line Coding pop-out — decision 0453.** The icon that
   * opens it (`action.coding`) and its own chrome
   * (`viewer.coding.*`) — every field label inside it is reused from
   * elsewhere (`apsetup.codingtab.companycode`, `field.bt-133`,
   * `field.coding.project`, `field.coding.commodity_code`,
   * `field.coding.gl_code`, all already listed above), so only the
   * pop-out's own new strings are added here.
   */
  "action.coding",
  "viewer.coding.heading",
  "viewer.coding.searchhint",
  "viewer.coding.nomatches",
  "viewer.coding.searchfailed",
  "viewer.coding.clear",
  "viewer.coding.noteditable",
  // Account Coding suggestions — decision 0457.
  "viewer.coding.suggested",
  // The Coding pop-out's shared results area — decision 0458.
  "viewer.coding.resultsfor",
  // Decision 0511 — a refused coding save, and the new check's label.
  "check.account_coding",
  "viewer.coding.invalid",
  "viewer.coding.invalid.not_on_list",
  "viewer.coding.invalid.wrong_company",
  "viewer.coding.invalid.wrong_commodity",
  // Decision 0513 — AP Setup's approval exclusions, and a Complete
  // refused for incomplete coding.
  "apsetup.excludevalidationuser",
  "apsetup.excludecodinguser",
  "viewer.coding.incomplete",
  "viewer.coding.missing",
  // Decision 0516 — each Approval Hierarchy mode's own definition.
  "apsetup.modedef.manual",
  "apsetup.modedef.cost_object",
  "apsetup.modedef.employee_supervisor",
  "apsetup.modedef.api",
  // Decision 0517 — re-routing an Approval task over the approver's limit.
  "action.route_to_approver.limitnote",
  // Decision 0534 — suggesting a PO line.
  "pomatch.suggest",
  "pomatch.suggest.score",
  "pomatch.suggest.accept",
  "pomatch.suggest.why.itemcode",
  "pomatch.suggest.why.description",
  "pomatch.suggest.why.price",
  "pomatch.suggest.why.fits",
  "pomatch.col.match",
  "pomatch.legend.ok",
  "pomatch.legend.warn",
  "pomatch.legend.bad",
  "pomatch.legend.dot",
  "pomatch.chip.matched",
  "pomatch.chip.over",
  "pomatch.chip.unit",
  "pomatch.chip.check",
  "pomatch.chip.nopoline",
  "pomatch.suggestedby",
  "pomatch.pop.title",
  "pomatch.pop.sub",
  "pomatch.pop.invoice",
  "pomatch.pop.po",
  "pomatch.pop.open",
  "pomatch.pop.readonly",
  "pomatch.pair.nonpo",
  "pomatch.nonpoby",
  "pomatch.r.nonpo",
  "pomatch.chip.nonpo",
  "pomatch.legend.nonpo",
  "pomatch.codingcleared",
  "pomatch.pop.nonpo",
  "viewer.coding.frompo",
  "viewer.coding.needsnonpo",
  "activity.ponpo",
  "activity.pocodingcleared",
  "viewer.coding.linetitle",
  "viewer.coding.ctx.company",
  "viewer.coding.ctx.supplier",
  "viewer.coding.ctx.nonpo",
  "viewer.coding.sug.title",
  "viewer.coding.sug.accept",
  "viewer.coding.sug.similar",
  "viewer.coding.sug.supplier",
  "viewer.coding.sug.examples",
  "viewer.coding.sug.accepted",
  "viewer.coding.applyothers",
  "viewer.coding.savehint",
  "viewer.coding.done",
  "field.cost_object",
  "viewer.coding.invalid.both",
  "viewer.coding.bothrefused",
  "apsetup.costobject.title",
  "apsetup.costobject.sub",
  "apsetup.costobject.exclusive",
  "apsetup.costobject.exclusive.help",
  "apsetup.costobject.both",
  "apsetup.costobject.both.help",
  "apsetup.costobject.savefailed",
  "viewer.coding.complete",
  "apsetup.codingstatus",
  "apsetup.codingstatus.active",
  "apsetup.codingstatus.closed",
  "apsetup.codingbudget",
  "viewer.coding.invalid.closed",
  "viewer.coding.budget",
  "viewer.coding.overbudget",
  "apsetup.codingglcodes",
  "apsetup.codingglcodes.any",
  "apsetup.codingglcodes.help",
  "viewer.coding.invalid.wrong_cost_centre",
  "viewer.coding.sug.invoice",
  "pomatch.nonpoexcluded",
  // Decision 0545
  "check.po_status",
  "pomatch.onholdwarn",
  "pomatch.onholdwarn.reason",
  "pomatch.closedwarn",
  "matching.standardrule.po_status.name",
  // Decision 0547
  "suppliers.projectonly",
  "suppliers.projectonly.hint",
  "suppliers.projectonly.short",
  "viewer.coding.projectonly",
  "viewer.coding.projectonly.hascc",
  "viewer.coding.invalid.project_required",
  "viewer.coding.invalid.project_only",
  // Decision 0548
  "field.coding.split",
  "viewer.coding.split.add",
  "viewer.coding.split.amount",
  "viewer.coding.split.balanced",
  "viewer.coding.split.budget",
  "viewer.coding.split.byamount",
  "viewer.coding.split.cell",
  "viewer.coding.split.bypct",
  "viewer.coding.split.chip",
  "viewer.coding.split.fill",
  "viewer.coding.split.last",
  "viewer.coding.split.lastwhy",
  "viewer.coding.split.left",
  "viewer.coding.split.over",
  "viewer.coding.split.refused.no_net",
  "viewer.coding.split.refused.not_positive",
  "viewer.coding.split.refused.too_few",
  "viewer.coding.split.refused.too_many",
  "viewer.coding.split.refused.unbalanced",
  "viewer.coding.split.remove",
  "viewer.coding.split.rounding",
  "viewer.coding.split.row",
  "viewer.coding.split.share",
  "viewer.coding.split.start",
  "viewer.coding.split.stop",
  "viewer.coding.split.title",
  "viewer.coding.split.waits",
  "viewer.coding.split.wholeline",
  "viewer.onsplit",
  // Decision 0559
  "routemonitor.alerts",
  "routemonitor.reprocess",
  "routemonitor.reprocessall",
  "routemonitor.dismiss",
  "routemonitor.reprocessfailed",
  "routemonitor.reprocessed",
  "routemonitor.dismisstitle",
  "routemonitor.dismissexplain",
  "routemonitor.dismisslabel",
  "routemonitor.dismissplaceholder",
  "routemonitor.dismissneedsreason",
  "routemonitor.dismissfailed",
  "routemonitor.cannot.outbound",
  "routemonitor.cannot.no_original",
  "routemonitor.cannot.source_retired",
  "routemonitor.cannot.not_failed",
  "routemonitor.cannot.no_bucket",
  "routemonitor.cannot.no_model",
  "routemonitor.event.reprocessed",
  "routemonitor.event.dismissed",
  "routemonitor.alert.explain",
  "routemonitor.alert.allroutes",
  "routemonitor.alert.eachfailure",
  "routemonitor.alert.perday",
  "routemonitor.alert.silent",
  "routemonitor.alert.perdayform",
  "routemonitor.alert.silentform",
  "routemonitor.alert.none",
  "routemonitor.alert.test",
  "routemonitor.alert.change",
  "routemonitor.alert.delete",
  "routemonitor.alert.tested",
  "routemonitor.alert.failed",
  "routemonitor.alert.secret",
  "routemonitor.alert.lastsent",
  "routemonitor.alert.save",
  "routemonitor.alert.add",
  "routemonitor.alert.new",
  "routemonitor.alert.changetitle",
  "routemonitor.alert.route",
  "routemonitor.alert.when",
  "routemonitor.alert.emails",
  "routemonitor.alert.webhook",
  "routemonitor.alert.cancel",
  "routemonitor.alert.refused.nothing_to_alert",
  "routemonitor.alert.refused.no_recipient",
  "routemonitor.alert.refused.invalid_email",
  "routemonitor.alert.refused.invalid_webhook",
  "routemonitor.alert.refused.invalid_threshold",
  "routemonitor.alert.refused.invalid_silence",
  "routemonitor.alert.refused.silence_needs_source",
  "routemonitor.alert.refused.unknown_route",
  // Decision 0558
  "routemonitor.invoicessent",
  "routemonitor.made.sentone",
  "routemonitor.status.undone",
  "routemonitor.made.sent",
  "routemonitor.sentout",
  "routemonitor.sent",
  "routemonitor.by",
  "routemonitor.event.exported",
  "routemonitor.event.undone",
  "routemonitor.event.file_not_stored",
  "routemonitor.error.undone.title",
  "routemonitor.error.undone.body",
  "routemonitor.error.undone.fix",
  "processroutes.pause",
  "processroutes.resume",
  "processroutes.pausefailed",
  "processroutes.pausednote",
  // Decision 0557
  "nav.routes",
  "nav.processroutes",
  "help.screen.routes",
  "help.screen.processroutes",
  "routes.heading",
  "routes.subtitle",
  "routes.failed",
  "routes.sources",
  "routes.sourcessub",
  "routes.destinations",
  "routes.destinationssub",
  "routes.col.route",
  "routes.col.inout",
  "routes.col.placed",
  "routes.col.version",
  "routes.standard",
  "routes.copied",
  "routes.live",
  "routes.draft",
  "routes.notplaced",
  "routes.placedn",
  "routes.placedinlist",
  "routes.dir.source",
  "routes.dir.destination",
  "routes.standardroute",
  "routes.copiedroute",
  "routes.versionn",
  "routes.part.1",
  "routes.part.2",
  "routes.part.3",
  "routes.part.4",
  "routes.part.5",
  "routes.keeporiginal",
  "routes.readsfrom",
  "routes.readonly",
  "routes.gw.email",
  "routes.gw.https",
  "routes.gw.sftp",
  "routes.gw.file_import",
  "routes.gw.edi",
  "routes.gw.peppol",
  "routes.gw.process",
  "routes.gw.file_download",
  "routes.gwd.email",
  "routes.gwd.https",
  "routes.gwd.sftp",
  "routes.gwd.file_import",
  "routes.gwd.edi",
  "routes.gwd.peppol",
  "routes.gwd.process",
  "routes.gwd.file_download",
  "routes.fmt.detected",
  "routes.fmt.ubl",
  "routes.fmt.cii",
  "routes.fmt.factur_x",
  "routes.fmt.supplier_xml",
  "routes.fmt.en16931",
  "routes.fmt.edifact",
  "routes.fmt.csv",
  "routes.fmt.idoc",
  "routes.fmtd.detected",
  "routes.fmtd.en16931",
  "routes.fmtd.csv",
  "routes.fmtd.edifact",
  "routes.fmtd.ubl",
  "routes.fmtd.cii",
  "routes.fmtd.factur_x",
  "routes.fmtd.supplier_xml",
  "routes.fmtd.idoc",
  "routes.tr.standard_intake",
  "routes.tr.erp_csv_v1",
  "routes.trd.standard_intake",
  "routes.trd.erp_csv_v1",
  "processroutes.heading",
  "processroutes.subtitle",
  "processroutes.failed",
  "processroutes.source",
  "processroutes.destination",
  "processroutes.sources",
  "processroutes.destinations",
  "processroutes.deliverto",
  "processroutes.readfrom",
  "processroutes.nosources",
  "processroutes.nodestinations",
  "processroutes.notlive",
  "processroutes.noaddress",
  "processroutes.thisweek",
  "processroutes.failedn",
  "processroutes.waiting",
  "processroutes.sourcesdeliver",
  "processroutes.destsread",
  "processroutes.nostages",
  "processroutes.sourcetitle",
  "processroutes.sourcesub",
  "processroutes.destinationtitle",
  "processroutes.destsub",
  "processroutes.field.route",
  "processroutes.field.deliversto",
  "processroutes.field.readsfrom",
  "processroutes.field.gateway",
  "processroutes.field.status",
  "processroutes.readsfromhint",
  "processroutes.status.active",
  "processroutes.status.paused",
  "processroutes.status.retired",
  "processroutes.openexport",
  "processroutes.erpnote",
  "processroutes.addsource",
  "processroutes.addsourcesub",
  "processroutes.howarrives",
  // Decision 0556
  "nav.routemonitor",
  "help.screen.routemonitor",
  "routemonitor.heading",
  "routemonitor.subtitle",
  "routemonitor.failed",
  "routemonitor.messages",
  "routemonitor.nomessages",
  "routemonitor.pick",
  "routemonitor.tile.received",
  "routemonitor.tile.delivered",
  "routemonitor.tile.failed",
  "routemonitor.tile.waiting",
  "routemonitor.filter.allsources",
  "routemonitor.filter.unclaimed",
  "routemonitor.filter.failedonly",
  "routemonitor.period.today",
  "routemonitor.period.7d",
  "routemonitor.period.30d",
  "routemonitor.col.time",
  "routemonitor.col.route",
  "routemonitor.col.message",
  "routemonitor.col.status",
  "routemonitor.status.delivered",
  "routemonitor.status.partial",
  "routemonitor.status.failed",
  "routemonitor.status.received",
  "routemonitor.status.dismissed",
  "routemonitor.at.gateway",
  "routemonitor.at.format",
  "routemonitor.at.translation",
  "routemonitor.at.delivery",
  "routemonitor.made.one",
  "routemonitor.made.many",
  "routemonitor.made.none",
  "routemonitor.from",
  "routemonitor.unclaimed",
  "routemonitor.nosubject",
  "routemonitor.part.gateway",
  "routemonitor.part.format",
  "routemonitor.part.translation",
  "routemonitor.part.model",
  "routemonitor.part.process",
  "routemonitor.state.ok",
  "routemonitor.state.warn",
  "routemonitor.state.bad",
  "routemonitor.state.idle",
  "routemonitor.tofix",
  "routemonitor.error.no_such_address.title",
  "routemonitor.error.no_such_address.body",
  "routemonitor.error.no_such_address.fix",
  "routemonitor.error.source_retired.title",
  "routemonitor.error.source_retired.body",
  "routemonitor.error.source_retired.fix",
  "routemonitor.error.no_attachment.title",
  "routemonitor.error.no_attachment.body",
  "routemonitor.error.no_attachment.fix",
  "routemonitor.error.unreadable.title",
  "routemonitor.error.unreadable.body",
  "routemonitor.error.unreadable.fix",
  "routemonitor.error.partial.title",
  "routemonitor.error.partial.body",
  "routemonitor.error.partial.fix",
  "routemonitor.error.unknown.title",
  "routemonitor.error.unknown.body",
  "routemonitor.error.unknown.fix",
  "routemonitor.invoices",
  "routemonitor.originals",
  "routemonitor.nooriginals",
  "routemonitor.theemail",
  "routemonitor.download",
  "routemonitor.history",
  "routemonitor.partn",
  "routemonitor.event.received",
  "routemonitor.event.original_stored",
  "routemonitor.event.original_not_stored",
  "routemonitor.event.attachment_not_stored",
  "routemonitor.event.captured",
  "routemonitor.event.capture_failed",
  "routemonitor.event.delivered",
  "routemonitor.event.partial",
  "routemonitor.event.failed",
  // Decision 0554
  "erpexport.undoexplain",
  "erpexport.undolabel",
  "erpexport.undoneedsreason",
  "erpexport.undoplaceholder",
  "erpexport.undotitle",
  // Decision 0553
  "activity.erpexported",
  "activity.erpexportundone",
  "erpexport.undo",
  "erpexport.undofailed",
  "erpexport.undone",
  "erpexport.undoneby",
  "erpexport.undonemsg",
  "erpexport.undoprompt",
  // Decisions 0551 and 0552
  "erpexport.col.by",
  "erpexport.col.invoice",
  "erpexport.col.invoices",
  "erpexport.col.issued",
  "erpexport.col.rows",
  "erpexport.col.supplier",
  "erpexport.col.total",
  "erpexport.col.when",
  "erpexport.conflict",
  "erpexport.done",
  "erpexport.downloadfailed",
  "erpexport.exportnow",
  "erpexport.failed",
  "erpexport.heading",
  "erpexport.history",
  "erpexport.more",
  "erpexport.nohistory",
  "erpexport.none",
  "erpexport.nothing",
  "erpexport.ready",
  "erpexport.readycount",
  "erpexport.subtitle",
  "nav.erpexport",
  "nav.group.integration",
  "nav.groupshort.integration",
  "viewer.coding.split.yourshare",
  "pomatch.why.lines",
  // Decision 0533 — how much of each PO line is used.
  "pomatch.lineuse",
  "pomatch.unusedleft",
  // Decision 0532 — pairing a line by hand.
  "pomatch.pair.own",
  "pomatch.pair.choose",
  "pomatch.pair.option",
  "pomatch.pair.label",
  "pomatch.pairedby",
  "pomatch.supplierref",
  "pomatch.pairfailed",
  "activity.popaired",
  "activity.pocleared",
  // Decision 0530 — the Matching stage's PO matching panel.
  "action.po_matching",
  "activity.polinked",
  "pomatch.title",
  "pomatch.loading",
  "pomatch.loadfailed",
  "pomatch.linked",
  "pomatch.how",
  "pomatch.none",
  "pomatch.notheld",
  "pomatch.ponumber",
  "pomatch.supplier",
  "pomatch.buyer",
  "pomatch.issued",
  "pomatch.status",
  "pomatch.used",
  "pomatch.usedpct",
  "pomatch.over",
  "pomatch.already",
  "pomatch.thisinvoice",
  "pomatch.left",
  "pomatch.of",
  "pomatch.lines",
  "pomatch.clear",
  "pomatch.tolerance",
  "pomatch.invoiceline",
  "pomatch.poline",
  "pomatch.result",
  "pomatch.byref",
  "pomatch.noref",
  "pomatch.refnotfound",
  "pomatch.r.matched",
  "pomatch.r.price",
  "pomatch.r.qty",
  "pomatch.r.unit",
  "pomatch.r.nopoline",
  "pomatch.r.nocompare",
  "pomatch.unused",
  "pomatch.search.title",
  "pomatch.search.titlenone",
  "pomatch.search.placeholder",
  "pomatch.f.supplier",
  "pomatch.f.active",
  "pomatch.f.covers",
  "pomatch.col.po",
  "pomatch.col.supplier",
  "pomatch.col.issued",
  "pomatch.col.total",
  "pomatch.col.used",
  "pomatch.col.left",
  "pomatch.col.status",
  "pomatch.col.why",
  "pomatch.why.supplier",
  "pomatch.why.covers",
  "pomatch.why.currency",
  "pomatch.use",
  "pomatch.current",
  "pomatch.noresults",
  "pomatch.relinkhint",
  "pomatch.linkfailed",
  "pomatch.foot",
  // Decision 0525 — the folded nav's short group headings.
  "nav.groupshort.accountspayable",
  "nav.groupshort.suppliermanagement",
  "nav.groupshort.configuration",
  // Decision 0521 — the Tasks list's new headings.
  "tasks.document",
  "tasks.received",
  "tasks.action",
  // Decision 0519 — Ask, its own panel.
  "ask.button",
  "ask.title",
  "ask.intro",
  // Decision 0518 — in-app Help.
  "help.button",
  "help.title",
  "help.aboutpage",
  "help.atstage",
  "help.noactions",
  "help.ask.placeholder",
  "help.ask.button",
  "help.ask.thinking",
  "help.ask.failed",
  "help.ask.disclaimer",
  "help.screen.dashboard",
  "help.screen.tasks",
  "help.screen.documents",
  "help.screen.suppliers",
  "help.screen.access",
  "help.screen.sources",
  "help.screen.purchaseorders",
  "help.screen.rules",
  "help.screen.processes",
  "help.screen.apsetup",
  "help.screen.apanalytics",
  "help.screen.viewer",
  "help.action.claim",
  "help.action.complete",
  "help.action.route_to_approver",
  "help.action.release",
  "help.action.reassign",
  "help.action.key",
  "help.action.return",
  "help.action.return_to_supplier",
  "help.action.discard",
  "help.reason.task_closed",
  "help.reason.claimed_by_other",
  "help.reason.team_task_unclaimed",
  "help.reason.lacks_permission",
  "help.reason.limit_insufficient",
  "help.reason.choose_next_approver",
  "help.reason.limit_covers",
  "help.reason.complete_moves_on",
  "help.reason.coding_incomplete",
  "help.reason.return_targets",
  "help.reason.return_no_targets",
  "help.reason.discard_not_here",
  // A filtered field's own empty result names what narrowed it —
  // decision 0459.
  "viewer.coding.nomatchesscoped",
  // "Add person to conversation" — decision 0470's own
  // `collaborators.js`.
  "activity.addperson",
  "activity.addpersonsearch",
  "activity.addpersonnomatches",
  "activity.addpersonfailed",
  "activity.collaborators",
  // Removing a collaborator — decision 0476's own extension of the
  // same `collaborators.js`, the "x" on each chip.
  "activity.removeperson",
  "activity.removepersonfailed",

  /**
   * **CSV Template and Load — decision 0445.** `coding-lists.js`'s own
   * new `csvLoaderPanel()`/`csvFormatReference()`/`csvOutcome()`.
   * The Template/Load buttons themselves were re-pointed at
   * `purchaseorders.loadbutton`/`purchaseorders.templatebutton` by
   * decision 0447 (string reuse, not a new pair of keys) — those two
   * keys are already listed above, under Purchase Orders. The
   * `apsetup.csvloadbutton`/`apsetup.csvtemplatebutton` rows in
   * migration 0148 are now orphaned (harmless — migrations are
   * append-only and never edited).
   */
  "apsetup.csvloadheading",
  "apsetup.csvloadhelp",
  "apsetup.csvnofile",
  "apsetup.csvloadfailed",
  "apsetup.csvloadbroke",
  "apsetup.csventriescreated",
  "apsetup.csventriesupdated",
  "apsetup.csvrefusedheading",
  "apsetup.csvrefusedentry",
  "apsetup.csvrefusedmore",
  "apsetup.csvviewformat",
  "apsetup.csvfieldname",
  "apsetup.csvacceptedcolumns",
  "apsetup.csvrequired",

  /**
   * **Search and real pagination — decision 0446.** `coding-lists.js`'s
   * own `searchAndPaginationRow()`; the page-nav labels themselves
   * (`purchaseorders.rows`/`.firstpage`/`.previouspage`/`.nextpage`/
   * `.lastpage`/`.rangeof`) are covered already, under Purchase
   * Orders' own entries above — reused here, not duplicated.
   */
  "apsetup.codingsearchplaceholder",
  "apsetup.codingnomatches",

  /**
   * **Stage Restrictions — decisions 0483 and 0485.** Never added when
   * 0483 shipped (migration 0165 was itself missing from `setup.ts`
   * until 0485 found and fixed both gaps together, below) — added now
   * rather than left for the next person to re-discover, matching
   * decision 0444's own precedent for a pre-existing gap found mid-way
   * through unrelated work.
   */
  "apsetup.stagerestrictions",
  "apsetup.stagerestrictions.sub",
  "apsetup.stagerestrictions.process",
  "apsetup.stagerestrictions.noprocess",
  "apsetup.stagerestrictions.fieldsheading",
  "apsetup.stagerestrictions.fieldshint",
  "apsetup.stagerestrictions.hiddeneverywhere",
  "apsetup.stagerestrictions.savefailed",
  // Which stages the screen even offers a checkbox for — decision 0485.
  "apsetup.stagerestrictions.offerhere",
  "apsetup.stagerestrictions.notoffered",
  // What Complete does at a stage — decision 0487.
  "apsetup.stagerestrictions.reverifyoncomplete",
  // Where Return can send a document from a stage, and who receives
  // it — decision 0490.
  "apsetup.stagerestrictions.returntargetsheading",
  "apsetup.stagerestrictions.returntargetshint",
  "apsetup.stagerestrictions.notargetsyet",
  "apsetup.stagerestrictions.targetstage",
  "apsetup.stagerestrictions.returnteam",
  // Decision 0498 — the Return Reasons tab: the reasons list itself
  // and the AP team's own email address.
  "apsetup.returnreasons",
  "apsetup.returnreasons.sub",
  "apsetup.returnreasons.active",
  "apsetup.returnreasons.newid",
  "apsetup.returnreasons.newlabel",
  "apsetup.returnreasons.idandlabelrequired",
  "apsetup.returnreasons.savefailed",
  "apsetup.returnreasons.apteamemail",
  "apsetup.returnreasons.apteamemailsub",
  "apsetup.returnreasons.apteamemailplaceholder",
  /**
   * **`apsetup.add` and `roles.remove` — a pre-existing gap, found and
   * closed here, the same "found mid-way through unrelated work"
   * precedent decision 0485's own comment above already states.**
   * Both are real, seeded strings (migrations 0096 and 0145) that
   * `ap-setup.js`'s own supervisor- and limit-override sections have
   * used since decision 0440/0442 — never added to this hand-kept
   * list. Decision 0490's own new Return targets section reuses both
   * directly for its add-row button and each configured row's own
   * remove button, which is what surfaced the gap.
   */
  "apsetup.add",
  "roles.remove",
  // Decisions 0560 to 0562: receiving formats and EN 16931 checks,
  // supplier mappings and the mapping editor, and its help.
  "routes.formats.heading",
  "routes.formats.sub",
  "routes.formats.col.format",
  "routes.formats.col.how",
  "routes.formats.col.checked",
  "routes.formats.col.days",
  "routes.formats.xrechnung",
  "routes.formats.xrechnung.syntax",
  "routes.formats.xrechnung.how",
  "routes.formats.xrechnung.checked",
  "routes.formats.peppol_bis_3",
  "routes.formats.peppol_bis_3.syntax",
  "routes.formats.peppol_bis_3.how",
  "routes.formats.peppol_bis_3.checked",
  "routes.formats.en16931",
  "routes.formats.en16931.syntax",
  "routes.formats.en16931.how",
  "routes.formats.en16931.checked",
  "routes.formats.factur_x",
  "routes.formats.factur_x.syntax",
  "routes.formats.factur_x.how",
  "routes.formats.factur_x.checked",
  "routes.formats.other",
  "routes.formats.other.syntax",
  "routes.formats.other.how",
  "routes.formats.other.checked",
  "routes.formats.picture",
  "routes.formats.picture.syntax",
  "routes.formats.picture.how",
  "routes.formats.picture.checked",
  "routes.formats.failing",
  "routes.formats.unread",
  "routes.formats.notstopped.h",
  "routes.formats.notstopped",
  "routes.format.peppol_bis_3",
  "routes.format.xrechnung",
  "routes.format.en16931",
  "routes.format.factur_x_extended",
  "routes.format.factur_x_basic",
  "routes.format.factur_x_basic_wl",
  "routes.format.factur_x_minimum",
  "routes.format.ubl_other",
  "routes.format.cii_other",
  "routes.syntax.ubl",
  "routes.syntax.cii",
  "routemonitor.checks",
  "routemonitor.passed",
  "routemonitor.notchecked",
  "routemonitor.notcheckedwhy",
  "routemonitor.brokenn",
  "routemonitor.notstopped",
  "routemonitor.event.en16931_failed",
  "en16931.rule.br-01",
  "en16931.rule.br-02",
  "en16931.rule.br-03",
  "en16931.rule.br-04",
  "en16931.rule.br-05",
  "en16931.rule.br-06",
  "en16931.rule.br-07",
  "en16931.rule.br-08",
  "en16931.rule.br-09",
  "en16931.rule.br-10",
  "en16931.rule.br-11",
  "en16931.rule.br-12",
  "en16931.rule.br-13",
  "en16931.rule.br-14",
  "en16931.rule.br-15",
  "en16931.rule.br-16",
  "en16931.rule.br-21",
  "en16931.rule.br-22",
  "en16931.rule.br-23",
  "en16931.rule.br-24",
  "en16931.rule.br-25",
  "en16931.rule.br-26",
  "en16931.rule.br-27",
  "en16931.rule.br-co-9",
  "en16931.rule.br-co-10",
  "en16931.rule.br-co-13",
  "en16931.rule.br-co-15",
  "en16931.rule.br-co-16",
  "en16931.rule.br-co-25",
  "en16931.rule.br-de-15",
  "mapping.title",
  "mapping.subtitle",
  "mapping.draftn",
  "mapping.liven",
  "mapping.livebeside",
  "mapping.samplefrom",
  "mapping.heading",
  "mapping.counts",
  "mapping.legend.line",
  "mapping.legend.fx",
  "mapping.legend.required",
  "mapping.receiving",
  "mapping.receivingsub",
  "mapping.eachline",
  "mapping.delivery",
  "mapping.deliverysub",
  "mapping.invoice",
  "mapping.invoiceline",
  "mapping.fixed",
  "mapping.needed",
  "mapping.howto",
  "mapping.howtotext",
  "mapping.required",
  "mapping.optional",
  "mapping.choosesource",
  "mapping.orfixed",
  "mapping.fixedplaceholder",
  "mapping.usefixed",
  "mapping.from",
  "mapping.sample",
  "mapping.function",
  "mapping.nofunction",
  "mapping.sayplaceholder",
  "mapping.understand",
  "mapping.understood",
  "mapping.examples",
  "mapping.none",
  "mapping.accept",
  "mapping.compilefailed",
  "mapping.removefunction",
  "mapping.removeline",
  "mapping.try",
  "mapping.tryfailed",
  "mapping.tried",
  "mapping.triedsummary",
  "mapping.problems",
  "mapping.noproblems",
  "mapping.linen",
  "mapping.publish",
  "mapping.publishrefused",
  "mapping.publishfailed",
  "mapping.published",
  "mapping.waiting",
  "mapping.nowaiting",
  "mapping.reprocess",
  "mapping.reprocessed",
  "mapping.reprocessforbidden",
  "mapping.reprocessfailed",
  "mapping.back",
  "mapping.settings",
  "mapping.name",
  "mapping.senders",
  "mapping.sendersplaceholder",
  "mapping.linesat",
  "mapping.nolines",
  "mapping.linesreset",
  "mapping.saved",
  "mapping.savefailed",
  "mapping.scope.line",
  "mapping.scope.header",
  "mapping.nosample",
  "mapping.loadfailed",
  "mapping.fn.read_date",
  "mapping.fn.write_date",
  "mapping.fn.decimal_comma",
  "mapping.fn.number",
  "mapping.fn.round",
  "mapping.fn.multiply",
  "mapping.fn.trim",
  "mapping.fn.upper",
  "mapping.fn.lower",
  "mapping.fn.first_letters",
  "mapping.fn.last_letters",
  "mapping.fn.remove_prefix",
  "mapping.fn.replace",
  "mapping.fn.remove_spaces",
  "mapping.fn.country_to_code",
  "mapping.fn.code_to_country",
  "mapping.fn.unit_code",
  "mapping.fn.if_empty",
  "mapping.fn.always",
  "mapping.bt.bt-1",
  "mapping.bt.bt-2",
  "mapping.bt.bt-3",
  "mapping.bt.bt-5",
  "mapping.bt.bt-9",
  "mapping.bt.bt-10",
  "mapping.bt.bt-11",
  "mapping.bt.bt-13",
  "mapping.bt.bt-20",
  "mapping.bt.bt-27",
  "mapping.bt.bt-31",
  "mapping.bt.bt-34",
  "mapping.bt.bt-40",
  "mapping.bt.bt-44",
  "mapping.bt.bt-48",
  "mapping.bt.bt-49",
  "mapping.bt.bt-55",
  "mapping.bt.bt-106",
  "mapping.bt.bt-109",
  "mapping.bt.bt-110",
  "mapping.bt.bt-112",
  "mapping.bt.bt-115",
  "mapping.bt.bt-126",
  "mapping.bt.bt-127",
  "mapping.bt.bt-129",
  "mapping.bt.bt-130",
  "mapping.bt.bt-131",
  "mapping.bt.bt-132",
  "mapping.bt.bt-133",
  "mapping.bt.bt-146",
  "mapping.bt.bt-151",
  "mapping.bt.bt-152",
  "mapping.bt.bt-153",
  "mapping.bt.bt-154",
  "routemonitor.error.no_mapping.title",
  "routemonitor.error.no_mapping.body",
  "routemonitor.error.no_mapping.fix",
  "routemonitor.error.mapping_failed.title",
  "routemonitor.error.mapping_failed.body",
  "routemonitor.error.mapping_failed.fix",
  "routemonitor.mapthis",
  "routemonitor.openmapping",
  "routemonitor.nomapping",
  "routemonitor.mappingfailed",
  "routemonitor.nomappingwhy",
  "routemonitor.readwith",
  "routemonitor.mapforbidden",
  "routemonitor.mapfailed",
  "routes.format.supplier_xml",
  "routes.formats.supplier_xml",
  "routes.formats.supplier_xml.syntax",
  "routes.formats.supplier_xml.how",
  "routes.formats.supplier_xml.checked",
  "routes.mappings.heading",
  "routes.mappings.sub",
  "routes.mappings.none",
  "routes.mappings.failed",
  "routes.mappings.col.mapping",
  "routes.mappings.col.version",
  "routes.mappings.anyone",
  "routes.mappings.read",
  "routes.mappings.waiting",
  "routes.mappings.open",
  "help.screen.mapping",
  "help.screen.mapping.2",
  "help.screen.mapping.3",
  "help.screen.mapping.4",
  "help.screen.mapping.5",
  "help.screen.mapping.6",
  "help.screen.mapping.7",
  "help.screen.mapping.8",
  "help.screen.mapping.9",
  "help.screen.mapping.10",
  "help.screen.mapping.11",
  "help.screen.mapping.12",
  "help.screen.mapping.13",
  "help.screen.mapping.14",
  "help.screen.mapping.15",
  "help.screen.mapping.16",
  "help.screen.mapping.17",
  "help.screen.mapping.18",
  "help.screen.mapping.19",
  "help.screen.mapping.20",
  "help.screen.mapping.21",
  "help.screen.mapping.22",
  "help.screen.mapping.23",
  "help.screen.mapping.24",
  "help.screen.mapping.25",
  "help.screen.mapping.26",
  "help.screen.mapping.27",
  "help.screen.mapping.28",
  "help.screen.mapping.29",
  "help.screen.mapping.30",
  "help.screen.mapping.31",
  "help.screen.mapping.32",
  "help.screen.mapping.33",
  "help.screen.mapping.34",
  "mapping.retire",
  "mapping.retiretitle",
  "routes.format.supplier_csv",
  "routes.formats.supplier_csv",
  "routes.formats.supplier_csv.syntax",
  "routes.formats.supplier_csv.how",
  "routes.formats.supplier_csv.checked",
  "routemonitor.error.no_mapping_csv.title",
  "routemonitor.error.no_mapping_csv.body",
  "routemonitor.error.no_mapping_csv.fix",
  "routemonitor.error.mapping_failed_csv.title",
  "routemonitor.error.mapping_failed_csv.body",
  "routemonitor.error.mapping_failed_csv.fix",
  "routemonitor.nomappingwhy_csv",
  "mapping.csv.heading",
  "mapping.csv.receivingsub",
  "mapping.csv.first",
  "mapping.csv.rows",
  "mapping.csv.delimiter",
  "mapping.csv.delim.semicolon",
  "mapping.csv.delim.comma",
  "mapping.csv.delim.tab",
  "mapping.csv.delim.bar",
  "mapping.csv.header",
  "mapping.csv.headeryes",
  "mapping.csv.skip",
  "mapping.sumlines",
  "help.screen.mapping.38",
  "help.screen.mapping.39",
  "help.screen.mapping.40",
  "help.screen.mapping.41",
  "help.screen.mapping.42",
  "help.screen.mapping.43",
  "help.screen.routes.9",
  "mapping.retireconfirm.live",
  "mapping.retireconfirm.draft",
  "mapping.retireyes",
  "mapping.retireno",
  "mapping.retirefailed",
  "mapping.retired",
  "mapping.retireddone",
  "routemonitor.error.not_for_sender.title",
  "routemonitor.error.not_for_sender.body",
  "routemonitor.error.not_for_sender.fix",
  "routemonitor.error.not_published.title",
  "routemonitor.error.not_published.body",
  "routemonitor.error.not_published.fix",
  "routemonitor.notforsender",
  "routemonitor.notpublished",
  "routemonitor.notforsenderwhy",
  "routemonitor.notpublishedwhy",
  "help.screen.mapping.35",
  "help.screen.mapping.36",
  "help.screen.mapping.37",
  "help.screen.routes.2",
  "help.screen.routes.3",
  "help.screen.routes.4",
  "help.screen.routes.5",
  "help.screen.routes.6",
  "help.screen.routes.7",
  "help.screen.routes.8",
  "help.screen.routemonitor.2",
  "help.screen.routemonitor.3",
  "help.screen.routemonitor.4",
  "help.screen.routemonitor.5",
  "help.screen.routemonitor.6",
  "help.screen.routemonitor.7",
  "help.screen.routemonitor.8",
];

/**
 * A label for **every field the vocabulary declares**, derived rather
 * than listed.
 *
 * Field visibility (decision 0114) means any declared field can reach a
 * screen the moment a customer configures it — so "the fields the
 * viewer happens to show today" is the wrong set to check.
 */
const FIELD_LABEL_KEYS = INVOICE_FIELDS.map((field) => `field.${field.toLowerCase()}`);

beforeEach(async () => {
  await applyTestSchema();
});

describe("every key the interface uses has a word behind it", () => {
  it("defines all of them in English", async () => {
    const body = (await (await handleUiStrings(env.CONTROL_DB, "en")).json()) as {
      strings: Record<string, string>;
    };

    const missing = [...KEYS_THE_INTERFACE_USES, ...FIELD_LABEL_KEYS].filter((key) => !body.strings[key]);
    expect(
      missing,
      `Used by the interface and defined nowhere: ${missing.join(", ")}. ` +
        "Seed it in a migration, or stop asking for it. A key nothing " +
        "defines renders as itself, which is what `field.bt-129` did on " +
        "a live screen."
    ).toEqual([]);
  });

  it("defines none of them as a dotted key by accident", async () => {
    // A label that IS its own key would pass the check above while
    // reading exactly as broken.
    const body = (await (await handleUiStrings(env.CONTROL_DB, "en")).json()) as {
      strings: Record<string, string>;
    };

    const selfReferential = [...KEYS_THE_INTERFACE_USES, ...FIELD_LABEL_KEYS].filter(
      (key) => body.strings[key] === key
    );
    expect(selfReferential).toEqual([]);
  });

  it("gives a field label that a person would recognise", async () => {
    // The specification's own business term names, in the form somebody
    // keying an invoice would use.
    const body = (await (await handleUiStrings(env.CONTROL_DB, "en")).json()) as {
      strings: Record<string, string>;
    };

    expect(body.strings["field.bt-129"]).toBe("Quantity");
    expect(body.strings["field.bt-131"]).toBe("Line net amount");
    expect(body.strings["field.bt-153"]).toBe("Item name");
  });
});

describe("every declared field has a label (decision 0114)", () => {
  /**
   * **Derived, not listed.** Field visibility means any declared field
   * can reach a screen the moment a customer configures it, so checking
   * only the fields the viewer shows today would pass while a
   * configurable field had no name.
   *
   * This is what should have caught `field.bt-34` before a browser did.
   */
  it("names all of them, not only the ones on screen today", async () => {
    const body = (await (await handleUiStrings(env.CONTROL_DB, "en")).json()) as {
      strings: Record<string, string>;
    };

    const missing = INVOICE_FIELDS.filter((field) => !body.strings[`field.${field.toLowerCase()}`]);
    expect(
      missing,
      `Declared in the vocabulary and unnamed: ${missing.join(", ")}. ` +
        "Seed a label in a migration. A field a customer can make visible " +
        "and cannot read the name of is worse than one they cannot see."
    ).toEqual([]);
  });

  it("names the ones a browser reported", async () => {
    // Verbatim from the report: these read as dotted keys on a live
    // screen after decisions 0112 and 0114 made them reachable.
    const body = (await (await handleUiStrings(env.CONTROL_DB, "en")).json()) as {
      strings: Record<string, string>;
    };

    expect(body.strings["field.bt-27"]).toBe("Seller name");
    expect(body.strings["field.bt-44"]).toBe("Buyer name");
    expect(body.strings["field.bt-49"]).toBe("Buyer electronic address");
    expect(body.strings["field.bt-151"]).toBe("VAT category");
  });
});

describe("every action and operator has a word (decision 0158)", () => {
  /**
   * **Derived from the vocabulary, not from a list somebody keeps.**
   *
   * `action.assign_org` rendered as its own key on the rule screen,
   * because decision 0111 added the action and nobody wrote the label —
   * and until decision 0153 nothing displayed an action's name, so
   * nobody saw.
   *
   * A hand-kept list would have had the same gap, which is the shape
   * decision 0107 already records: the field-label test decayed until
   * it derived its expectations from the code.
   */
  it("labels every action the vocabulary defines", async () => {
    const { ACTIONS } = await import("@vibefinance/shared");

    const rows = await env.CONTROL_DB.prepare(
      "SELECT key FROM ui_strings WHERE key LIKE 'action.%' AND locale = 'en'"
    ).all<{ key: string }>();
    const labelled = new Set(rows.results.map((r: { key: string }) => r.key));

    const missing = ACTIONS.filter((a) => !labelled.has(`action.${a}`));

    expect(
      missing,
      `Actions with no label: ${missing.join(", ")}. A screen rendering ` +
        "`action.assign_org` is a screen showing a customer our column names."
    ).toEqual([]);
  });

  it("labels every operator too", async () => {
    // The read-back renders these as a rule's grammar (decision 0153),
    // so a missing one puts a key mid-sentence.
    const { OPERATORS } = await import("@vibefinance/shared");

    const rows = await env.CONTROL_DB.prepare(
      "SELECT key FROM ui_strings WHERE key LIKE 'operator.%' AND locale = 'en'"
    ).all<{ key: string }>();
    const labelled = new Set(rows.results.map((r: { key: string }) => r.key));

    const missing = OPERATORS.filter((o) => !labelled.has(`operator.${o}`));
    expect(missing, `Operators with no label: ${missing.join(", ")}`).toEqual([]);
  });
});

describe("every field a screen renders has a word (decision 0172)", () => {
  /**
   * **`field.description` reached a screen as its own key.**
   *
   * Decision 0171 added the line description as a *displayable* field
   * rather than a vocabulary one — deliberately, since no rule can test
   * it — and every field label comes from `field.<code>` in D1.
   *
   * Decision 0158's check derives action and operator labels **from the
   * vocabulary**, so a field that is deliberately outside it could
   * never be caught that way. This asks the resolver instead: whatever
   * a screen is given, it must have a word for.
   */
  it("labels every field the resolver returns", async () => {
    const { INVOICE_FIELDS } = await import("@vibefinance/shared");

    const rows = await env.CONTROL_DB.prepare(
      "SELECT key FROM ui_strings WHERE key LIKE 'field.%' AND locale = 'en'"
    ).all<{ key: string }>();
    const labelled = new Set(rows.results.map((r: { key: string }) => r.key));

    // The vocabulary, plus the displayable fields decision 0171 adds.
    const rendered = [...INVOICE_FIELDS, "description"];
    const missing = rendered.filter((f) => !labelled.has(`field.${f.toLowerCase()}`));

    expect(
      missing,
      `Fields with no label: ${missing.join(", ")}. A screen rendering ` +
        "`field.description` is a screen showing a customer our own key."
    ).toEqual([]);
  });
});

describe("every action a button names has words (decision 0236)", () => {
  /**
   * **`action.activate` never existed.**
   *
   * Migration 0065 left it out on a claim it was already defined, which
   * came from a grep that matched `action.save` twice — and the same
   * edit took it out of the list above, so nothing noticed. The button
   * rendered its own key on screen, in a product.
   *
   * **A list checked against itself is not a check.** This reads the
   * icon set instead, which is the other end of the same pair:
   * `actionLink` draws `ICONS[name]` and labels it `t("action." +
   * name)`, so **every glyph needs a string and a missing one is a raw
   * key in the interface.**
   */
  it("defines a string for every icon an action can use", async () => {
    const icons = await import("../../vf-ui/public/icons.js?raw");
    const names = [...(icons.default as string).matchAll(/^\s{2}([a-z]+):/gm)].map((m) => m[1]);

    // A guard on the guard: a pattern matching nothing would pass.
    expect(names.length).toBeGreaterThan(10);

    const rows = await env.CONTROL_DB.prepare(
      "SELECT key FROM ui_strings WHERE key LIKE 'action.%' AND locale = 'en'"
    ).all<{ key: string }>();
    const defined = new Set(rows.results.map((r: { key: string }) => r.key.replace("action.", "")));

    /**
     * **Not every icon labels an action.** `paused` marks a rule's
     * state rather than a button, and `compile` sits **inside** a
     * button whose words come from elsewhere — both are drawn with
     * `icon()` directly and never through `actionLink`.
     *
     * The first version of this list had `compile` in it, and the test
     * failed: **a glyph used one way does not need what a glyph used
     * the other way does.** Named explicitly for that reason — a new
     * action added without a string fails on the line that lists it.
     */
    const asActions = [
      "expand", "save", "complete", "release", "return", "discard", "claim",
      "activate", "deactivate", "hold", "releasehold", "close",
      "changeseller", "changebuyer", "newsupplier", "load",
    ];

    for (const action of asActions) {
      expect(names, `${action} has no icon`).toContain(action);
    }

    const wordless = asActions.filter((a) => !defined.has(a));
    expect(wordless).toEqual([]);
  });
});

describe("every key the dashboard asks for exists (decision 0249)", () => {
  /**
   * **The list above checks keys the migrations define.** That is a
   * list checked against itself — decision 0236's finding — and it
   * passed while the picker listed `dash.waiting_for_me` to a person
   * choosing what to see.
   *
   * This reads the **source**, which is the other end: every
   * `t("dash.…")` in `dashboard.js`, and every name the picker builds
   * from a card type.
   */
  it("defines every dash key the screen looks up", async () => {
    const source = (await import("../../vf-ui/public/dashboard.js?raw")).default as string;

    /**
     * The literal ones, plus the two the picker composes — `dash.` and
     * `dash.about.` plus a card type, which is exactly where the fault
     * was: **a key built at runtime is invisible to a grep for
     * `t("dash.x")`.**
     */
    const literal = [...source.matchAll(/t\("(dash\.[a-z._]+)"\)/g)].map((m) => m[1]);
    const composed = [...source.matchAll(/`dash\.(?:about\.)?\$\{/g)].length;

    expect(literal.length).toBeGreaterThan(10);
    expect(composed).toBeGreaterThan(0);

    const { CARD_TYPES } = await import("../../vf-app/src/dashboard-route.js");
    const built = (CARD_TYPES as readonly string[]).flatMap((type) => [
      `dash.${type}`,
      `dash.about.${type}`,
    ]);

    const rows = await env.CONTROL_DB.prepare(
      "SELECT key FROM ui_strings WHERE locale = 'en'"
    ).all<{ key: string }>();
    const defined = new Set(rows.results.map((r: { key: string }) => r.key));

    const missing = [...new Set([...literal, ...built])].filter((k) => !defined.has(k));
    expect(missing).toEqual([]);
  });
});
