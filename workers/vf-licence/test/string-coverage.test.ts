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
