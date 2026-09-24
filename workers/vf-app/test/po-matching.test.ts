import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleIngestPurchaseOrder } from "../src/purchase-order-route.js";
import { computePoMatch, computePoLineMatch, mergePoMatchFacts, getOrgMatchingConfig } from "../src/po-matching.js";

const ORDER = `<?xml version="1.0" encoding="UTF-8"?>
<Order xmlns="urn:oasis:names:specification:ubl:schema:xsd:Order-2"
       xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
       xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>PO-500</cbc:ID>
  <cac:BuyerCustomerParty><cac:Party><cac:PartyIdentification><cbc:ID>GB123456789</cbc:ID></cac:PartyIdentification></cac:Party></cac:BuyerCustomerParty>
  <cac:AnticipatedMonetaryTotal>
    <cbc:PayableAmount currencyID="EUR">1000</cbc:PayableAmount>
  </cac:AnticipatedMonetaryTotal>
  <cac:OrderLine><cac:LineItem>
    <cbc:ID>1</cbc:ID>
    <cbc:Quantity unitCode="EA">100</cbc:Quantity>
    <cbc:LineExtensionAmount currencyID="EUR">600</cbc:LineExtensionAmount>
    <cac:Item><cbc:Name>Widgets</cbc:Name></cac:Item>
  </cac:LineItem></cac:OrderLine>
  <cac:OrderLine><cac:LineItem>
    <cbc:ID>2</cbc:ID>
    <cbc:Quantity unitCode="EA">50</cbc:Quantity>
    <cbc:LineExtensionAmount currencyID="EUR">400</cbc:LineExtensionAmount>
    <cac:Item><cbc:Name>Gadgets</cbc:Name></cac:Item>
  </cac:LineItem></cac:OrderLine>
</Order>`;

beforeEach(async () => {
  await applyTestSchema();
  // Decision 0374 — every order now needs a real, matching legal
  // entity or it is refused at ingestion. This fixture's own buyer tax
  // reference (GB123456789) is otherwise arbitrary, chosen only to be
  // distinct from any other test file's own.
  await env.DB.prepare("INSERT INTO org_units (id, name, kind, vat_id) VALUES ('acme-po', 'Acme', 'legal_entity', 'GB123456789')").run();
  await handleIngestPurchaseOrder(env.DB, ORDER);
});

describe("computePoMatch — header level", () => {
  it("is not matched when the invoice carries no BT-13 at all", async () => {
    const result = await computePoMatch(env.DB, {});
    expect(result).toEqual({ matched: false, variancePct: undefined });
  });

  it("is not matched when BT-13 points at an order that has not arrived here", async () => {
    // Deliberately the same state as no reference at all — decision
    // 0370's own argument: a rule cannot usefully act differently on
    // "no order was named" versus "one was named but has not shown up
    // yet", since both mean the same thing today.
    const result = await computePoMatch(env.DB, { "BT-13": "PO-DOES-NOT-EXIST" });
    expect(result).toEqual({ matched: false, variancePct: undefined });
  });

  it("matches exactly when the invoice total agrees with the order total", async () => {
    const result = await computePoMatch(env.DB, { "BT-13": "PO-500", "BT-112": 1000 });
    expect(result).toEqual({ matched: true, variancePct: 0 });
  });

  it("is not matched when the variance exceeds the agreed tolerance", async () => {
    const result = await computePoMatch(env.DB, {
      "BT-13": "PO-500",
      "BT-112": 1100,
      "supplier.amountTolerancePct": 5,
    });
    expect(result.matched).toBe(false);
    expect(result.variancePct).toBeCloseTo(10);
  });

  it("matches when the variance is within the agreed tolerance", async () => {
    const result = await computePoMatch(env.DB, {
      "BT-13": "PO-500",
      "BT-112": 1030,
      "supplier.amountTolerancePct": 5,
    });
    expect(result.matched).toBe(true);
    expect(result.variancePct).toBeCloseTo(3);
  });

  it("requires an exact match when no tolerance was agreed", async () => {
    // No supplier.amountTolerancePct at all — absence of an agreed
    // tolerance means nothing has been agreed to deviate from an exact
    // match, the same reasoning po.matched's own vocabulary entry
    // gives for "before the match fails".
    const result = await computePoMatch(env.DB, { "BT-13": "PO-500", "BT-112": 1000.01 });
    expect(result.matched).toBe(false);
  });
});

describe("computePoLineMatch — line level", () => {
  const header = { "BT-13": "PO-500" };

  it("is not matched when the line carries no BT-132, even though the header matches", async () => {
    // No positional fallback, deliberately — EN 16931's own guidance
    // that order line and invoice line do not always correspond
    // one-to-one means guessing by position could report a match that
    // is not real.
    const result = await computePoLineMatch(env.DB, header, { "BT-129": 100, "BT-131": 600 });
    expect(result).toEqual({
      matched: false,
      variancePct: undefined,
      quantityVariancePct: undefined,
      referenceFound: false,
      priceMatched: undefined,
      quantityMatched: undefined,
      unitMismatch: false,
    });
  });

  it("is not matched when the header itself carries no BT-13", async () => {
    const result = await computePoLineMatch(env.DB, {}, { "BT-132": "1", "BT-129": 100, "BT-131": 600 });
    expect(result.matched).toBe(false);
  });

  it("is not matched when BT-132 references a line the order does not have", async () => {
    const result = await computePoLineMatch(env.DB, header, { "BT-132": "99", "BT-131": 600 });
    expect(result).toEqual({
      matched: false,
      variancePct: undefined,
      quantityVariancePct: undefined,
      referenceFound: false,
      priceMatched: undefined,
      quantityMatched: undefined,
      unitMismatch: false,
    });
  });

  it("matches a line whose amount and quantity agree exactly with its order line", async () => {
    const result = await computePoLineMatch(env.DB, header, {
      "BT-132": "1",
      "BT-129": 100,
      "BT-130": "EA",
      "BT-131": 600,
    });
    expect(result).toEqual({
      matched: true,
      variancePct: 0,
      quantityVariancePct: 0,
      referenceFound: true,
      priceMatched: true,
      quantityMatched: true,
      unitMismatch: false,
    });
  });

  it("correctly picks the second order line, not just the first", async () => {
    const result = await computePoLineMatch(env.DB, header, {
      "BT-132": "2",
      "BT-129": 50,
      "BT-130": "EA",
      "BT-131": 400,
    });
    expect(result.matched).toBe(true);
  });

  it("fails on quantity even when amount matches, when quantity exceeds its own tolerance", async () => {
    // Amount and quantity are independent checks — over-delivering is
    // not the same failure as over-charging, so both must pass.
    const result = await computePoLineMatch(
      env.DB,
      { ...header, "supplier.quantityTolerancePct": 5 },
      { "BT-132": "1", "BT-129": 120, "BT-130": "EA", "BT-131": 600 }
    );
    expect(result.matched).toBe(false);
    expect(result.variancePct).toBe(0);
    expect(result.quantityVariancePct).toBeCloseTo(20);
  });

  it("does not fail the line when quantity data is simply absent on either side", async () => {
    // A service line with no natural unit is not thereby a bad match
    // on price.
    const result = await computePoLineMatch(env.DB, header, { "BT-132": "1", "BT-131": 600 });
    expect(result.matched).toBe(true);
    expect(result.quantityVariancePct).toBeUndefined();
  });

  it("does not compare quantity across mismatched units", async () => {
    // The order says EA, the invoice says BOX — comparing the raw
    // numbers would be a meaningless variance, not a real one.
    const result = await computePoLineMatch(env.DB, header, {
      "BT-132": "1",
      "BT-129": 100,
      "BT-130": "BOX",
      "BT-131": 600,
    });
    expect(result.matched).toBe(true);
    expect(result.quantityVariancePct).toBeUndefined();
  });

  describe("the four split facts — decisions 0464/0466, generalizing po.line_matched without changing it", () => {
    it("po.line_unit_mismatch is true exactly when both sides carry a unit and disagree", async () => {
      const mismatched = await computePoLineMatch(env.DB, header, {
        "BT-132": "1",
        "BT-129": 100,
        "BT-130": "BOX",
        "BT-131": 600,
      });
      expect(mismatched.unitMismatch).toBe(true);
      // Still true regardless of matched — a unit disagreement is a
      // fact about the line, not a verdict on it.
      expect(mismatched.matched).toBe(true);

      const oneSideOnly = await computePoLineMatch(env.DB, header, { "BT-132": "1", "BT-131": 600 });
      expect(oneSideOnly.unitMismatch).toBe(false);

      const agree = await computePoLineMatch(env.DB, header, {
        "BT-132": "1",
        "BT-129": 100,
        "BT-130": "EA",
        "BT-131": 600,
      });
      expect(agree.unitMismatch).toBe(false);
    });

    it("po.line_reference_found is false without a real order line, true once one is located", async () => {
      const noRef = await computePoLineMatch(env.DB, header, { "BT-131": 600 });
      expect(noRef.referenceFound).toBe(false);
      expect(noRef.priceMatched).toBeUndefined();
      expect(noRef.quantityMatched).toBeUndefined();

      const notFound = await computePoLineMatch(env.DB, header, { "BT-132": "99", "BT-131": 600 });
      expect(notFound.referenceFound).toBe(false);

      const found = await computePoLineMatch(env.DB, header, { "BT-132": "1", "BT-131": 600 });
      expect(found.referenceFound).toBe(true);
    });

    it("po.line_price_matched and po.line_quantity_matched split what po.line_matched collapses", async () => {
      const priceOnly = await computePoLineMatch(
        env.DB,
        { ...header, "supplier.quantityTolerancePct": 5 },
        { "BT-132": "1", "BT-129": 120, "BT-130": "EA", "BT-131": 600 }
      );
      expect(priceOnly.matched).toBe(false);
      expect(priceOnly.priceMatched).toBe(true);
      expect(priceOnly.quantityMatched).toBe(false);
    });

    it("respects the org-wide default tolerance when no supplier-specific one is set", async () => {
      await env.DB.prepare("UPDATE org_matching_config SET amount_tolerance_pct = 5, quantity_tolerance_pct = 5 WHERE id = 1").run();
      // computePoLineMatch reads org config only when it's handed one —
      // mergePoMatchFacts is what fetches it in production; a direct
      // call, as every test in this file makes, has to fetch and pass
      // it explicitly the same way.
      const orgConfig = await getOrgMatchingConfig(env.DB);
      expect(orgConfig).toEqual({ amountTolerancePct: 5, quantityTolerancePct: 5, quantityMatchingEnabled: true });

      // 10% over on price, 20% over on quantity — within the new 5%?
      // No — this confirms the org default is actually being read, not
      // silently ignored.
      const overTolerance = await computePoLineMatch(
        env.DB,
        header,
        { "BT-132": "1", "BT-129": 120, "BT-130": "EA", "BT-131": 660 },
        orgConfig
      );
      expect(overTolerance.priceMatched).toBe(false);
      expect(overTolerance.quantityMatched).toBe(false);

      // Within the new 5% org default.
      const withinTolerance = await computePoLineMatch(
        env.DB,
        header,
        { "BT-132": "1", "BT-129": 103, "BT-130": "EA", "BT-131": 630 },
        orgConfig
      );
      expect(withinTolerance.priceMatched).toBe(true);
      expect(withinTolerance.quantityMatched).toBe(true);

      // A supplier-specific tolerance still supersedes the org default.
      const supplierOverride = await computePoLineMatch(
        env.DB,
        { ...header, "supplier.amountTolerancePct": 0 },
        { "BT-132": "1", "BT-131": 630 },
        orgConfig
      );
      expect(supplierOverride.priceMatched).toBe(false);
    });

    it("org-wide quantity_matching_enabled=0 turns quantity checking off entirely", async () => {
      await env.DB.prepare("UPDATE org_matching_config SET quantity_matching_enabled = 0 WHERE id = 1").run();
      const orgConfig = await getOrgMatchingConfig(env.DB);
      // A wild quantity variance that would otherwise fail is simply
      // not checked at all — quantityMatched reads true, the same
      // "nothing to disagree about" reading absence already gets.
      const result = await computePoLineMatch(
        env.DB,
        header,
        { "BT-132": "1", "BT-129": 99999, "BT-130": "EA", "BT-131": 600 },
        orgConfig
      );
      expect(result.quantityMatched).toBe(true);
      expect(result.quantityVariancePct).toBeUndefined();
      expect(result.matched).toBe(true);
    });
  });
});

describe("mergePoMatchFacts — the single entry point every caller uses", () => {
  it("merges header and every line's own facts together, in one call", async () => {
    const result = await mergePoMatchFacts(
      env.DB,
      { "BT-13": "PO-500", "BT-112": 1000 },
      [
        { lineNumber: 1, "BT-132": "1", "BT-129": 100, "BT-130": "EA", "BT-131": 600 },
        { lineNumber: 2, "BT-132": "9", "BT-131": 999 }, // no such order line
      ]
    );
    expect(result.headerFacts["po.matched"]).toBe(true);
    expect(result.headerFacts["po.variance_pct"]).toBe(0);
    expect(result.lines[0]["po.line_matched"]).toBe(true);
    expect(result.lines[1]["po.line_matched"]).toBe(false);
    // Original line facts survive the merge, not just the new ones.
    expect(result.lines[0]["BT-129"]).toBe(100);
  });

  it("computes line facts against the header facts as merged, not the raw input", async () => {
    // supplier.amountTolerancePct only exists after the header merge
    // if it was already on the raw facts — this proves line matching
    // reads the same header object the header computation just wrote
    // po.matched onto, not a stale copy.
    const result = await mergePoMatchFacts(env.DB, { "BT-13": "PO-500", "supplier.amountTolerancePct": 10 }, [
      { lineNumber: 1, "BT-132": "1", "BT-131": 660 },
    ]);
    expect(result.lines[0]["po.line_matched"]).toBe(true);
    expect(result.lines[0]["po.line_variance_pct"]).toBeCloseTo(10);
  });

  it("merges the four split facts onto every line, alongside the unchanged po.line_matched", async () => {
    const result = await mergePoMatchFacts(
      env.DB,
      { "BT-13": "PO-500", "BT-112": 1000 },
      [
        { lineNumber: 1, "BT-132": "1", "BT-129": 100, "BT-130": "BOX", "BT-131": 600 },
        { lineNumber: 2, "BT-132": "9", "BT-131": 999 }, // no such order line
      ]
    );
    expect(result.lines[0]["po.line_reference_found"]).toBe(true);
    expect(result.lines[0]["po.line_price_matched"]).toBe(true);
    // Unit mismatch (BOX vs. the order's EA) leaves quantity untested,
    // the same "nothing comparable" reading po.line_matched itself
    // already gives — and surfaces as its own fact rather than hiding.
    expect(result.lines[0]["po.line_quantity_matched"]).toBe(true);
    expect(result.lines[0]["po.line_unit_mismatch"]).toBe(true);
    expect(result.lines[0]["po.line_matched"]).toBe(true);

    expect(result.lines[1]["po.line_reference_found"]).toBe(false);
    expect(result.lines[1]["po.line_price_matched"]).toBeUndefined();
    expect(result.lines[1]["po.line_quantity_matched"]).toBeUndefined();
    expect(result.lines[1]["po.line_unit_mismatch"]).toBe(false);
    expect(result.lines[1]["po.line_matched"]).toBe(false);
  });

  it("reads the org-wide default tolerance itself, not just when called directly", async () => {
    // The production path — mergePoMatchFacts is what every real
    // caller uses, so the org default has to actually reach it, not
    // just the direct computePoLineMatch calls this file's other tests
    // pass it to explicitly.
    await env.DB.prepare("UPDATE org_matching_config SET amount_tolerance_pct = 5 WHERE id = 1").run();
    const result = await mergePoMatchFacts(env.DB, { "BT-13": "PO-500" }, [
      { lineNumber: 1, "BT-132": "1", "BT-131": 630 }, // 5% over, no supplier tolerance set
    ]);
    expect(result.lines[0]["po.line_price_matched"]).toBe(true);
    expect(result.lines[0]["po.line_matched"]).toBe(true);
  });
});
