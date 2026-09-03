import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import {
  loadExtractionSettings,
  DEFAULT_EXTRACTION_SETTINGS,
} from "../src/extraction-settings.js";
import {
  handleGetExtractionSettings,
  handleUpdateExtractionSettings,
} from "../src/extraction-settings-route.js";
import { parseExtractionResponse, mergePageResults } from "../src/extraction.js";
import { validateInvoiceFacts } from "../src/validation.js";
import { handleCreateProcess } from "../src/process-route.js";

beforeEach(async () => {
  await applyTestSchema();
  await handleCreateProcess(env.DB, { id: "p-set", name: "Settings" });
  await env.DB.prepare("INSERT INTO intake_channels (id, process_id, name) VALUES ('ch-set', 'p-set', 'Set')").run();
});

describe("loadExtractionSettings", () => {
  it("returns the shipped defaults for a channel nobody has configured", async () => {
    // Applying the migration must change nothing until somebody edits
    // a value — a migration that silently altered how documents are
    // read would be a far worse thing to deploy.
    expect(await loadExtractionSettings(env.DB, "ch-set")).toEqual(DEFAULT_EXTRACTION_SETTINGS);
  });

  it("returns defaults rather than throwing for a channel that does not exist", async () => {
    // Extraction failing because configuration could not be read is a
    // worse outcome than extraction proceeding as it always has.
    expect(await loadExtractionSettings(env.DB, "no-such-channel")).toEqual(DEFAULT_EXTRACTION_SETTINGS);
  });

  it("converts tolerance from minor units, so the configured value is exact", async () => {
    await env.DB.prepare("UPDATE intake_channels SET currency_tolerance_minor = 5 WHERE id = 'ch-set'").run();
    const settings = await loadExtractionSettings(env.DB, "ch-set");
    expect(settings.currencyTolerance).toBe(0.05);
  });
});

describe("the settings genuinely change behaviour", () => {
  const withPhantom = JSON.stringify({
    invoiceNumber: "X",
    lines: [
      { description: "Freight", amount: 100 },
      { description: null, amount: 999 },
    ],
    _confidence: 0.9,
  });

  it("requireLineDescription: false keeps a row the default rejects", async () => {
    // Decision 0052 is a default, not a platform truth. A customer
    // whose rows are identified by code alone needs it off.
    const strict = parseExtractionResponse(withPhantom, "invoice", DEFAULT_EXTRACTION_SETTINGS);
    expect(strict.lines).toHaveLength(1);

    const relaxed = parseExtractionResponse(withPhantom, "invoice", {
      ...DEFAULT_EXTRACTION_SETTINGS,
      requireLineDescription: false,
    });
    expect(relaxed.lines).toHaveLength(2);
  });

  it("maxExtractedLines bounds what is kept, and reports truncation", () => {
    const many = JSON.stringify({
      invoiceNumber: "X",
      lines: Array.from({ length: 40 }, (_, i) => ({ description: `L${i}`, amount: 1 })),
      _confidence: 0.9,
    });
    const capped = parseExtractionResponse(many, "invoice", {
      ...DEFAULT_EXTRACTION_SETTINGS,
      maxExtractedLines: 10,
    });
    expect(capped.lines).toHaveLength(10);
    expect(capped.linesTruncated).toBe(true);

    const roomy = parseExtractionResponse(many, "invoice", {
      ...DEFAULT_EXTRACTION_SETTINGS,
      maxExtractedLines: 100,
    });
    expect(roomy.lines).toHaveLength(40);
    expect(roomy.linesTruncated).toBe(false);
  });

  it("currencyTolerance changes what counts as a match", () => {
    const facts = { "BT-106": 100, "BT-110": 20, "BT-112": 120.04 };
    // A penny apart: fails at the default.
    expect(validateInvoiceFacts(facts).failures).toContain("vat_arithmetic");
    // Five pence of tolerance: passes.
    expect(validateInvoiceFacts(facts, undefined, { currencyTolerance: 0.05 }).failures).not.toContain(
      "vat_arithmetic"
    );
  });

  it("conflictWinner: last takes the later page's value instead", () => {
    const pages = [
      { page: 1, result: { facts: { "BT-112": 2272.47 }, lines: [], linesTruncated: false, confidence: 0.9, missingFields: [], rawModelOutput: "{}" } },
      { page: 2, result: { facts: { "BT-112": 3137.47 }, lines: [], linesTruncated: false, confidence: 0.9, missingFields: [], rawModelOutput: "{}" } },
    ];
    const first = mergePageResults(pages as never, 2);
    expect(first.facts["BT-112"]).toBe(2272.47);

    const last = mergePageResults(pages as never, 2, [], {
      ...DEFAULT_EXTRACTION_SETTINGS,
      conflictWinner: "last",
    });
    // Would have resolved the Morrison case without a rule at all —
    // and hidden the disagreement, which is why it is not the default.
    expect(last.facts["BT-112"]).toBe(3137.47);
    expect(last.facts["extraction.conflicts"]).toBe("BT-112");
  });
});

describe("the settings route", () => {
  it("shows an administrator the current values and why each exists", async () => {
    // A setting nobody can inspect is indistinguishable from
    // hardcoded behaviour.
    const result = await handleGetExtractionSettings(env.DB, "ch-set");
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ channelId: "ch-set", requireLineDescription: true });
    expect((result.body as { provenance: Record<string, string> }).provenance.requireLineDescription).toContain("0052");
  });

  it("404s a channel that does not exist", async () => {
    expect((await handleGetExtractionSettings(env.DB, "nope")).status).toBe(404);
  });

  it("updates a single setting, leaving the others alone", async () => {
    await handleUpdateExtractionSettings(env.DB, "ch-set", { requireLineDescription: false });
    const settings = await loadExtractionSettings(env.DB, "ch-set");
    expect(settings.requireLineDescription).toBe(false);
    expect(settings.maxExtractedLines).toBe(DEFAULT_EXTRACTION_SETTINGS.maxExtractedLines);
  });

  it("refuses a line cap of zero, which would ask for no lines while looking like it asks for some", async () => {
    const result = await handleUpdateExtractionSettings(env.DB, "ch-set", { maxExtractedLines: 0 });
    expect(result.status).toBe(400);
  });

  it("refuses an unbounded line cap, which would reintroduce the timeout", async () => {
    const result = await handleUpdateExtractionSettings(env.DB, "ch-set", { maxExtractedLines: 5000 });
    expect(result.status).toBe(400);
  });

  it("refuses a negative tolerance, which would fail every comparison", async () => {
    const result = await handleUpdateExtractionSettings(env.DB, "ch-set", { currencyToleranceMinor: -1 });
    expect(result.status).toBe(400);
  });

  it("refuses a conflict winner outside the closed set", async () => {
    const result = await handleUpdateExtractionSettings(env.DB, "ch-set", { conflictWinner: "middle" });
    expect(result.status).toBe(400);
  });

  it("refuses a request that sets nothing", async () => {
    const result = await handleUpdateExtractionSettings(env.DB, "ch-set", { somethingElse: true });
    expect(result.status).toBe(400);
  });

  it("returns the new state, so a caller need not re-read it", async () => {
    const result = await handleUpdateExtractionSettings(env.DB, "ch-set", {
      maxExtractedLines: 80,
      conflictWinner: "last",
    });
    expect(result.body).toMatchObject({ maxExtractedLines: 80, conflictWinner: "last" });
  });
});

describe("a capped line list does not fail line_sum", () => {
  it("skips the check entirely when lines were truncated", () => {
    // The shortfall is expected, so comparing it to a stated total
    // would report a mismatch that says nothing about the document —
    // the same reasoning that discards a partial list, applied to a
    // deliberate cap.
    const lines = [{ "BT-131": 100 }, { "BT-131": 200 }];
    const facts = { "BT-106": 3000, "BT-112": 3000 };

    const untruncated = validateInvoiceFacts(facts, lines);
    expect(untruncated.checked).toContain("line_sum");
    expect(untruncated.failures).toContain("line_sum");

    const truncated = validateInvoiceFacts(facts, lines, undefined, true);
    expect(truncated.checked).not.toContain("line_sum");
    expect(truncated.failures).not.toContain("line_sum");
  });
});
