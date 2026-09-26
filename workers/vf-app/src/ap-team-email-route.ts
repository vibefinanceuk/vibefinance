import type { RouteResult } from "./org-route.js";

/**
 * The AP team's own email address — decision 0498, point 4 of five.
 * The same singleton-row shape `retention-route.ts` already gives
 * `org_settings.retention_years` (migration 0032); this is
 * `ap_team_email` (migration 0089), nothing more.
 *
 * Nullable by design: absent means the CC checkbox in `viewer.js`
 * simply isn't offered yet, not an error state either route needs to
 * handle specially.
 */

/**
 * **Whether one is configured, not what it is.** The Return To
 * Supplier picker (`viewer.js`) needs to know whether to offer its own
 * CC checkbox at all, but an ordinary AP clerk returning an invoice
 * holds no `Admin.Configure` — the actual address is an admin-screen
 * concern (`handleGetApTeamEmail` below), gated accordingly; this is
 * the narrow, non-sensitive fact every authenticated person may read.
 */
export async function handleGetApTeamEmailAvailability(db: D1Database): Promise<RouteResult> {
  const row = await db.prepare("SELECT ap_team_email FROM org_settings WHERE id = 1").first<{
    ap_team_email: string | null;
  }>();
  if (!row) throw new Error("org_settings has no row — has migration 0032 been applied?");
  return { status: 200, body: { configured: Boolean(row.ap_team_email) } };
}

export async function handleGetApTeamEmail(db: D1Database): Promise<RouteResult> {
  const row = await db.prepare("SELECT ap_team_email FROM org_settings WHERE id = 1").first<{
    ap_team_email: string | null;
  }>();
  if (!row) throw new Error("org_settings has no row — has migration 0032 been applied?");
  return { status: 200, body: { apTeamEmail: row.ap_team_email } };
}

export interface SetApTeamEmailBody {
  apTeamEmail?: unknown;
}

/**
 * A very light shape check, not a full RFC 5322 parser — the same
 * pragmatic bar the new-supplier form's own email field never enforced
 * either. `null` clears it back to "not configured," same as never
 * having set one.
 */
function looksLikeAnEmailAddress(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export async function handleSetApTeamEmail(db: D1Database, body: SetApTeamEmailBody): Promise<RouteResult> {
  const { apTeamEmail } = body;
  if (apTeamEmail !== null && typeof apTeamEmail !== "string") {
    return { status: 400, body: { error: "apTeamEmail must be a string, or null to clear it" } };
  }
  const trimmed = typeof apTeamEmail === "string" ? apTeamEmail.trim() : null;
  if (trimmed !== null && trimmed !== "" && !looksLikeAnEmailAddress(trimmed)) {
    return { status: 422, body: { error: "apTeamEmail does not look like an email address" } };
  }
  const toStore = trimmed === "" ? null : trimmed;

  await db
    .prepare("UPDATE org_settings SET ap_team_email = ?, updated_at = ? WHERE id = 1")
    .bind(toStore, new Date().toISOString())
    .run();

  return { status: 200, body: { apTeamEmail: toStore } };
}
