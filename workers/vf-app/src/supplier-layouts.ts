/**
 * **Learning each supplier's invoice layout — decision 0702.**
 *
 * Step 2 of `docs/design/supplier-layout-learning.md`. From where each
 * header value was on a supplier's invoices (decision 0701's regions), work
 * out where that supplier usually puts each field: its **layout**. A
 * supplier may have several (a new template, another site's system).
 *
 * **Worked out when asked, from the regions themselves, not stored.** The
 * design proposed a table of layouts updated as regions arrive. Computing
 * from the regions each time gives the same answer and cannot drift from
 * them: a region whose value is changed stops counting at once, and
 * forgetting a supplier's layouts is one row (`supplier_layout_resets`)
 * rather than a cleanup. A supplier has at most a few hundred regions, so
 * it is cheap.
 */
import { sameValue } from "./field-regions.js";

export type RegionSource = "found" | "lassoed" | "lassoed_corrected";

export interface Evidence {
  invoiceId: string;
  field: string;
  pageNumber: number;
  box: { x: number; y: number; w: number; h: number };
  label: string | null;
  source: RegionSource;
  recordedAt: string;
}

export interface LayoutField {
  field: string;
  pageNumber: number;
  box: { x: number; y: number; w: number; h: number };
  label: string | null;
  /** Weighted invoices that agree (found 1, boxed in 3, a correction 5). */
  evidence: number;
  disagreements: number;
}

export interface Layout {
  id: string;
  invoices: number;
  fields: LayoutField[];
}

/** How much one region says (design §3, step 1): a person pointing outweighs the viewer searching. */
export const WEIGHT: Record<RegionSource, number> = { found: 1, lassoed: 3, lassoed_corrected: 5 };
/** Two places are the same when their centres are this close, as a fraction of the page. */
export const SAME_PLACE = 0.03;
/** A field joins a layout with this much agreeing evidence: three found invoices, or one correction. */
export const LEARNED_AT = 3;

const centre = (b: Evidence["box"]) => ({ x: b.x + b.w / 2, y: b.y + b.h / 2 });

function samePlace(a: Evidence, b: { pageNumber: number; box: Evidence["box"]; label: string | null }): boolean {
  if (a.pageNumber !== b.pageNumber) return false;
  const ca = centre(a.box);
  const cb = centre(b.box);
  if (Math.hypot(ca.x - cb.x, ca.y - cb.y) > SAME_PLACE) return false;
  // Where both have a label, it must be the same one.
  return !a.label || !b.label || a.label === b.label;
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function mostCommon(values: (string | null)[]): string | null {
  const counts = new Map<string, number>();
  for (const v of values) if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: string | null = null;
  let n = 0;
  for (const [v, c] of counts) if (c > n) [best, n] = [v, c];
  return best;
}

/** The largest group of regions that agree on where a field is, and what it says. */
function settle(field: string, regions: Evidence[]): LayoutField | null {
  if (!regions.length) return null;
  const total = regions.reduce((n, r) => n + WEIGHT[r.source], 0);
  let best: Evidence[] = [];
  let bestWeight = 0;
  for (const seed of regions) {
    const group = regions.filter((r) => samePlace(r, seed));
    const weight = group.reduce((n, r) => n + WEIGHT[r.source], 0);
    if (weight > bestWeight) [best, bestWeight] = [group, weight];
  }
  return {
    field,
    pageNumber: best[0].pageNumber,
    box: {
      x: median(best.map((r) => r.box.x)),
      y: median(best.map((r) => r.box.y)),
      w: median(best.map((r) => r.box.w)),
      h: median(best.map((r) => r.box.h)),
    },
    label: mostCommon(best.map((r) => r.label)),
    evidence: bestWeight,
    disagreements: total - bestWeight,
  };
}

/**
 * A supplier's layouts from its regions. Invoices are taken in the order
 * their regions were recorded; each joins the layout it agrees with most
 * (at least as many of the fields they share in the same place as not), or
 * starts a new one. A field is in a layout once it has `LEARNED_AT` agreeing
 * evidence and more agreement than disagreement. Layouts with no learned
 * field are left out; the most used comes first.
 */
export function learnLayouts(evidence: readonly Evidence[]): Layout[] {
  const byInvoice = new Map<string, Evidence[]>();
  for (const e of evidence) {
    if (!byInvoice.has(e.invoiceId)) byInvoice.set(e.invoiceId, []);
    byInvoice.get(e.invoiceId)!.push(e);
  }
  const invoices = [...byInvoice.values()].sort((a, b) =>
    (a.map((e) => e.recordedAt).sort()[0] ?? "").localeCompare(b.map((e) => e.recordedAt).sort()[0] ?? "")
  );

  const groups: { invoices: number; regions: Map<string, Evidence[]> }[] = [];
  for (const regions of invoices) {
    let chosen: (typeof groups)[number] | null = null;
    let chosenAgree = 0;
    for (const group of groups) {
      let agree = 0;
      let disagree = 0;
      for (const r of regions) {
        const known = group.regions.get(r.field);
        if (!known?.length) continue;
        const where = settle(r.field, known)!;
        if (samePlace(r, where)) agree++;
        else disagree++;
      }
      // At least as many fields in the same place as not: one moved field is a misreading, not a new template.
      if (agree >= disagree && agree > chosenAgree) [chosen, chosenAgree] = [group, agree];
    }
    if (!chosen) {
      chosen = { invoices: 0, regions: new Map() };
      groups.push(chosen);
    }
    chosen.invoices++;
    for (const r of regions) {
      if (!chosen.regions.has(r.field)) chosen.regions.set(r.field, []);
      chosen.regions.get(r.field)!.push(r);
    }
  }

  return groups
    .map((group) => ({
      invoices: group.invoices,
      fields: [...group.regions.entries()]
        .map(([field, regions]) => settle(field, regions))
        .filter((f): f is LayoutField => f !== null && f.evidence >= LEARNED_AT && f.evidence > f.disagreements)
        .sort((a, b) => a.field.localeCompare(b.field, "en", { numeric: true })),
    }))
    .filter((layout) => layout.fields.length > 0)
    .sort((a, b) => b.invoices - a.invoices)
    .map((layout, i) => ({ id: `L${i + 1}`, ...layout }));
}

/** The most recent invoices a layout is learned from. Old ones stop mattering as a supplier changes template. */
export const RECENT_INVOICES = 200;

/** The evidence for a supplier: current regions of its recent invoices, since its layouts were last forgotten. */
export async function supplierEvidence(db: D1Database, supplierId: string): Promise<Evidence[]> {
  const rows = await db
    .prepare(
      `SELECT r.invoice_id, r.field, r.page_number, r.x, r.y, r.w, r.h, r.label_text, r.value, r.source, r.recorded_at, h.facts_json
       FROM invoice_field_regions r
       JOIN invoice_headers h ON h.id = r.invoice_id
       WHERE h.supplier_id = ?1
         AND r.recorded_at > COALESCE((SELECT reset_at FROM supplier_layout_resets WHERE supplier_id = ?1), '')
         AND r.invoice_id IN (SELECT id FROM invoice_headers WHERE supplier_id = ?1 ORDER BY created_at DESC LIMIT ${RECENT_INVOICES})`
    )
    .bind(supplierId)
    .all<{
      invoice_id: string; field: string; page_number: number; x: number; y: number; w: number; h: number;
      label_text: string | null; value: string; source: RegionSource; recorded_at: string; facts_json: string;
    }>();
  const facts = new Map<string, Record<string, unknown>>();
  return rows.results
    .filter((r) => {
      if (!facts.has(r.invoice_id)) {
        try {
          facts.set(r.invoice_id, JSON.parse(r.facts_json ?? "{}"));
        } catch {
          facts.set(r.invoice_id, {});
        }
      }
      // Decision 0701: a region counts only while its value is still the invoice's.
      return sameValue(facts.get(r.invoice_id)![r.field], r.value);
    })
    .map((r) => ({
      invoiceId: r.invoice_id,
      field: r.field,
      pageNumber: r.page_number,
      box: { x: r.x, y: r.y, w: r.w, h: r.h },
      label: r.label_text,
      source: r.source,
      recordedAt: r.recorded_at,
    }));
}

/** A supplier's learned layouts, and how many invoices they were learned from. */
export async function supplierLayouts(db: D1Database, supplierId: string): Promise<{ layouts: Layout[]; invoices: number; forgottenAt: string | null }> {
  const evidence = await supplierEvidence(db, supplierId);
  const reset = await db.prepare("SELECT reset_at FROM supplier_layout_resets WHERE supplier_id = ?").bind(supplierId).first<{ reset_at: string }>();
  return { layouts: learnLayouts(evidence), invoices: new Set(evidence.map((e) => e.invoiceId)).size, forgottenAt: reset?.reset_at ?? null };
}

/** The layouts of the supplier an invoice is from: what the viewer uses for "usually here". */
export async function invoiceLayouts(db: D1Database, invoiceId: string): Promise<{ supplierId: string | null; layouts: Layout[] } | null> {
  const row = await db.prepare("SELECT supplier_id FROM invoice_headers WHERE id = ?").bind(invoiceId).first<{ supplier_id: string | null }>();
  if (!row) return null;
  if (!row.supplier_id) return { supplierId: null, layouts: [] };
  return { supplierId: row.supplier_id, layouts: (await supplierLayouts(db, row.supplier_id)).layouts };
}

/**
 * **Forget what was learned about a supplier — design §5, decision 3.** Its
 * layouts start again from invoices recorded after now. Nothing is deleted:
 * the regions stay as each invoice's own record of where its values were.
 */
export async function forgetLayouts(db: D1Database, supplierId: string, userId: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const supplier = await db.prepare("SELECT id FROM suppliers WHERE id = ?").bind(supplierId).first();
  if (!supplier) return { status: 404, body: { error: `supplier ${supplierId} does not exist` } };
  await db
    .prepare(
      `INSERT INTO supplier_layout_resets (supplier_id, reset_at, reset_by) VALUES (?, strftime('%Y-%m-%d %H:%M:%f', 'now'), ?)
       ON CONFLICT (supplier_id) DO UPDATE SET reset_at = excluded.reset_at, reset_by = excluded.reset_by`
    )
    .bind(supplierId, userId)
    .run();
  return { status: 200, body: { forgotten: true } };
}
