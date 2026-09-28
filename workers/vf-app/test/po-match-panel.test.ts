import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { applyTestSchema } from "./setup.js";
import { handleGetPoMatchView, handlePoCandidates, handleLinkPo, handlePairLine } from "../src/po-match-panel-route.js";
import { handleGetInvoice, loadLiveInvoiceFacts } from "../src/invoice-facts-route.js";

/**
 * The Matching stage's PO matching panel, phase 1 — decision 0530.
 *
 * One invoice (inv-1, 1,735.00, naming PO-A) at a Matching stage, with
 * a Matching task claimed by Dan. PO-A has four lines and one earlier
 * invoice (inv-0, 420.00) against it; PO-B is the same supplier's, and
 * PO-C another supplier's; PO-D is closed.
 */

type View = {
  po: { orderNumber: string; status: string; buyerName: string | null } | null;
  referenceNotFound: boolean;
  header: { matched: boolean };
  usage: { poTotal: number; invoicedByOthers: number; otherInvoices: { number: string }[]; thisInvoice: number; left: number } | null;
  lines: {
    lineNumber: number;
    orderLineReference: string | null;
    poLine: { lineNumber: number; name: string } | null;
    result: { matched: boolean; referenceFound: boolean; priceMatched: boolean | null };
  }[];
  unusedPoLines: { lineNumber: number }[];
  canRelink: boolean;
  tolerance: { amountPct: number; source: string };
};

async function po(id: string, number: string, seller: string, amount: number, status = "active") {
  await env.DB.prepare(
    "INSERT INTO purchase_orders (id, order_number, issue_date, currency, seller_party_id, payable_amount, status) VALUES (?, ?, '2026-09-01', 'GBP', ?, ?, ?)"
  )
    .bind(id, number, seller, amount, status)
    .run();
}
async function poLine(poId: string, n: number, name: string, qty: number, price: number) {
  await env.DB.prepare(
    "INSERT INTO purchase_order_lines (id, purchase_order_id, line_number, quantity, unit_code, line_extension_amount, item_name, price_amount) VALUES (?, ?, ?, ?, 'EA', ?, ?, ?)"
  )
    .bind(crypto.randomUUID(), poId, n, qty, qty * price, name, price)
    .run();
}
async function invoice(id: string, facts: Record<string, unknown>, lines: Record<string, unknown>[] = []) {
  await env.DB.prepare("INSERT INTO invoice_headers (id, facts_json) VALUES (?, ?)").bind(id, JSON.stringify(facts)).run();
  for (const [i, l] of lines.entries()) {
    await env.DB.prepare("INSERT INTO invoice_lines (id, invoice_id, line_number, amount, facts_json) VALUES (?, ?, ?, ?, ?)")
      .bind(crypto.randomUUID(), id, i + 1, l["BT-131"] as number, JSON.stringify(l))
      .run();
  }
}
async function grant(userId: string, permissions: string[]) {
  await env.DB.prepare("INSERT INTO org_roles (id, name, permissions_json) VALUES (?, ?, ?)")
    .bind(`r-${userId}`, userId, JSON.stringify(permissions))
    .run();
  await env.DB.prepare("INSERT INTO org_user_roles (user_id, role_id) VALUES (?, ?)").bind(userId, `r-${userId}`).run();
}

async function seed() {
  await env.DB.prepare("INSERT INTO org_users (id, email, name) VALUES ('u-dan', 'd@x.com', 'Dan'), ('u-sam', 's@x.com', 'Sam'), ('u-buyer', 'b@x.com', 'Sarah Kent')").run();
  await grant("u-dan", ["AP.Match"]);
  await grant("u-sam", ["AP.Match"]);

  await po("po-a", "PO-A", "GB111", 2484);
  await env.DB.prepare("UPDATE purchase_orders SET buyer_user_id = 'u-buyer' WHERE id = 'po-a'").run();
  await poLine("po-a", 1, "Toner cartridge, black", 10, 42);
  await poLine("po-a", 2, "A4 copier paper", 60, 23.5);
  await poLine("po-a", 3, "Stapler", 6, 15);
  await poLine("po-a", 4, "Desk organiser", 8, 18);
  await po("po-b", "PO-B", "GB111", 5000);
  await po("po-c", "PO-C", "GB999", 5000);
  await po("po-d", "PO-D", "GB111", 5000, "closed");

  await invoice("inv-0", { "BT-1": "INV-0", "BT-13": "PO-A", "BT-112": 420 });
  await invoice(
    "inv-1",
    { "BT-1": "INV-1", "BT-13": "PO-A", "BT-112": 1735, "BT-31": "GB111", "BT-5": "GBP" },
    [
      { "BT-153": "Toner", "BT-129": 10, "BT-130": "EA", "BT-146": 42, "BT-131": 420, "BT-132": "1" },
      { "BT-153": "Paper", "BT-129": 50, "BT-130": "EA", "BT-146": 24.5, "BT-131": 1225, "BT-132": "2" },
      { "BT-153": "Organiser", "BT-129": 5, "BT-130": "EA", "BT-146": 18, "BT-131": 90 },
    ]
  );

  // A Matching stage, BT-13 editable (the default), and Dan's claimed task.
  await env.DB.prepare("INSERT INTO processes (id, name) VALUES ('ap', 'AP')").run();
  await env.DB.prepare("INSERT INTO process_stages (id, process_id, name, sequence) VALUES ('matching', 'ap', 'Matching', 1)").run();
  await env.DB.prepare(
    `INSERT INTO process_stage_versions (process_id, version, stage_id, sequence)
     SELECT p.id, p.version, s.id, s.sequence FROM process_stages s JOIN processes p ON p.id = s.process_id`
  ).run();
  await env.DB.prepare(
    "INSERT INTO process_instances (id, process_id, subject_type, subject_id, current_stage_id) VALUES ('pi-1', 'ap', 'invoice', 'inv-1', 'matching')"
  ).run();
  await env.DB.prepare(
    "INSERT INTO stage_visits (id, process_instance_id, stage_id, outcome, created_at) VALUES ('v-1', 'pi-1', 'matching', 'matched', datetime('now'))"
  ).run();
  await env.DB.prepare(
    "INSERT INTO tasks (id, stage_id, owner_user_id, required_permission, status, stage_visit_id) VALUES ('t-1', 'matching', 'u-dan', 'AP.Match', 'open', 'v-1')"
  ).run();
}

beforeEach(async () => {
  await applyTestSchema();
  await seed();
});

describe("the panel's view — decision 0530", () => {
  it("shows the PO the invoice names, how much of it is used, and each line against its PO line", async () => {
    const result = await handleGetPoMatchView(env.DB, "inv-1", "u-dan");
    expect(result.status).toBe(200);
    const view = result.body as unknown as View;

    expect(view.po?.orderNumber).toBe("PO-A");
    expect(view.po?.buyerName).toBe("Sarah Kent");
    // Already invoiced by inv-0 only, never this invoice twice.
    expect(view.usage).toMatchObject({ poTotal: 2484, invoicedByOthers: 420, thisInvoice: 1735, left: 329 });
    expect(view.usage?.otherInvoices.map((o) => o.number)).toEqual(["INV-0"]);

    const [toner, paper, organiser] = view.lines;
    expect(toner.poLine?.lineNumber).toBe(1);
    expect(toner.result.matched).toBe(true);
    // 1,225 against 1,410: found, but the price disagrees.
    expect(paper.poLine?.lineNumber).toBe(2);
    expect(paper.result).toMatchObject({ referenceFound: true, priceMatched: false, matched: false });
    // No BT-132: never a guess.
    expect(organiser.poLine).toBeNull();
    expect(organiser.result.referenceFound).toBe(false);

    expect(view.unusedPoLines.map((l) => l.lineNumber)).toEqual([3, 4]);
    expect(view.canRelink).toBe(true);
    expect(view.tolerance).toMatchObject({ amountPct: 0, source: "org" });
  });

  it("tells a PO number we do not hold apart from no PO number at all", async () => {
    await env.DB.prepare(`UPDATE invoice_headers SET facts_json = json_set(facts_json, '$."BT-13"', 'PO-NOPE') WHERE id = 'inv-1'`).run();
    const named = (await handleGetPoMatchView(env.DB, "inv-1", "u-dan")).body as unknown as View;
    expect(named.po).toBeNull();
    expect(named.referenceNotFound).toBe(true);

    await env.DB.prepare(`UPDATE invoice_headers SET facts_json = json_remove(facts_json, '$."BT-13"') WHERE id = 'inv-1'`).run();
    const none = (await handleGetPoMatchView(env.DB, "inv-1", "u-dan")).body as unknown as View;
    expect(none.po).toBeNull();
    expect(none.referenceNotFound).toBe(false);
  });

  it("offers re-linking only to the person whose task it is", async () => {
    const view = (await handleGetPoMatchView(env.DB, "inv-1", "u-sam")).body as unknown as View;
    expect(view.canRelink).toBe(false);
  });

  it("404s an invoice that does not exist", async () => {
    expect((await handleGetPoMatchView(env.DB, "nope", "u-dan")).status).toBe(404);
  });
});

describe("searching for a PO — decision 0530", () => {
  const search = (params: Partial<{ search: string; supplierOnly: boolean; activeOnly: boolean; coversInvoice: boolean }>) =>
    handlePoCandidates(env.DB, "inv-1", "u-dan", {
      search: params.search ?? null,
      supplierOnly: params.supplierOnly ?? false,
      activeOnly: params.activeOnly ?? false,
      coversInvoice: params.coversInvoice ?? false,
    });
  const numbers = async (params: Parameters<typeof search>[0]) =>
    ((await search(params)).body as { candidates: { orderNumber: string }[] }).candidates.map((c) => c.orderNumber).sort();

  it("narrows to this supplier, to active POs, and to POs with enough left", async () => {
    expect(await numbers({})).toEqual(["PO-A", "PO-B", "PO-C", "PO-D"]);
    expect(await numbers({ supplierOnly: true })).toEqual(["PO-A", "PO-B", "PO-D"]);
    expect(await numbers({ supplierOnly: true, activeOnly: true })).toEqual(["PO-A", "PO-B"]);
    // PO-A has 2,064 left after inv-0, enough for 1,735; so does PO-B.
    expect(await numbers({ coversInvoice: true, activeOnly: true, supplierOnly: true })).toEqual(["PO-A", "PO-B"]);
    await env.DB.prepare("UPDATE purchase_orders SET payable_amount = 1000 WHERE id = 'po-b'").run();
    expect(await numbers({ coversInvoice: true, activeOnly: true, supplierOnly: true })).toEqual(["PO-A"]);
  });

  it("searches order numbers and PO line items, and says why each fits", async () => {
    expect(await numbers({ search: "Stapler" })).toEqual(["PO-A"]);
    const body = (await search({ search: "PO-B" })).body as {
      candidates: { orderNumber: string; current: boolean; left: number; reasons: Record<string, boolean> }[];
    };
    expect(body.candidates[0]).toMatchObject({
      orderNumber: "PO-B",
      current: false,
      left: 5000,
      reasons: { sameSupplier: true, coversInvoice: true, sameCurrency: true },
    });
  });
});

describe("re-linking to a different PO — decision 0530", () => {
  it("sets the invoice's BT-13, and records it in the Timeline", async () => {
    const result = await handleLinkPo(env.DB, "inv-1", "u-dan", { orderNumber: "PO-B" });
    expect(result.status).toBe(200);
    const facts = await env.DB.prepare("SELECT facts_json FROM invoice_headers WHERE id = 'inv-1'").first<{ facts_json: string }>();
    expect(JSON.parse(facts!.facts_json)["BT-13"]).toBe("PO-B");
    const event = await env.DB.prepare("SELECT action, actor_id, comment FROM task_action_events WHERE task_id = 't-1'").first();
    expect(event).toMatchObject({ action: "po_link", actor_id: "u-dan", comment: "PO-B" });
  });

  it("refuses a closed PO, a PO we do not hold, and nothing at all", async () => {
    expect((await handleLinkPo(env.DB, "inv-1", "u-dan", { orderNumber: "PO-D" })).body).toMatchObject({ reason: "po_closed" });
    expect((await handleLinkPo(env.DB, "inv-1", "u-dan", { orderNumber: "PO-NOPE" })).status).toBe(404);
    expect((await handleLinkPo(env.DB, "inv-1", "u-dan", {})).status).toBe(400);
  });

  it("refuses somebody whose task it is not, and changes nothing", async () => {
    const result = await handleLinkPo(env.DB, "inv-1", "u-sam", { orderNumber: "PO-B" });
    expect(result.status).toBe(403);
    const facts = await env.DB.prepare("SELECT facts_json FROM invoice_headers WHERE id = 'inv-1'").first<{ facts_json: string }>();
    expect(JSON.parse(facts!.facts_json)["BT-13"]).toBe("PO-A");
  });

  it("refuses where Stage Restrictions make BT-13 read-only, through keying's own check", async () => {
    await env.DB.prepare("INSERT INTO stage_field_visibility (stage_id, field, visibility) VALUES ('matching', 'BT-13', 'read')").run();
    const result = await handleLinkPo(env.DB, "inv-1", "u-dan", { orderNumber: "PO-B" });
    expect(result.status).toBe(403);
    expect((result.body as { reason: string }).reason).toBe("not_editable_here");
    const events = await env.DB.prepare("SELECT count(*) AS n FROM task_action_events").first<{ n: number }>();
    expect(events?.n).toBe(0);
  });
});

describe("pairing a line by hand — decision 0532", () => {
  type PairView = View & {
    lines: (View["lines"][number] & { pairing: { poLineNumber: number; pairedByName: string } | null })[];
    poLineOptions: { lineNumber: number }[];
  };
  const view = async () => (await handleGetPoMatchView(env.DB, "inv-1", "u-dan")).body as unknown as PairView;

  it("pairs a line with no reference, and the panel and the rules' own facts both see it", async () => {
    expect((await view()).poLineOptions.map((o) => o.lineNumber)).toEqual([1, 2, 3, 4]);

    const result = await handlePairLine(env.DB, "inv-1", "u-dan", { lineNumber: 3, poLineNumber: 4 });
    expect(result.status).toBe(200);

    const organiser = (await view()).lines[2];
    expect(organiser.pairing).toMatchObject({ poLineNumber: 4, pairedByName: "Dan" });
    expect(organiser.poLine?.lineNumber).toBe(4);
    // 90 against 144 (8 × 18): found now, and compared.
    expect(organiser.result.referenceFound).toBe(true);
    // The supplier's own reference is still what the supplier sent.
    expect(organiser.orderLineReference).toBeNull();

    // What every re-evaluation after a task completes reads.
    const live = await loadLiveInvoiceFacts(env.DB, "inv-1");
    const line3 = live!.lines.find((l) => l.lineNumber === 3)!;
    expect(line3["BT-132"]).toBe("4");
    expect(line3["po.line_reference_found"]).toBe(true);

    // Stored facts are untouched.
    const stored = await env.DB.prepare("SELECT facts_json FROM invoice_lines WHERE invoice_id = 'inv-1' AND line_number = 3").first<{ facts_json: string }>();
    expect(JSON.parse(stored!.facts_json)["BT-132"]).toBeUndefined();

    const event = await env.DB.prepare("SELECT action, comment FROM task_action_events WHERE action = 'po_pair'").first();
    expect(event).toMatchObject({ action: "po_pair", comment: "3:4" });
  });

  it("overrides the supplier's own reference, and clearing puts it back", async () => {
    await handlePairLine(env.DB, "inv-1", "u-dan", { lineNumber: 2, poLineNumber: 3 });
    expect((await view()).lines[1].poLine?.lineNumber).toBe(3);

    await handlePairLine(env.DB, "inv-1", "u-dan", { lineNumber: 2, poLineNumber: null });
    const paper = (await view()).lines[1];
    expect(paper.pairing).toBeNull();
    expect(paper.poLine?.lineNumber).toBe(2);
    const cleared = await env.DB.prepare("SELECT comment FROM task_action_events WHERE action = 'po_pair' ORDER BY at DESC, rowid DESC").first<{ comment: string }>();
    expect(cleared?.comment).toBe("2:");
  });

  it("applies only while the invoice still names the PO it was made against", async () => {
    await handlePairLine(env.DB, "inv-1", "u-dan", { lineNumber: 3, poLineNumber: 4 });
    await handleLinkPo(env.DB, "inv-1", "u-dan", { orderNumber: "PO-B" });
    const live = await loadLiveInvoiceFacts(env.DB, "inv-1");
    expect(live!.lines.find((l) => l.lineNumber === 3)!["BT-132"]).toBeUndefined();

    await handleLinkPo(env.DB, "inv-1", "u-dan", { orderNumber: "PO-A" });
    const back = await loadLiveInvoiceFacts(env.DB, "inv-1");
    expect(back!.lines.find((l) => l.lineNumber === 3)!["BT-132"]).toBe("4");
  });

  it("refuses somebody whose task it is not, a PO line that does not exist, and an invoice line that does not", async () => {
    expect((await handlePairLine(env.DB, "inv-1", "u-sam", { lineNumber: 3, poLineNumber: 4 })).status).toBe(403);
    expect((await handlePairLine(env.DB, "inv-1", "u-dan", { lineNumber: 3, poLineNumber: 9 })).body).toMatchObject({ reason: "po_line_not_found" });
    expect((await handlePairLine(env.DB, "inv-1", "u-dan", { lineNumber: 7, poLineNumber: 1 })).body).toMatchObject({ reason: "line_not_found" });
    expect((await handlePairLine(env.DB, "inv-1", "u-dan", { lineNumber: 3 })).status).toBe(400);
    const saved = await env.DB.prepare("SELECT count(*) AS n FROM invoice_line_po_pairings").first<{ n: number }>();
    expect(saved?.n).toBe(0);
  });

  it("refuses when the invoice names no PO held here", async () => {
    await env.DB.prepare(`UPDATE invoice_headers SET facts_json = json_set(facts_json, '$."BT-13"', 'PO-NOPE') WHERE id = 'inv-1'`).run();
    expect((await handlePairLine(env.DB, "inv-1", "u-dan", { lineNumber: 3, poLineNumber: 4 })).body).toMatchObject({ reason: "no_po" });
  });
});


describe("how much of each PO line is used — decision 0533", () => {
  type UseView = View & {
    lines: (View["lines"][number] & { poLine: { use: Record<string, number | null> } | null })[];
    unusedPoLines: { lineNumber: number; use: Record<string, number | null> }[];
  };
  const view = async () => (await handleGetPoMatchView(env.DB, "inv-1", "u-dan")).body as unknown as UseView;

  it("shows ordered, taken by other invoices, taken by this one, and left, per PO line", async () => {
    // inv-0 takes 4 of paper (PO line 2) as well as its header total.
    await env.DB.prepare("INSERT INTO invoice_lines (id, invoice_id, line_number, amount, facts_json) VALUES ('l0', 'inv-0', 1, 94, ?)")
      .bind(JSON.stringify({ "BT-132": "2", "BT-129": 4, "BT-131": 94 }))
      .run();
    const v = await view();
    expect(v.lines[1].poLine?.use).toEqual({
      orderedQuantity: 60,
      orderedAmount: 1410,
      beforeQuantity: 4,
      beforeAmount: 94,
      thisQuantity: 50,
      thisAmount: 1225,
      leftQuantity: 6,
      leftAmount: 91,
    });
    expect(v.unusedPoLines.find((l) => l.lineNumber === 3)?.use).toMatchObject({ beforeQuantity: 0, leftQuantity: 6 });
  });

  it("no longer counts a discarded or returned invoice as having used the PO", async () => {
    await env.DB.prepare(
      "INSERT INTO process_instances (id, process_id, subject_type, subject_id, current_stage_id, status) VALUES ('pi-0', 'ap', 'invoice', 'inv-0', 'matching', 'archived')"
    ).run();
    const v = await view();
    expect(v.usage).toMatchObject({ invoicedByOthers: 0, left: 2484 - 1735 });
    expect(v.usage?.otherInvoices).toEqual([]);
  });
});

describe("suggesting a PO line — decision 0534", () => {
  type SugView = View & { lines: (View["lines"][number] & { suggestion: { poLineNumber: number; score: number; reasons: string[] } | null })[] };
  const view = async () => (await handleGetPoMatchView(env.DB, "inv-1", "u-dan")).body as unknown as SugView;

  it("suggests a PO line for a line with no reference, and none for a line already matched or paired", async () => {
    const v = await view();
    expect(v.lines[2].suggestion).toMatchObject({ poLineNumber: 4, reasons: ["description", "price", "fits"] });
    expect(v.lines[0].suggestion).toBeNull();
    expect(v.lines[1].suggestion).toBeNull();

    await handlePairLine(env.DB, "inv-1", "u-dan", { lineNumber: 3, poLineNumber: 4 });
    expect((await view()).lines[2].suggestion).toBeNull();
  });

  it("counts, per PO in the search, how many of this invoice's lines look like one of its lines", async () => {
    await env.DB.prepare(
      "INSERT INTO purchase_order_lines (id, purchase_order_id, line_number, quantity, unit_code, line_extension_amount, item_name, price_amount) VALUES ('b1', 'po-b', 1, 5, 'EA', 90, 'Mesh organiser', 18)"
    ).run();
    const body = (await handlePoCandidates(env.DB, "inv-1", "u-dan", { search: null, supplierOnly: true, activeOnly: true, coversInvoice: false }))
      .body as { candidates: { orderNumber: string; reasons: { linesAlike: number; lineCount: number } }[] };
    const byNumber = Object.fromEntries(body.candidates.map((c) => [c.orderNumber, c.reasons]));
    expect(byNumber["PO-A"]).toMatchObject({ lineCount: 3 });
    expect(byNumber["PO-A"].linesAlike).toBeGreaterThanOrEqual(2);
    expect(byNumber["PO-B"]).toMatchObject({ linesAlike: 1, lineCount: 3 });
  });
});


describe("the invoice line Match column — decision 0536", () => {
  type Summary = {
    orderNumber: string;
    held: boolean;
    lines: {
      lineNumber: number;
      state: string;
      poLine: { lineNumber: number; name: string } | null;
      use: { thisQuantity: number; leftQuantity: number | null } | null;
      pairing: { source: string; pairedByName: string } | null;
    }[];
  };
  const summary = async () => ((await handleGetInvoice(env.DB, "inv-1")).body as { poMatch: Summary | null }).poMatch;

  it("rides on the invoice itself: each line's state against its PO line, the same verdict as the panel", async () => {
    const s = await summary();
    expect(s).toMatchObject({ orderNumber: "PO-A", held: true });
    const panel = (await handleGetPoMatchView(env.DB, "inv-1", "u-dan")).body as unknown as View;
    expect(s!.lines.map((l) => [l.lineNumber, l.state, l.poLine?.lineNumber ?? null])).toEqual([
      [1, panel.lines[0].result.matched ? "matched" : "over", 1],
      [2, panel.lines[1].result.matched ? "matched" : "over", 2],
      [3, "nopoline", null],
    ]);
    expect(s!.lines[0].state).toBe("matched");
    expect(s!.lines[0].use).toMatchObject({ thisQuantity: 10, leftQuantity: 0 });
  });

  it("says how a line was paired: by hand, or a suggestion accepted", async () => {
    await handlePairLine(env.DB, "inv-1", "u-dan", { lineNumber: 3, poLineNumber: 4, source: "suggestion" });
    let line3 = (await summary())!.lines[2];
    expect(line3.poLine?.lineNumber).toBe(4);
    expect(line3.state).not.toBe("nopoline");
    expect(line3.pairing).toMatchObject({ source: "suggestion", pairedByName: "Dan" });

    // Re-pairing by hand replaces the record of how it was made.
    await handlePairLine(env.DB, "inv-1", "u-dan", { lineNumber: 3, poLineNumber: 4 });
    line3 = (await summary())!.lines[2];
    expect(line3.pairing?.source).toBe("manual");

    // Anything else sent as the source is read as by hand.
    await handlePairLine(env.DB, "inv-1", "u-dan", { lineNumber: 3, poLineNumber: 4, source: "robot" });
    expect((await summary())!.lines[2].pairing?.source).toBe("manual");
  });

  it("is null for an invoice that names no PO, and marks every line when the PO is not held here", async () => {
    await env.DB.prepare(`UPDATE invoice_headers SET facts_json = json_remove(facts_json, '$."BT-13"') WHERE id = 'inv-1'`).run();
    expect(await summary()).toBeNull();
    await env.DB.prepare(`UPDATE invoice_headers SET facts_json = json_set(facts_json, '$."BT-13"', 'PO-NOPE') WHERE id = 'inv-1'`).run();
    const s = await summary();
    expect(s).toMatchObject({ orderNumber: "PO-NOPE", held: false });
    expect(s!.lines.map((l) => l.state)).toEqual(["nopoline", "nopoline", "nopoline"]);
  });
});
