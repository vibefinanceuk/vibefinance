import type { ValidationSettings } from "./validation.js";

/**
 * Extraction settings, per intake channel — decision 0053.
 *
 * Every value here was previously a constant in extraction code.
 * They came from a sample of one — a German freight invoice with an
 * unusual two-page structure — and were written as platform code,
 * which asserts "this is always true".
 *
 * They are not always true. They are sensible defaults. An
 * administrator whose invoices carry unlabelled rows, or run to
 * eighty lines, should be able to SEE the assumption and change it
 * rather than discover it when their data is silently dropped.
 *
 * The defaults are exactly the shipped behaviour, so nothing changes
 * until somebody edits a value.
 */
export interface ExtractionSettings {
  /** Decision 0052 — a row with no description is not a line item.
   *  True of real invoices; false where rows are identified by code
   *  alone. */
  requireLineDescription: boolean;
  /** Decision 0043 — bounds the response so it completes. */
  maxExtractedLines: number;
  /** Decision 0044 — currency comparison tolerance, in the invoice's
   *  own units. Held in minor units in storage so the setting itself
   *  cannot suffer the floating-point problem it exists to solve. */
  currencyTolerance: number;
  /** Decision 0046 — which page wins when two disagree. */
  conflictWinner: "first" | "last";
}

export const DEFAULT_EXTRACTION_SETTINGS: ExtractionSettings = {
  requireLineDescription: true,
  maxExtractedLines: 25,
  currencyTolerance: 0.01,
  conflictWinner: "first",
};

interface ChannelSettingsRow {
  require_line_description: number;
  max_extracted_lines: number;
  currency_tolerance_minor: number;
  conflict_winner: string;
}

/**
 * Loads a channel's settings, falling back to the defaults.
 *
 * A missing channel returns defaults rather than throwing: extraction
 * failing because configuration could not be read would be a worse
 * outcome than extraction proceeding as it always has.
 */
export async function loadExtractionSettings(
  db: D1Database,
  channelId: string
): Promise<ExtractionSettings> {
  const row = await db
    .prepare(
      `SELECT require_line_description, max_extracted_lines, currency_tolerance_minor, conflict_winner
       FROM intake_channels WHERE id = ?`
    )
    .bind(channelId)
    .first<ChannelSettingsRow>();
  if (!row) return DEFAULT_EXTRACTION_SETTINGS;

  return {
    requireLineDescription: row.require_line_description === 1,
    maxExtractedLines: row.max_extracted_lines,
    // Minor units to major: 1 -> 0.01. Divided rather than stored as
    // a float so the configured value is exact.
    currencyTolerance: row.currency_tolerance_minor / 100,
    conflictWinner: row.conflict_winner === "last" ? "last" : "first",
  };
}

/** The subset validation needs, so that module does not depend on the
 *  whole settings shape. */
export function toValidationSettings(settings: ExtractionSettings): ValidationSettings {
  return { currencyTolerance: settings.currencyTolerance };
}
