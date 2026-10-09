/**
 * **Where each header value is on its document — decision 0701.**
 *
 * Step 1 of `docs/design/supplier-layout-learning.md` (agreed by Dan,
 * 9 October 2026). The viewer records a value's place on the page when it
 * finds it there without doubt, or when a person drags a box round it and it
 * goes into the field. Learning a supplier's layout (step 2) reads these.
 *
 * **A region is evidence only while its value is the invoice's.** A person
 * may lasso a value and never save it, or change it later; the region keeps
 * the value it was recorded with, and is `current` only while that still
 * matches the stored fact.
 */

export type RegionSource = "found" | "lassoed" | "lassoed_corrected";

export interface FieldRegion {
  field: string;
  pageNumber: number;
  box: { x: number; y: number; w: number; h: number };
  label: string | null;
  value: string;
  source: RegionSource;
  recordedAt: string;
  /** Whether the value it was recorded with is still the invoice's. */
  current: boolean;
}

/** A header field by its EN 16931 code. */
const HEADER_FIELD = /^BT-\d{1,3}$/;
/**
 * **A line's value, by line and column — decision 0705** (design §3, step 4):
 * `line.3.BT-129`. The columns a supplier's table is learned from:
 * quantity, line amount, unit price, VAT rate and the item's name.
 */
const LINE_FIELD = /^line\.(\d{1,4})\.(BT-129|BT-131|BT-146|BT-152|BT-153)$/;
const STRENGTH: Record<RegionSource, number> = { found: 1, lassoed: 3, lassoed_corrected: 5 };

function squash(text: unknown): string {
  return String(text ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

/** Whether a stored fact and a recorded value are the same value: numbers by amount, text without case or punctuation. */
export function sameValue(fact: unknown, value: unknown): boolean {
  if (fact === null || fact === undefined || value === null || value === undefined) return false;
  const a = Number(fact);
  const b = Number(value);
  if (String(fact).trim() !== "" && String(value).trim() !== "" && Number.isFinite(a) && Number.isFinite(b)) return Math.abs(a - b) < 0.005;
  const sa = squash(fact);
  return sa !== "" && sa === squash(value);
}

function fraction(n: unknown): number | null {
  const v = Number(n);
  return Number.isFinite(v) && v >= 0 && v <= 1 ? v : null;
}

async function factsOf(db: D1Database, invoiceId: string): Promise<Record<string, unknown> | null> {
  const row = await db.prepare("SELECT facts_json FROM invoice_headers WHERE id = ?").bind(invoiceId).first<{ facts_json: string }>();
  if (!row) return null;
  try {
    return JSON.parse(row.facts_json ?? "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Records where `field`'s value is. `body`:
 * `{ pageNumber, box: { x, y, w, h }, label?, value, source: "found" | "lassoed", previous? }`.
 *
 * A lasso that replaced a different value is a correction
 * (`lassoed_corrected`), the strongest evidence. A `found` region never
 * replaces a lassoed one for the same value: a person pointing outranks the
 * viewer searching.
 */
export async function handleRecordRegion(
  db: D1Database,
  invoiceId: string,
  field: string,
  userId: string | null,
  body: unknown
): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!HEADER_FIELD.test(field) && !LINE_FIELD.test(field)) {
    return { status: 400, body: { error: "field must be a header field code such as BT-112, or a line's such as line.1.BT-129" } };
  }
  const b = (body ?? {}) as Record<string, unknown>;
  const box = (b.box ?? {}) as Record<string, unknown>;
  const pageNumber = Number(b.pageNumber);
  const [x, y, w, h] = [fraction(box.x), fraction(box.y), fraction(box.w), fraction(box.h)];
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || x === null || y === null || !w || !h) {
    return { status: 400, body: { error: "pageNumber and box {x, y, w, h} as fractions of the page are required" } };
  }
  const value = typeof b.value === "string" || typeof b.value === "number" ? String(b.value).trim().slice(0, 500) : "";
  if (!value) return { status: 400, body: { error: "value is required" } };
  if (b.source !== "found" && b.source !== "lassoed") return { status: 400, body: { error: "source must be found or lassoed" } };
  const previous = typeof b.previous === "string" || typeof b.previous === "number" ? String(b.previous).trim() : "";
  const source: RegionSource =
    b.source === "lassoed" ? (previous && !sameValue(previous, value) ? "lassoed_corrected" : "lassoed") : "found";
  const label = squash(b.label).slice(0, 80) || null;

  if (!(await factsOf(db, invoiceId))) return { status: 404, body: { error: `invoice ${invoiceId} does not exist` } };

  const existing = await db
    .prepare("SELECT source, value FROM invoice_field_regions WHERE invoice_id = ? AND field = ?")
    .bind(invoiceId, field)
    .first<{ source: RegionSource; value: string }>();
  if (existing && STRENGTH[existing.source] > STRENGTH[source] && sameValue(existing.value, value)) {
    return { status: 200, body: { kept: existing.source } };
  }

  await db
    .prepare(
      `INSERT INTO invoice_field_regions (invoice_id, field, page_number, x, y, w, h, label_text, value, source, recorded_by, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT (invoice_id, field) DO UPDATE SET
         page_number = excluded.page_number, x = excluded.x, y = excluded.y, w = excluded.w, h = excluded.h,
         label_text = excluded.label_text, value = excluded.value, source = excluded.source,
         recorded_by = excluded.recorded_by, recorded_at = excluded.recorded_at`
    )
    .bind(invoiceId, field, pageNumber, x, y, Math.min(w, 1 - x), Math.min(h, 1 - y), label, value, source, userId)
    .run();
  return { status: 200, body: { recorded: source } };
}

/** A line's stored facts, by line number. */
async function lineFactsOf(db: D1Database, invoiceId: string): Promise<Map<number, Record<string, unknown>>> {
  const rows = await db.prepare("SELECT line_number, facts_json FROM invoice_lines WHERE invoice_id = ?").bind(invoiceId).all<{ line_number: number; facts_json: string | null }>();
  const out = new Map<number, Record<string, unknown>>();
  for (const r of rows.results) {
    try {
      out.set(r.line_number, JSON.parse(r.facts_json ?? "{}"));
    } catch {
      out.set(r.line_number, {});
    }
  }
  return out;
}

/** The stored value a region's field refers to: a header fact, or a line's. */
function storedValue(facts: Record<string, unknown>, lines: Map<number, Record<string, unknown>>, field: string): unknown {
  const line = field.match(LINE_FIELD);
  return line ? lines.get(Number(line[1]))?.[line[2]] : facts[field];
}

/** Every recorded region of an invoice, each saying whether its value is still the invoice's. */
export async function listRegions(db: D1Database, invoiceId: string): Promise<FieldRegion[] | null> {
  const facts = await factsOf(db, invoiceId);
  if (!facts) return null;
  const lines = await lineFactsOf(db, invoiceId);
  const rows = await db
    .prepare(
      `SELECT field, page_number, x, y, w, h, label_text, value, source, recorded_at
       FROM invoice_field_regions WHERE invoice_id = ? ORDER BY field`
    )
    .bind(invoiceId)
    .all<{ field: string; page_number: number; x: number; y: number; w: number; h: number; label_text: string | null; value: string; source: RegionSource; recorded_at: string }>();
  return rows.results.map((r) => ({
    field: r.field,
    pageNumber: r.page_number,
    box: { x: r.x, y: r.y, w: r.w, h: r.h },
    label: r.label_text,
    value: r.value,
    source: r.source,
    recordedAt: r.recorded_at,
    current: sameValue(storedValue(facts, lines, r.field), r.value),
  }));
}

/**
 * **The audit line — decision 0701.** A value a person took from the
 * document with the box, and saved: *"Dan took Invoice total from page 1 of
 * the document"*. Only while it is still the invoice's value; one changed
 * afterwards was not, in the end, taken from there.
 */
export async function regionTimeline(db: D1Database, invoiceId: string) {
  let rows: { field: string; page_number: number; value: string; source: RegionSource; recorded_at: string; user_name: string | null }[];
  try {
    rows = (
      await db
        .prepare(
          `SELECT r.field, r.page_number, r.value, r.source, r.recorded_at, u.name AS user_name
           FROM invoice_field_regions r LEFT JOIN org_users u ON u.id = r.recorded_by
           WHERE r.invoice_id = ? AND r.source IN ('lassoed', 'lassoed_corrected') AND r.field GLOB 'BT-[0-9]*'`
        )
        .bind(invoiceId)
        .all<(typeof rows)[number]>()
    ).results;
  } catch {
    return [];
  }
  if (!rows.length) return [];
  const facts = (await factsOf(db, invoiceId)) ?? {};
  const iso = (t: string) => (t.includes("T") ? t : `${t.replace(" ", "T")}Z`);
  return rows
    .filter((r) => sameValue(facts[r.field], r.value))
    .map((r) => ({
      kind: "action_taken" as const,
      at: iso(r.recorded_at),
      action: "value_from_document",
      userName: r.user_name ?? "",
      field: r.field,
      pageNumber: r.page_number,
      corrected: r.source === "lassoed_corrected",
    }));
}
