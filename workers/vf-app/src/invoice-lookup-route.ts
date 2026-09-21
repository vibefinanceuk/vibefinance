import { unitsWherePermitted, scopedToChosenOrg, unitClause } from "./enforce.js";
import type { RouteResult } from "./org-route.js";

/**
 * Looking up one invoice by its own printed number — decision 0430's
 * own addendum, built for the AP Assistant's `invoice_lookup` tool
 * after live testing surfaced that the assistant had no way to answer
 * "where is invoice X" or "give me a link to invoice X's document" at
 * all, only aggregate questions across every invoice.
 *
 * **A new, small, purpose-built route rather than reusing
 * `handleGetInvoice`.** That handler exists to hydrate the keying
 * screen — buyer/supplier detail, every line's own facts, a live
 * validation verdict — none of which a chat answer needs, and none of
 * which includes the one thing a person actually asked for here: which
 * workflow stage the invoice currently sits at. Matches the same
 * "wrap the real thing, don't duplicate it" precedent this file's own
 * siblings (`overdue-balance-route.ts`) already set, just for a
 * question none of the five other design screens' own routes already
 * answer.
 *
 * **`invoice_number` is not unique** — checked directly, no `UNIQUE`
 * constraint exists on it, and two different suppliers can genuinely
 * reuse the same numbering scheme. Every match is returned, not just
 * the first; a caller with more than one match must ask which
 * supplier was meant rather than silently guessing.
 *
 * **Scoped exactly like `handleListPurchaseOrders`/`handleGetInvoice`'s
 * own screen — `AP.Validate`, the invoice keying/viewer permission**,
 * intersected with the org-unit scope every other AP Analytics route
 * already narrows by.
 *
 * **Whether a document is retained, not the document itself.** A
 * short-lived signed URL is a separate, more privileged act — minted
 * by `handleMintDocumentUrl` (`document-route.ts`) only once a caller
 * has chosen a specific, unambiguous invoice, the same two-step shape
 * `ap-assistant.ts`'s own `invoice_lookup` tool follows.
 */

interface InvoiceLookupRow {
  id: string;
  invoice_number: string | null;
  supplier_name: string | null;
  total_with_vat: number | null;
  currency: string | null;
  issue_date: string | null;
  stage_name: string | null;
  process_status: string | null;
  has_document: number;
}

export interface InvoiceLookupMatch {
  id: string;
  invoiceNumber: string | null;
  supplierName: string | null;
  totalWithVat: number | null;
  currency: string | null;
  issueDate: string | null;
  stage: string | null;
  inProgress: boolean | null;
  hasDocument: boolean;
}

export interface InvoiceLookupReport {
  matches: InvoiceLookupMatch[];
}

export async function handleInvoiceLookup(
  db: D1Database,
  currentOrg: string | null = null,
  userId: string | undefined,
  invoiceNumber: string
): Promise<RouteResult> {
  const visible = userId ? await unitsWherePermitted(db, userId, "AP.Validate") : null;
  const scopedUnits = await scopedToChosenOrg(db, visible, currentOrg);
  const clause = unitClause({ units: scopedUnits }, "h.org_unit_id");

  const rows = await db
    .prepare(
      `SELECT h.id AS id, h.invoice_number AS invoice_number,
              COALESCE(sup.name, json_extract(h.facts_json, '$."BT-27"')) AS supplier_name,
              h.total_with_vat AS total_with_vat, h.currency AS currency, h.issue_date AS issue_date,
              s.name AS stage_name, pi.status AS process_status,
              EXISTS(SELECT 1 FROM invoice_documents d WHERE d.invoice_id = h.id) AS has_document
       FROM invoice_headers h
       LEFT JOIN suppliers sup ON sup.id = h.supplier_id
       LEFT JOIN process_instances pi ON pi.subject_type = 'invoice' AND pi.subject_id = h.id
       LEFT JOIN process_stages s ON s.id = pi.current_stage_id
       WHERE h.invoice_number = ? COLLATE NOCASE ${clause.sql}
       ORDER BY h.issue_date DESC`
    )
    .bind(invoiceNumber, ...clause.binds)
    .all<InvoiceLookupRow>();

  const matches: InvoiceLookupMatch[] = rows.results.map((row) => ({
    id: row.id,
    invoiceNumber: row.invoice_number,
    supplierName: row.supplier_name,
    totalWithVat: row.total_with_vat,
    currency: row.currency,
    issueDate: row.issue_date,
    stage: row.stage_name,
    inProgress: row.process_status === null ? null : row.process_status === "in_progress",
    hasDocument: row.has_document === 1,
  }));

  return { status: 200, body: { matches } satisfies InvoiceLookupReport };
}
