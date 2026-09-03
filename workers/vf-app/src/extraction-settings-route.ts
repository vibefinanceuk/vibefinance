import type { RouteResult } from "./org-route.js";
import { loadExtractionSettings } from "./extraction-settings.js";

/**
 * Reading and changing a channel's extraction settings — decision
 * 0053.
 *
 * The point of the whole decision: an administrator can SEE the
 * assumptions the platform makes about their documents, and change
 * the ones that are wrong for them. A setting nobody can inspect is
 * indistinguishable from hardcoded behaviour.
 */

const SETTABLE = {
  requireLineDescription: "require_line_description",
  maxExtractedLines: "max_extracted_lines",
  currencyToleranceMinor: "currency_tolerance_minor",
  conflictWinner: "conflict_winner",
} as const;

export async function handleGetExtractionSettings(
  db: D1Database,
  channelId: string
): Promise<RouteResult> {
  const channel = await db.prepare("SELECT id FROM intake_channels WHERE id = ?").bind(channelId).first();
  if (!channel) {
    return { status: 404, body: { error: `intake channel ${channelId} does not exist` } };
  }
  const settings = await loadExtractionSettings(db, channelId);
  return {
    status: 200,
    body: {
      channelId,
      ...settings,
      // Each setting carries the decision that introduced it, so an
      // administrator reading this can find out WHY it exists rather
      // than only what it does.
      provenance: {
        requireLineDescription: "0052 — a row with no description is not a line item",
        maxExtractedLines: "0043 — bounds the model's response so it completes",
        currencyTolerance: "0044 — currency comparison tolerance",
        conflictWinner: "0046 — which page wins when two disagree",
      },
    },
  };
}

export async function handleUpdateExtractionSettings(
  db: D1Database,
  channelId: string,
  body: Record<string, unknown>
): Promise<RouteResult> {
  const channel = await db.prepare("SELECT id FROM intake_channels WHERE id = ?").bind(channelId).first();
  if (!channel) {
    return { status: 404, body: { error: `intake channel ${channelId} does not exist` } };
  }

  const updates: { column: string; value: number | string }[] = [];

  if ("requireLineDescription" in body) {
    if (typeof body.requireLineDescription !== "boolean") {
      return { status: 400, body: { error: "requireLineDescription must be true or false" } };
    }
    updates.push({ column: SETTABLE.requireLineDescription, value: body.requireLineDescription ? 1 : 0 });
  }
  if ("maxExtractedLines" in body) {
    const n = body.maxExtractedLines;
    // Bounded at both ends, and the reasons differ: 0 would ask for
    // no lines while appearing to ask for some, and an unbounded
    // value would reintroduce the timeout decision 0047 exists to
    // prevent.
    if (typeof n !== "number" || !Number.isInteger(n) || n < 1 || n > 200) {
      return { status: 400, body: { error: "maxExtractedLines must be a whole number between 1 and 200" } };
    }
    updates.push({ column: SETTABLE.maxExtractedLines, value: n });
  }
  if ("currencyToleranceMinor" in body) {
    const n = body.currencyToleranceMinor;
    if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > 10000) {
      return {
        status: 400,
        body: { error: "currencyToleranceMinor must be a whole number of minor units (pence/cents) between 0 and 10000" },
      };
    }
    updates.push({ column: SETTABLE.currencyToleranceMinor, value: n });
  }
  if ("conflictWinner" in body) {
    if (body.conflictWinner !== "first" && body.conflictWinner !== "last") {
      return { status: 400, body: { error: "conflictWinner must be 'first' or 'last'" } };
    }
    updates.push({ column: SETTABLE.conflictWinner, value: body.conflictWinner });
  }

  if (updates.length === 0) {
    return { status: 400, body: { error: `no settable field supplied — one of ${Object.keys(SETTABLE).join(", ")}` } };
  }

  // Column names come from the SETTABLE map, never from the request,
  // so no caller-supplied string reaches the SQL.
  const assignments = updates.map((u) => `${u.column} = ?`).join(", ");
  await db
    .prepare(`UPDATE intake_channels SET ${assignments} WHERE id = ?`)
    .bind(...updates.map((u) => u.value), channelId)
    .run();

  return handleGetExtractionSettings(db, channelId);
}
