import type { RouteResult } from "./org-route.js";
import { getCostObjectRule } from "./coding-config-route.js";
import { isPoInvoice, nonPoLines } from "./po-pairings.js";
import { isKnownField, type InvoiceFacts } from "@vibefinance/shared";
import { handleUpsertInvoice } from "./invoice-facts-route.js";
import { validateInvoiceFacts, accountCodingFailures, duplicateVerdict } from "./validation.js";
import { POSSIBLE_DUPLICATE_THRESHOLD } from "./invoice-history.js";
import { resolveFieldVisibility } from "./field-visibility-route.js";
import { mergePoMatchFacts } from "./po-matching.js";
import {
  CODING_FIELD_LISTS,
  CodingLookupCache,
  checkLineCoding,
  mergeCodingValidityFacts,
  type CodingProblem,
} from "./coding-validation.js";
import {
  checkSplits,
  loadSplits,
  parseSplits,
  round2,
  saveSplitStatements,
  splitShapeProblem,
  type CodingSplit,
} from "./coding-splits.js";

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
  /**
   * What this stage permits, enforced here rather than trusted from the
   * screen — decision 0144.
   *
   * The same discipline as decision 0010's identity: **derived, never
   * accepted**. A screen that hides a field is a courtesy; a route that
   * refuses one is the rule.
   */
  /**
   * **Derived from where the invoice actually is**, never taken from
   * the caller — the same discipline decision 0010 applies to identity.
   * A stage id in the request body would let somebody key at whichever
   * stage suited them.
   */
  const instance = await db
    .prepare(
      "SELECT current_stage_id FROM process_instances WHERE subject_type = 'invoice' AND subject_id = ? AND status = 'in_progress' LIMIT 1"
    )
    .bind(invoiceId)
    .first<{ current_stage_id: string }>();

  /**
   * **An invoice outside a process is read-only** — decision 0164.
   *
   * Decision 0144 left this open and said so: *"an invoice that has
   * left its process is editable by anybody with `AP.Validate`."*
   * Nothing could reach one, so it stayed theoretical — until the
   * document manager made every invoice openable.
   *
   * The operator settled the rule: *"anything paid should not be
   * modified... validation should determine the fields, matching and
   * coding should assign the PO lines. There need not be any
   * modifications after that."*
   *
   * **Editing belongs to a task.** A document nothing is working on is
   * a document nobody was asked to change.
   */
  /**
   * **Which unit this document belongs to** — decision 0197, and read
   * before the visibility check because that check now depends on it.
   */
  const invoiceUnit = await db
    .prepare("SELECT org_unit_id FROM invoice_headers WHERE id = ?")
    .bind(invoiceId)
    .first<{ org_unit_id: string | null }>();
  const invoiceUnitId = invoiceUnit?.org_unit_id ?? null;

  const editable = instance
    ? await editableFieldsAt(db, instance.current_stage_id, invoiceUnitId)
    : new Set<string>();

  const invoice = await db
    .prepare(
      `SELECT id, facts_json, supplier_vat_id, currency, issue_date, total_with_vat, mandate_channel, invoice_number
       FROM invoice_headers WHERE id = ?`
    )
    .bind(invoiceId)
    .first<{
      id: string;
      facts_json: string;
      supplier_vat_id: string | null;
      currency: string | null;
      issue_date: string | null;
      total_with_vat: number | null;
      mandate_channel: string | null;
      invoice_number: string | null;
    }>();
  if (!invoice) {
    return { status: 404, body: { error: `invoice ${invoiceId} does not exist` } };
  }

  /**
   * **Editing belongs to whoever has this task claimed** — decision
   * 0486, closing a gap decision 0403 flagged but never verified:
   * *"whether the API also refuses [a line edit posted for an
   * unclaimed document] sent directly was not investigated as part of
   * this decision."* It did not — reported live, an unclaimed Coding
   * task's Account Coding fields saved anyway.
   *
   * Mirrors `handleCompleteTask`'s own inline ownership check
   * (`task-route.ts`): a named-user task is only ever that person's; a
   * team task must be claimed, and only by the claimer.
   *
   * **Only enforced when an open task actually exists at this stage.**
   * A document with none open at all (the Documents screen's own use
   * of this viewer, decision 0167) was never task-gated by this route
   * to begin with — the frontend already keeps that case read-only via
   * `canEditAnything`, and this fix does not change it, matching every
   * existing test here that keys a seeded invoice with no task row at
   * all. What this closes is the case where a real, open task exists —
   * sitting unclaimed, or claimed by somebody else — and this route let
   * the save through regardless of who was asking.
   */
  if (instance) {
    const openTasksHere = await db
      .prepare(
        `SELECT t.owner_user_id, t.claimed_by
         FROM tasks t
         JOIN stage_visits v ON v.id = t.stage_visit_id
         JOIN process_instances pi ON pi.id = v.process_instance_id
         WHERE pi.subject_type = 'invoice' AND pi.subject_id = ?
           AND pi.current_stage_id = t.stage_id
           AND t.status = 'open'`
      )
      .bind(invoiceId)
      .all<{ owner_user_id: string | null; claimed_by: string | null }>();

    const mine = openTasksHere.results.some(
      (t) => t.owner_user_id === keyedBy || t.claimed_by === keyedBy
    );
    if (openTasksHere.results.length > 0 && !mine) {
      return {
        status: 403,
        body: {
          error: "this task is not claimed by you",
          reason: "not_claimed",
        },
      };
    }
  }

  const supplied = body.facts;
  if (supplied === undefined || supplied === null || typeof supplied !== "object" || Array.isArray(supplied)) {
    return { status: 400, body: { error: "facts (an object) is required" } };
  }
  const entries = Object.entries(supplied as Record<string, unknown>);

  /**
   * **Refused, not ignored** — decision 0144.
   *
   * Silently dropping a field a stage does not permit would tell
   * somebody their edit was saved when it was not, which is the failure
   * decision 0119 spent a day on from the other direction. Named
   * individually, because *"some fields were refused"* sends a person
   * hunting.
   */
  {
    /**
     * **Only fields that exist.** A field outside the closed vocabulary
     * is not an editing-permission problem, and saying *"this stage
     * does not permit editing that"* about `BT-9999` sends somebody
     * looking for a setting rather than a typo.
     *
     * So an unknown field falls through to the vocabulary check, which
     * is the one that can explain it.
     */
    /**
     * **A field the screen fills in is not a field somebody edited** —
     * decision 0173.
     *
     * The viewer sets `BT-126` itself, to the line's own position, so
     * that a document carrying no line numbers still has them. `BT-126`
     * is `read` by default, and decision 0164's check refused the whole
     * save with *"this stage does not permit editing those fields"* —
     * **blocking every line edit at Validation.**
     *
     * Reported the moment somebody tried to key a line.
     *
     * Before decision 0164 the check ran only where a stage restricted
     * something, so a screen-supplied value never met it. Widening the
     * check widened what it refused.
     *
     * Exempted by name rather than by relaxing the rule: this is one
     * field the interface derives, and every other read-only field
     * still refuses.
     */
    const SCREEN_SUPPLIED = new Set(["BT-126"]);

    const refused = [
      ...entries
        .filter(
          ([field]) =>
            isKnownField(field) && !editable.has(field) && !SCREEN_SUPPLIED.has(field)
        )
        .map(([field]) => field),
      ...(Array.isArray(body.lines)
        ? body.lines.flatMap((line) =>
            Object.keys((line as { facts?: Record<string, unknown> })?.facts ?? {}).filter(
              (field) =>
                isKnownField(field) && !editable.has(field) && !SCREEN_SUPPLIED.has(field)
            )
          )
        : []),
    ];

    if (refused.length > 0) {
      return {
        status: 403,
        body: {
          error: "this stage does not permit editing those fields",
          reason: "not_editable_here",
          fields: [...new Set(refused)],
        },
      };
    }

    /**
     * **A line is structure, not a field.** Adding one changes the
     * shape of the document, and a stage that permits editing nothing
     * cannot permit that either — which is how an approver added a line
     * whose every field was read-only.
     */
    if (editable.size === 0 && Array.isArray(body.lines) && body.lines.length > 0) {
      return {
        status: 403,
        body: {
          error: "this stage does not permit changing lines",
          reason: "not_editable_here",
        },
      };
    }
  }
  if (entries.length === 0 && !Array.isArray(body.lines)) {
    // Partial keying is allowed — keying NOTHING is not. It would
    // record a person as having produced facts they did not produce.
    //
    // **Lines count as something** (decision 0109). Somebody typing a
    // line table and no header field is exactly the case this screen
    // exists for, and the original guard refused it: `facts` was the
    // only thing keying could mean when it was written.
    return { status: 400, body: { error: "facts or lines must contain at least one entry" } };
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
  // `line` is null for a header field. One trail rather than two, so
  // "what did a person type on this invoice" is one query (0109).
  const changes: { field: string; previous: unknown; next: unknown; line: number | null }[] = [];
  for (const [field, value] of entries) {
    changes.push({
      field,
      previous: existingFacts[field as keyof InvoiceFacts] ?? null,
      next: value,
      line: null,
    });
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
  /**
   * Lines a person typed — decision 0109.
   *
   * The route has always accepted `body.lines` and passed them to the
   * ordinary writer, so keyed lines were storable. **What was missing
   * is any record that a person typed them**, which left a typed line
   * indistinguishable from an extracted one.
   *
   * Recorded as `line.<n>.<field>` in the same `provenance.keyed` list
   * as header fields, so a rule testing it with `contains` sees both.
   */
  const existingLines = await db
    .prepare("SELECT line_number, description, amount, cost_centre, facts_json FROM invoice_lines WHERE invoice_id = ?")
    .bind(invoiceId)
    .all<{
      line_number: number;
      description: string | null;
      amount: number | null;
      cost_centre: string | null;
      facts_json: string;
    }>();

  const before = new Map(existingLines.results.map((l) => [l.line_number, l]));

  /**
   * **Split coding — decision 0548.** A line may carry `splits`: its
   * cost shared across two to ten rows, each with a cost centre or
   * project and a GL code. Absent means "leave the split as it is";
   * `[]` or `null` removes it. Only a change is checked, recorded and
   * written, so a split resent untouched never blocks a save.
   *
   * Splitting is coding the line's cost object, so it needs Cost Centre
   * or Project editable at this stage (0144's own rule). The rows must
   * add up to the line's net amount. A split line's own cost centre,
   * project and GL code are cleared: the rows say where the cost goes.
   */
  const storedSplits = await loadSplits(db, invoiceId);
  const splitChanges = new Map<number, CodingSplit[]>();
  const sameSplit = (a: CodingSplit[], b: CodingSplit[]) =>
    JSON.stringify(a.map((x) => [x.costCentre, x.project, x.glCode, x.sharePct, round2(x.amount)])) ===
    JSON.stringify(b.map((x) => [x.costCentre, x.project, x.glCode, x.sharePct, round2(x.amount)]));
  if (Array.isArray(body.lines)) {
    const SHAPE_WHY = {
      too_few: "a split needs at least two rows",
      too_many: "a line can be split ten ways at most",
      not_positive: "every split needs an amount, of the same sign as the line",
      unbalanced: "the split does not add up to the line's net amount",
      no_net: "a line with no net amount cannot be split",
    } as const;
    for (const line of body.lines as Record<string, unknown>[]) {
      if (!("splits" in line)) continue;
      const lineNumber = Number(line.lineNumber);
      if (!Number.isInteger(lineNumber) || lineNumber < 1) continue;
      const parsed = parseSplits(line.splits);
      if (!parsed.ok) {
        return { status: 400, body: { error: `line ${lineNumber}: ${parsed.error}`, reason: "invalid_split", line: lineNumber } };
      }
      if (sameSplit(storedSplits.get(lineNumber) ?? [], parsed.splits)) continue;
      if (!editable.has("BT-133") && !editable.has("coding.project")) {
        return {
          status: 403,
          body: { error: "this stage does not permit editing those fields", reason: "not_editable_here", fields: ["coding.split"] },
        };
      }
      let previousFacts: Record<string, unknown> = {};
      try {
        previousFacts = JSON.parse(before.get(lineNumber)?.facts_json ?? "{}") as Record<string, unknown>;
      } catch {
        // Unparseable stored facts count as none.
      }
      const facts = (line.facts ?? {}) as Record<string, unknown>;
      const problem = splitShapeProblem(facts["BT-131"] !== undefined ? facts["BT-131"] : previousFacts["BT-131"], parsed.splits);
      if (problem) {
        return {
          status: 422,
          body: { error: `Not saved: line ${lineNumber}: ${SHAPE_WHY[problem]}.`, reason: "invalid_split", problem, line: lineNumber },
        };
      }
      splitChanges.set(lineNumber, parsed.splits);
      if (parsed.splits.length > 0) {
        line.facts = { ...facts, "BT-133": "", "coding.project": "", "coding.gl_code": "" };
        line.costCentre = undefined;
      }
    }
    // Decision 0540 — a split row holds a cost centre or a project, not both, as a line does.
    if (splitChanges.size > 0 && (await getCostObjectRule(db)) === "exclusive") {
      const both = [...splitChanges].filter(([, rows]) => rows.some((r) => r.costCentre && r.project)).map(([n]) => n);
      if (both.length > 0) {
        return {
          status: 422,
          body: {
            error: `A line carries a cost centre or a project, not both (line ${both.join(", ")}).`,
            reason: "cost_centre_and_project",
            lines: both,
          },
        };
      }
    }
  }

  /**
   * **Cost Centre OR Project on a line — decision 0540**, when AP
   * Setup's either/or rule is on. A save that keys one of the two on a
   * line already holding the other clears the other — a supplier's own
   * BT-133 included — so switching a line from a cost centre to a
   * project is one save; the cleared value is recorded like any keyed
   * change. A save keying both at once is refused rather than guessed
   * at. A line that held both before this rule, and is saved for some
   * other reason, is left alone: only what this save changes.
   */
  if (Array.isArray(body.lines) && (await getCostObjectRule(db)) === "exclusive") {
    const blank = (v: unknown) => v === undefined || v === null || String(v).trim() === "";
    const both: number[] = [];
    for (const line of body.lines as Record<string, unknown>[]) {
      const lineNumber = Number(line.lineNumber);
      if (!Number.isInteger(lineNumber) || lineNumber < 1) continue;
      let previousFacts: Record<string, unknown> = {};
      try {
        previousFacts = JSON.parse(before.get(lineNumber)?.facts_json ?? "{}") as Record<string, unknown>;
      } catch {
        // Unparseable stored facts count as none.
      }
      const next = (line.facts ?? {}) as Record<string, unknown>;
      const keyedNow = (field: string) => !blank(next[field]) && String(next[field]) !== String(previousFacts[field] ?? "");
      const heldAfter = (field: string) => !blank(next[field] !== undefined ? next[field] : previousFacts[field]);
      if (!heldAfter("BT-133") || !heldAfter("coding.project")) continue;
      const cc = keyedNow("BT-133");
      const project = keyedNow("coding.project");
      if (cc && project) both.push(lineNumber);
      else if (cc) line.facts = { ...next, "coding.project": "" };
      else if (project) {
        line.facts = { ...next, "BT-133": "" };
        // The line's own cost_centre column follows BT-133 (0016).
        line.costCentre = undefined;
      }
    }
    if (both.length > 0) {
      return {
        status: 422,
        body: {
          error: `A line carries a cost centre or a project, not both (line ${both.join(", ")}).`,
          reason: "cost_centre_and_project",
          lines: both,
        },
      };
    }
  }

  /**
   * **A coding value must be one Account Coding actually holds** —
   * decision 0511. Refused, not flagged: the operator's own choice, and
   * the same "refused, not ignored" discipline decision 0144 applies to
   * a field this stage does not permit.
   *
   * **Only what this save changes.** The viewer sends every editable
   * line field on every save (decision 0109), so an untouched value is
   * resent as a matter of course — including a supplier's own BT-133
   * that arrived invalid and is already flagged by
   * `coding.line_invalid`. Refusing that would block somebody saving an
   * unrelated correction on the same line. General Ledger Code is
   * re-checked when the line's Commodity Code changes too, since that
   * is what it is linked to.
   *
   * Checked before anything is written: no `keyed_fields` row, no
   * upsert, for a save that is going to be refused.
   */
  // Decision 0537 — on a PO invoice only a line marked Non-PO at Matching is coded by hand.
  const headerAfter = { ...(existingFacts as Record<string, unknown>), ...Object.fromEntries(entries) };
  const poInvoice = isPoInvoice(headerAfter);
  const nonPo = poInvoice ? await nonPoLines(db, invoiceId, headerAfter as InvoiceFacts) : new Set<number>();
  {
    const cache = new CodingLookupCache(db);
    const invalid: (CodingProblem & { line: number | null; split?: number })[] = [];
    const poMatchedCoding: { line: number; field: string }[] = [];

    const changedCodingFields = (
      previous: Record<string, unknown>,
      next: Record<string, unknown>
    ): Set<string> => {
      const changed = new Set<string>();
      for (const field of Object.keys(CODING_FIELD_LISTS)) {
        if (next[field] === undefined) continue;
        if (String(next[field] ?? "") !== String(previous[field] ?? "")) changed.add(field);
      }
      if (changed.has("coding.commodity_code")) changed.add("coding.gl_code");
      // Decision 0543 — a GL code is re-checked when the cost centre it is allowed for changes.
      if (changed.has("BT-133")) changed.add("coding.gl_code");
      return changed;
    };

    // Header-level coding reaches every line — per-line evaluation
    // merges header facts beneath each line's own (decision 0027).
    const headerNext = Object.fromEntries(entries);
    const headerChanged = changedCodingFields(existingFacts as Record<string, unknown>, headerNext);
    if (headerChanged.size > 0) {
      const headerMerged = { ...(existingFacts as Record<string, unknown>), ...headerNext };
      for (const problem of await checkLineCoding(db, invoiceUnitId, headerMerged, headerChanged, cache)) {
        invalid.push({ ...problem, line: null });
      }
    }

    if (Array.isArray(body.lines)) {
      for (const line of body.lines as Record<string, unknown>[]) {
        const lineNumber = Number(line.lineNumber);
        if (!Number.isInteger(lineNumber) || lineNumber < 1) continue;
        let previousFacts: Record<string, unknown> = {};
        try {
          previousFacts = JSON.parse(before.get(lineNumber)?.facts_json ?? "{}") as Record<string, unknown>;
        } catch {
          // Unparseable stored facts count as none, as below.
        }
        const nextFacts = (line.facts ?? {}) as Record<string, unknown>;
        const changed = changedCodingFields(previousFacts, nextFacts);
        if (changed.size === 0) continue;
        /**
         * **Refused on a PO invoice's line unless it is marked Non-PO —
         * decision 0537.** A PO line and manual coding are mutually
         * exclusive: a matched line takes its coding from the PO. Only
         * what this save changes, as above, so a supplier's own BT-133
         * resent untouched never blocks a save.
         */
        if (poInvoice && !nonPo.has(lineNumber)) {
          for (const field of changed) if (nextFacts[field] !== undefined) poMatchedCoding.push({ line: lineNumber, field });
          continue;
        }
        const mergedLine = { ...previousFacts, ...nextFacts };
        for (const problem of await checkLineCoding(db, invoiceUnitId, mergedLine, changed, cache)) {
          invalid.push({ ...problem, line: lineNumber });
        }
      }
    }

    // Decision 0548 — a split is coding like any other: Non-PO lines only on a PO invoice, and values on the lists.
    for (const [lineNumber, rows] of splitChanges) {
      if (rows.length === 0) continue;
      if (poInvoice && !nonPo.has(lineNumber)) {
        poMatchedCoding.push({ line: lineNumber, field: "coding.split" });
        continue;
      }
      let previousFacts: Record<string, unknown> = {};
      try {
        previousFacts = JSON.parse(before.get(lineNumber)?.facts_json ?? "{}") as Record<string, unknown>;
      } catch {
        // None.
      }
      const sent = (body.lines as Record<string, unknown>[]).find((l) => Number(l.lineNumber) === lineNumber);
      const lineFacts = { ...previousFacts, ...((sent?.facts ?? {}) as Record<string, unknown>) };
      for (const p of await checkSplits(db, invoiceUnitId, lineFacts, rows, cache)) {
        invalid.push({ field: p.field, value: p.value, reason: p.reason, line: lineNumber, split: p.split });
      }
    }

    if (poMatchedCoding.length > 0) {
      const lineList = [...new Set(poMatchedCoding.map((p) => p.line))].join(", ");
      return {
        status: 422,
        body: {
          error: `Account Coding can only be keyed on a Non-PO line of a purchase order invoice (line ${lineList}). Mark the line as a Non-PO line at Matching to code it.`,
          reason: "coding_on_po_line",
          lines: poMatchedCoding,
        },
      };
    }

    if (invalid.length > 0) {
      const WHY: Record<CodingProblem["reason"], string> = {
        not_on_list: "is not on the Account Coding list",
        wrong_company: "does not belong to this invoice's company code",
        wrong_commodity: "is not linked to the line's Commodity Code",
        closed: "is closed",
        wrong_cost_centre: "is not allowed for the line's Cost Centre",
      };
      return {
        status: 422,
        body: {
          error: `Account Coding values not accepted: ${invalid
            .map((p) => `${p.line === null ? "" : `line ${p.line} `}${p.split ? `split ${p.split} ` : ""}${p.field} "${p.value}" ${WHY[p.reason]}`)
            .join("; ")}`,
          reason: "invalid_coding",
          invalid,
        },
      };
    }
  }

  if (Array.isArray(body.lines)) {
    for (const line of body.lines as Record<string, unknown>[]) {
      // **From the line itself, not from its position.** The writer
      // requires an explicit `lineNumber` and refuses without one,
      // which is the better design: a caller says which line it means
      // rather than relying on array order surviving a round trip.
      const lineNumber = Number(line.lineNumber);
      if (!Number.isInteger(lineNumber) || lineNumber < 1) continue;
      const previous = before.get(lineNumber);

      // Decision 0681: a line's text and amount are its BT-153 and BT-131,
      // recorded with the rest of its facts below; there is no separate
      // column to record.

      /**
       * The line's own **facts**, which are what a rule can test.
       *
       * Per-line evaluation merges header facts with each line's own
       * (decision 0027), so a BT code keyed onto a line is the thing a
       * line-scoped rule sees. Recording only the columns would leave
       * `provenance.keyed` claiming less than a person actually typed.
       */
      const nextFacts = (line.facts ?? {}) as Record<string, unknown>;
      let previousFacts: Record<string, unknown> = {};
      try {
        previousFacts = JSON.parse(previous?.facts_json ?? "{}") as Record<string, unknown>;
      } catch {
        // A line whose stored facts cannot be parsed is treated as
        // having none, rather than failing the whole save.
      }

      for (const [code, value] of Object.entries(nextFacts)) {
        if (previousFacts[code] === value) continue;
        changes.push({
          field: `line.${lineNumber}.${code}`,
          previous: previousFacts[code] ?? null,
          next: value,
          line: lineNumber,
        });
      }

      // Decision 0548 — the split, as one change: the rows before and after.
      const split = splitChanges.get(lineNumber);
      if (split) {
        const was = storedSplits.get(lineNumber) ?? [];
        changes.push({
          field: `line.${lineNumber}.coding.split`,
          previous: was.length > 0 ? was : null,
          next: split.length > 0 ? split : null,
          line: lineNumber,
        });
      }
    }
  }

  const previouslyKeyed = String(merged["provenance.keyed"] ?? "")
    .split(",")
    .filter(Boolean);
  const keyedSet = Array.from(new Set([...previouslyKeyed, ...changes.map((c) => c.field)])).sort();
  merged["provenance.keyed"] = keyedSet.join(",");

  const now = new Date().toISOString();
  // An empty batch is a D1 error, and empty is now reachable: somebody
  // may open a line table, save, and have changed nothing (0109). That
  // is a legitimate no-op rather than a failure.
  if (changes.length > 0) {
    await db.batch(
    changes.map((c) =>
      db
        .prepare(
          "INSERT INTO keyed_fields (id, invoice_id, field, previous_value, new_value, keyed_by, keyed_at, line_number) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(
          crypto.randomUUID(),
          invoiceId,
          c.field,
          c.previous === null || c.previous === undefined ? null : JSON.stringify(c.previous),
          JSON.stringify(c.next),
          keyedBy,
          now,
            c.line
          )
      )
    );
  }

  /**
   * A line keeps the facts nobody sent — decision 0174.
   *
   * `handleUpsertInvoice` replaces the whole line set, which is right
   * and says why: *"never a partial merge, so a caller can never end up
   * with a mix of old and new lines by accident."* That protects the
   * **set** of lines.
   *
   * **It destroyed the facts within each one.** The viewer sends only
   * the fields it renders as inputs, and decision 0171 made
   * `description` read-only — so saving at Validation wrote back eight
   * lines with no descriptions, and the extracted text was gone.
   *
   * Reported as *"the descriptions appeared in validation, but not in
   * approval"*, which was the data and not the screen.
   *
   * **Decision 0120 fixed exactly this for header facts** and lines
   * were never given the same treatment. Merged by line number, which
   * is what a person editing line three means by line three.
   */
  const previousLineFacts = new Map<number, Record<string, unknown>>();
  for (const row of existingLines.results) {
    try {
      previousLineFacts.set(row.line_number, JSON.parse(row.facts_json || "{}"));
    } catch {
      // A line whose facts will not parse has none to preserve.
    }
  }

  const mergedLines = Array.isArray(body.lines)
    ? body.lines.map((line) => {
        const supplied = line as { lineNumber?: number; facts?: Record<string, unknown> };
        const previous =
          supplied.lineNumber === undefined
            ? {}
            : previousLineFacts.get(supplied.lineNumber) ?? {};

        // What was sent wins; what was not sent survives. Decision 0681:
        // keying writes Business Terms only — a line's text, amount and
        // cost centre are its BT-153, BT-131 and BT-133 facts, which the
        // stage's field permissions above have already checked.
        return { lineNumber: supplied.lineNumber, facts: { ...previous, ...(supplied.facts ?? {}) } };
      })
    : body.lines;

  /**
   * **A header-only edit keeps the lines — decision 0532.** The writer
   * replaces the whole line set, and an absent `lines` reached it as an
   * empty one: keying a header field without sending lines deleted every
   * line. The viewer always sends every line, so nothing on screen hit
   * it; decision 0530's "Use this PO" keys BT-13 alone and did. Found
   * while testing 0532's pairings. Now an absent `lines` means "leave
   * them as they are": the stored lines are written back unchanged.
   */
  const preservedLines = existingLines.results.map((row) => {
    let facts: Record<string, unknown> = {};
    try {
      facts = JSON.parse(row.facts_json || "{}");
    } catch {
      // Kept as none, exactly as the other readers here do.
    }
    // Decision 0681: the facts are the line; its columns are generated from them.
    return { lineNumber: row.line_number, facts };
  });

  /**
   * Reuses the ordinary writer. **The facts are the invoice — decision
   * 0681.** Decision 0539 sent the structured columns back with the facts
   * because the writer blanked any it was not given; those columns are
   * now generated from the facts (migration 0148), so there is nothing
   * to send back and nothing to blank. `mandate_channel` is not a
   * Business Term and keeps its own column.
   */
  const upsert = await handleUpsertInvoice(db, {
    id: invoiceId,
    // Decision 0681: the facts are the invoice; the header columns are generated from them.
    mandateChannel: invoice.mandate_channel,
    facts: merged,
    lines: body.lines === undefined ? preservedLines : mergedLines,
  } as Parameters<typeof handleUpsertInvoice>[1]);
  if (upsert.status >= 400) return upsert;

  // Decision 0548 — the splits, once the lines they belong to are written; none left behind for a line that is gone.
  {
    const statements: D1PreparedStatement[] = [];
    for (const [lineNumber, rows] of splitChanges) statements.push(...saveSplitStatements(db, invoiceId, lineNumber, rows));
    if (Array.isArray(body.lines) && storedSplits.size > 0) {
      const kept = new Set((body.lines as Record<string, unknown>[]).map((l) => Number(l.lineNumber)));
      for (const lineNumber of storedSplits.keys()) {
        if (!kept.has(lineNumber)) statements.push(...saveSplitStatements(db, invoiceId, lineNumber, []));
      }
    }
    if (statements.length > 0) await db.batch(statements);
  }

  // Validation is re-run and REPORTED, never stored — decision 0072.
  //
  // The operator's actual question is "is it valid now", and after
  // keying nothing else answers it: rules do not re-evaluate, because
  // re-visiting a stage that is waiting on people would raise the same
  // tasks a second time.
  //
  // Safe to run here precisely because it is a pure function (decision
  // 0044): arithmetic and presence over the facts in hand, no writes and
  // no side effects. Rule evaluation is neither.
  const lines = await db
    .prepare("SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY line_number")
    .bind(invoiceId)
    .all<Record<string, unknown>>();
  // po.matched/po.variance_pct reach this advisory too — decision 0400.
  // **Header only.** `lines.results` here is the raw invoice_lines row
  // shape (facts_json still a string, never parsed) rather than real
  // per-line facts — a pre-existing gap this change does not reach
  // into, so line-level po_mismatch is not wired in on this path; it
  // already is on the read-on-arrival path (invoice-facts-route.ts)
  // and every real stage visit, both of which hold genuine line facts.
  const poMerged = await mergePoMatchFacts(db, merged as InvoiceFacts, [], { invoiceId });
  const verdict = validateInvoiceFacts(
    poMerged.headerFacts,
    lines.results as never,
    // The platform tolerance, not the channel's. Keying knows the
    // invoice and not the channel it arrived through, and this verdict
    // is advisory — the authoritative one is recorded at the next stage
    // visit, under the channel's own settings (decision 0057).
    undefined
  );

  /**
   * The `account_coding` check, added here rather than inside the call
   * above — decision 0511. `lines.results` is raw rows (see above), so
   * it is parsed for this one check only, rather than changing what
   * every other check on this path reads. Without it a line still
   * carrying a supplier's invalid BT-133 would lose its marker the
   * moment somebody saved an unrelated change.
   */
  const codingLines = await mergeCodingValidityFacts(
    db,
    invoiceUnitId,
    lines.results.map((row) => {
      let facts: Record<string, unknown> = {};
      try {
        facts = JSON.parse(String(row.facts_json ?? "{}")) as Record<string, unknown>;
      } catch {
        // No facts to check.
      }
      const lineNumber = Number(row.line_number);
      return {
        ...facts,
        lineNumber,
        ...(nonPo.has(lineNumber) ? { "po.line_non_po": true } : {}),
      } as InvoiceFacts & { lineNumber: number };
    }),
    { poInvoice, splits: await loadSplits(db, invoiceId) }
  );
  const coding = accountCodingFailures(codingLines);
  if (coding.checked) verdict.checked.push("account_coding");
  if (coding.failures.length > 0) {
    verdict.failures.push("account_coding");
    verdict.passed = false;
    verdict.involves = [...(verdict.involves ?? []), ...coding.failures];
  }

  // Decision 0711 — the invoice number's duplicate check, from the score stored on save.
  {
    const scored = await db.prepare("SELECT duplicate_confidence FROM invoice_headers WHERE id = ?").bind(invoiceId).first<{ duplicate_confidence: number | null }>();
    const duplicate = duplicateVerdict(scored?.duplicate_confidence, POSSIBLE_DUPLICATE_THRESHOLD);
    if (scored?.duplicate_confidence != null) verdict.checked.push("duplicate");
    if (duplicate.confirms.length > 0) verdict.confirms = [...(verdict.confirms ?? []), ...duplicate.confirms];
    if (duplicate.involves.length > 0) verdict.involves = [...(verdict.involves ?? []), ...duplicate.involves];
  }

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
      validation: {
        passed: verdict.passed,
        checked: verdict.checked,
        failures: verdict.failures,
        // **Which fields, and which codes** — decision 0119. This block
        // is assembled field by field rather than spread, which is why
        // `involves` was missing when the panel was built: the
        // validator gained it and this did not.
        //
        // Named explicitly all the same. A spread would carry whatever
        // the validator happens to return, including things a caller
        // has no business seeing.
        ...(verdict.involves ? { involves: verdict.involves } : {}),
        ...(verdict.invalidCodes ? { invalidCodes: verdict.invalidCodes } : {}),
        // decision 0400's green tier, named explicitly for the same
        // reason involves/invalidCodes are just above.
        ...(verdict.confirms ? { confirms: verdict.confirms } : {}),
        // Said plainly rather than left to be assumed: this is a report
        // on the facts as they now stand, not a verdict recorded against
        // the process instance.
        advisory: true,
      },
    },
  };
}

/**
 * The fields a stage permits editing — decision 0144.
 *
 * `null` where no stage was given, meaning unrestricted: an inline
 * harness and every caller that predates this behave as they did.
 */
/**
 * @param unitId which unit the document belongs to — decision 0197.
 *
 * **This is the enforcing caller.** A unit's override that the screen
 * honours and the route ignores is decision 0144's fault repeated: the
 * screen was the only guard, and a `curl` could always write a
 * read-only field.
 */
async function editableFieldsAt(
  db: D1Database,
  stageId: string,
  unitId: string | null
): Promise<Set<string>> {
  const fields = await resolveFieldVisibility(db, stageId, unitId);
  return new Set(fields.filter((f) => f.visibility === "edit").map((f) => f.field));
}
