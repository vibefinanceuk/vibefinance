import type { RouteResult } from "./org-route.js";
import { isKnownField, type InvoiceFacts } from "@vibefinance/shared";
import { handleUpsertInvoice } from "./invoice-facts-route.js";

/**
 * Keying — a person producing facts extraction could not.
 *
 * The third provenance class (decision 0055 section 8). Every task in
 * this system so far reviews or approves facts that already exist; this
 * is the first where a human being creates them, by reading a document
 * the platform could not.
 *
 * It exists because decision 0063 made an undetectable document
 * *reachable* — captured with provenance, given an instance, put in
 * front of somebody — and gave them nothing to do about it but reject.
 */

export interface KeyFieldsBody {
  facts?: unknown;
  lines?: unknown;
}

/** What a keyed value may be. Deliberately narrow. */
function isKeyableValue(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

export async function handleKeyInvoiceFields(
  db: D1Database,
  invoiceId: string,
  body: KeyFieldsBody,
  // Derived from the authenticated caller by the route, never read from
  // the body. A keyed value is a claim about what a document says, made
  // by a named person, and it is only worth anything if the name is
  // real.
  keyedBy: string
): Promise<RouteResult> {
  const invoice = await db
    .prepare("SELECT id, facts_json FROM invoice_headers WHERE id = ?")
    .bind(invoiceId)
    .first<{ id: string; facts_json: string }>();
  if (!invoice) {
    return { status: 404, body: { error: `invoice ${invoiceId} does not exist` } };
  }

  const supplied = body.facts;
  if (supplied === undefined || supplied === null || typeof supplied !== "object" || Array.isArray(supplied)) {
    return { status: 400, body: { error: "facts (an object) is required" } };
  }
  const entries = Object.entries(supplied as Record<string, unknown>);
  if (entries.length === 0) {
    // Partial keying is allowed — keying NOTHING is not. It would
    // record a person as having produced facts they did not produce.
    return { status: 400, body: { error: "facts must contain at least one field" } };
  }

  // Every field must be one a rule could later reference. A value
  // nobody can address is a value nobody can use, and this is exactly
  // the divergence that produced `cost_centre` and
  // `extraction.confidence` — a real value the vocabulary had never
  // heard of.
  const unknownFields = entries.map(([f]) => f).filter((f) => !isKnownField(f, "invoice"));
  if (unknownFields.length > 0) {
    return {
      status: 422,
      body: {
        error: `not fields in the closed vocabulary: ${unknownFields.join(", ")}`,
        detail: "a keyed value must be addressable by a rule, or it cannot be used by one",
      },
    };
  }

  const unusableValues = entries.filter(([, v]) => !isKeyableValue(v) || (typeof v === "string" && v.trim() === ""));
  if (unusableValues.length > 0) {
    // A field a person cannot read is one they leave alone. Keying it
    // to an empty string is a deletion wearing a creation's clothes.
    return {
      status: 422,
      body: {
        error: `empty or unusable values for: ${unusableValues.map(([f]) => f).join(", ")}`,
        detail: "leave a field you cannot read unkeyed rather than keying it empty",
      },
    };
  }

  const existingFacts: InvoiceFacts = JSON.parse(invoice.facts_json || "{}");

  // Merged, not replaced. The document already carries what intake
  // learned about it — `intake.structure`, `intake.attempted` — and
  // losing that to record what a person typed would trade one kind of
  // provenance for another.
  const merged: Record<string, unknown> = { ...existingFacts };
  const changes: { field: string; previous: unknown; next: unknown }[] = [];
  for (const [field, value] of entries) {
    changes.push({ field, previous: existingFacts[field as keyof InvoiceFacts] ?? null, next: value });
    merged[field] = value;
  }

  // The keyed set, as a fact a rule can test — following
  // `validation.failures` and `extraction.conflicts` in being a
  // comma-separated string, so the existing `contains` operator applies
  // and no new operator is needed.
  //
  // Cumulative across keying sessions: a second person keying a
  // different field must not erase the record that the first keyed
  // theirs.
  const previouslyKeyed = String(merged["provenance.keyed"] ?? "")
    .split(",")
    .filter(Boolean);
  const keyedSet = Array.from(new Set([...previouslyKeyed, ...changes.map((c) => c.field)])).sort();
  merged["provenance.keyed"] = keyedSet.join(",");

  const now = new Date().toISOString();
  await db.batch(
    changes.map((c) =>
      db
        .prepare(
          "INSERT INTO keyed_fields (id, invoice_id, field, previous_value, new_value, keyed_by, keyed_at) VALUES (?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(
          crypto.randomUUID(),
          invoiceId,
          c.field,
          c.previous === null || c.previous === undefined ? null : JSON.stringify(c.previous),
          JSON.stringify(c.next),
          keyedBy,
          now
        )
    )
  );

  // Reuses the ordinary writer, so the structured columns stay in step
  // with facts_json exactly as they do on every other path.
  const upsert = await handleUpsertInvoice(db, {
    id: invoiceId,
    facts: merged,
    ...(body.lines === undefined ? {} : { lines: body.lines }),
  } as Parameters<typeof handleUpsertInvoice>[1]);
  if (upsert.status >= 400) return upsert;

  return {
    status: 200,
    body: {
      id: invoiceId,
      keyedBy,
      keyed: changes.map((c) => ({
        field: c.field,
        // A field extraction never produced and one it produced wrongly
        // are different events, and the second is the more
        // consequential. Reported as such rather than collapsed.
        previous: c.previous,
        value: c.next,
        corrected: c.previous !== null && c.previous !== undefined,
      })),
      provenance: { keyed: merged["provenance.keyed"] },
    },
  };
}
