import type { RouteResult } from "./org-route.js";

/**
 * Retention — decision 0077.
 *
 * A **benchmark**, not a purge schedule. Nothing here deletes anything.
 * The number says how long documents should be kept; the report says
 * what has passed it. Whether to export and purge is then a decision
 * somebody takes with the list in front of them.
 *
 * That split is deliberate. Deleting a customer's invoices on a timer
 * is irreversible, and a retention period is the kind of setting whose
 * first configuration is often wrong — a wrong number that produces a
 * report is an afternoon's confusion, and a wrong number wired to a
 * delete is a compliance incident.
 */

export interface RetentionSettings {
  retentionYears: number;
}

export async function loadRetentionSettings(db: D1Database): Promise<RetentionSettings> {
  const row = await db
    .prepare("SELECT retention_years FROM org_settings WHERE id = 1")
    .first<{ retention_years: number }>();
  // The row is created by the migration and a standing invariant keeps
  // it single, so its absence means a database that has not been
  // migrated — worth failing loudly rather than substituting a default
  // that would silently disagree with the schema's own.
  if (!row) throw new Error("org_settings has no row — has migration 0032 been applied?");
  return { retentionYears: row.retention_years };
}

export async function handleGetRetention(db: D1Database): Promise<RouteResult> {
  const settings = await loadRetentionSettings(db);
  return {
    status: 200,
    body: {
      retentionYears: settings.retentionYears,
      // Said in the payload rather than left to be assumed. An operator
      // reading a retention period could reasonably expect it to be
      // enforced.
      enforcement: "none — this is a benchmark for review, and nothing is deleted automatically",
      anchor:
        "the invoice's own issue date where it has one, and the date it was captured where it does not",
    },
  };
}

export async function handleSetRetention(
  db: D1Database,
  body: Record<string, unknown>
): Promise<RouteResult> {
  const { retentionYears } = body;
  if (typeof retentionYears !== "number" || !Number.isInteger(retentionYears)) {
    return { status: 400, body: { error: "retentionYears (a whole number of years) is required" } };
  }
  if (retentionYears < 1 || retentionYears > 50) {
    // The same bound the schema enforces, checked here so the caller
    // gets a reason rather than a constraint error.
    return {
      status: 422,
      body: { error: "retentionYears must be between 1 and 50 — a longer period is a typo, not a policy" },
    };
  }

  await db
    .prepare("UPDATE org_settings SET retention_years = ?, updated_at = ? WHERE id = 1")
    .bind(retentionYears, new Date().toISOString())
    .run();

  return { status: 200, body: { retentionYears } };
}

interface BeyondRetentionRow {
  id: string;
  issue_date: string | null;
  created_at: string;
  r2_key: string | null;
  content_type: string | null;
}

/**
 * What has passed the benchmark.
 *
 * The anchor is the invoice's **own issue date** where it has one, and
 * its capture date where it does not. Regulations are written about the
 * document's date rather than the day a system happened to read it —
 * but an undetectable document has no issue date at all (decision
 * 0063), and falling back is better than excluding exactly the
 * documents nobody could read.
 *
 * Which anchor was used is reported per row, because the two can differ
 * by months and somebody deciding whether to purge should not have to
 * guess which applied.
 */
export async function handleListBeyondRetention(db: D1Database): Promise<RouteResult> {
  const { retentionYears } = await loadRetentionSettings(db);

  const rows = await db
    .prepare(
      `SELECT h.id, h.issue_date, h.created_at, d.r2_key, d.content_type
       FROM invoice_headers h
       LEFT JOIN invoice_documents d ON d.invoice_id = h.id AND d.document_type = 'original'
       WHERE date(COALESCE(h.issue_date, h.created_at), '+' || ? || ' years') < date('now')
       ORDER BY COALESCE(h.issue_date, h.created_at)`
    )
    .bind(retentionYears)
    .all<BeyondRetentionRow>();

  return {
    status: 200,
    body: {
      retentionYears,
      count: rows.results.length,
      invoices: rows.results.map((r) => ({
        id: r.id,
        anchor: r.issue_date ?? r.created_at,
        anchorSource: r.issue_date ? "issue_date" : "captured_at",
        // Null where no original was retained — a document captured
        // before decision 0068, or one whose retention failed. Worth
        // surfacing: there is nothing in R2 to purge for these, and
        // that is itself a finding.
        r2Key: r.r2_key,
        contentType: r.content_type,
      })),
      note:
        rows.results.length === 0
          ? "nothing has passed the retention period"
          : "review these before exporting or purging — nothing is deleted automatically",
    },
  };
}
