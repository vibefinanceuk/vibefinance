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
  "action.hold",
  "action.releasehold",
  "action.deactivate",
  "action.activate",
  "action.close",
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
  "documents.searchedcount",
  "documents.unreadable",
  "documents.notread",
  "documents.unknownsender",
  "documents.noprocess",
  "documents.straightthrough",
  "documents.handcount",
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
  "doctype.380",
  "doctype.381",
  "doctype.389",
  "doctype.unknown",
  "action.release",
  "action.key",
  "action.complete",
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
  "viewer.lines",
  "viewer.description",
  "viewer.addline",
  "viewer.removeline",
  "viewer.linetotal",
  "viewer.matches",
  "viewer.differs",
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
    const defined = new Set(rows.results.map((r) => r.key.replace("action.", "")));

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
      "changeseller", "changebuyer",
    ];

    for (const action of asActions) {
      expect(names, `${action} has no icon`).toContain(action);
    }

    const wordless = asActions.filter((a) => !defined.has(a));
    expect(wordless).toEqual([]);
  });
});
