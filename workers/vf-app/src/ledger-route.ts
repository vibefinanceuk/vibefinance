import type { RouteResult } from "./org-route.js";

/**
 * The accounting frame — decision 0195.
 *
 * Decision 0194 found the one thing both Oracle and SAP have that this
 * project did not: a **ledger** (Oracle) or **controlling area** (SAP)
 * — a chart of accounts and a fiscal calendar, to which legal entities
 * are assigned, one or many.
 *
 * **A cost centre belongs to it, not to a company.** Which is why one
 * may be charged by several entities that share a chart of accounts,
 * and why decision 0031 was right to keep `BT-133` apart from
 * `org_units`.
 */

interface LedgerRow {
  id: string;
  name: string;
  chart_of_accounts: string;
  currency: string;
  fiscal_year_start_month: number;
  entities: number;
}

export async function handleListLedgers(db: D1Database): Promise<RouteResult> {
  const rows = await db
    .prepare(
      `SELECT l.id, l.name, l.chart_of_accounts, l.currency,
              l.fiscal_year_start_month,
              (SELECT count(*) FROM org_units u WHERE u.ledger_id = l.id) AS entities
       FROM ledgers l ORDER BY l.name`
    )
    .all<LedgerRow>();

  return {
    status: 200,
    body: {
      ledgers: rows.results.map((row) => ({
        id: row.id,
        name: row.name,
        chartOfAccounts: row.chart_of_accounts,
        currency: row.currency,
        fiscalYearStartMonth: row.fiscal_year_start_month,
        /**
         * **How many legal entities account here.** A ledger serving
         * none is configured and unused; one serving several is doing
         * the job it exists for, and a person setting up a group needs
         * to see which.
         */
        entities: row.entities,
      })),
    },
  };
}

export async function handleCreateLedger(
  db: D1Database,
  body: Record<string, unknown>
): Promise<RouteResult> {
  const { id, name, chartOfAccounts, currency } = body;
  const month = body.fiscalYearStartMonth ?? 1;

  if (
    typeof id !== "string" ||
    !id ||
    typeof name !== "string" ||
    !name ||
    typeof chartOfAccounts !== "string" ||
    !chartOfAccounts ||
    typeof currency !== "string" ||
    !currency
  ) {
    return {
      status: 400,
      body: { error: "id, name, chartOfAccounts and currency (all strings) are required" },
    };
  }

  if (typeof month !== "number" || month < 1 || month > 12) {
    // **A fiscal year starts in a month.** A UK company closing in
    // April and a French one closing in December cannot share a ledger,
    // and this is the field that says so.
    return { status: 400, body: { error: "fiscalYearStartMonth must be 1–12" } };
  }

  const existing = await db
    .prepare("SELECT id FROM ledgers WHERE id = ? OR name = ?")
    .bind(id, name)
    .first();
  if (existing) {
    return { status: 409, body: { error: `a ledger with that id or name already exists` } };
  }

  await db
    .prepare(
      `INSERT INTO ledgers (id, name, chart_of_accounts, currency, fiscal_year_start_month)
       VALUES (?, ?, ?, ?, ?)`
    )
    .bind(id, name, chartOfAccounts, currency, month)
    .run();

  return { status: 201, body: { id, name } };
}

/**
 * Which ledger a legal entity accounts in.
 *
 * **Only a legal entity.** An operating unit processes transactions and
 * does not account for itself — decision 0036's split, and Oracle's own
 * rule that a business unit posts to a ledger *through* its entity.
 * Migration 0044 enforces this permanently; this refuses it with an
 * explanation rather than a constraint error.
 */
export async function handleAssignLedger(
  db: D1Database,
  unitId: string,
  body: Record<string, unknown>
): Promise<RouteResult> {
  const ledgerId = body.ledgerId;
  if (ledgerId !== null && typeof ledgerId !== "string") {
    return { status: 400, body: { error: "ledgerId must be a string, or null to clear it" } };
  }

  const unit = await db
    .prepare("SELECT id, kind FROM org_units WHERE id = ?")
    .bind(unitId)
    .first<{ id: string; kind: string }>();
  if (!unit) return { status: 404, body: { error: `unit ${unitId} does not exist` } };

  if (unit.kind !== "legal_entity") {
    return {
      status: 409,
      body: {
        error: "only a legal entity accounts in a ledger",
        reason: "not_a_legal_entity",
      },
    };
  }

  if (ledgerId !== null) {
    const ledger = await db.prepare("SELECT id FROM ledgers WHERE id = ?").bind(ledgerId).first();
    if (!ledger) return { status: 404, body: { error: `ledger ${ledgerId} does not exist` } };
  }

  await db
    .prepare("UPDATE org_units SET ledger_id = ? WHERE id = ?")
    .bind(ledgerId, unitId)
    .run();

  return { status: 200, body: { unitId, ledgerId } };
}

/**
 * A cost centre's place in the frame — decision 0195.
 *
 * Its ledger, its parent, its owner and that owner's limit. Decision
 * 0184's *default approver*: **"each cost object has a pre-assigned
 * owner responsible for charges hitting their budget."**
 */
export async function handleUpdateCostCentre(
  db: D1Database,
  costCentreId: string,
  body: Record<string, unknown>
): Promise<RouteResult> {
  const existing = await db
    .prepare("SELECT id, ledger_id FROM cost_centres WHERE id = ?")
    .bind(costCentreId)
    .first<{ id: string; ledger_id: string | null }>();
  if (!existing) {
    return { status: 404, body: { error: `cost centre ${costCentreId} does not exist` } };
  }

  const ledgerId = "ledgerId" in body ? body.ledgerId : existing.ledger_id;
  const parentId = "parentCostCentreId" in body ? body.parentCostCentreId : undefined;
  const ownerId = "ownerUserId" in body ? body.ownerUserId : undefined;
  const limit = "approvalLimit" in body ? body.approvalLimit : undefined;

  if (parentId === costCentreId) {
    // A cycle would make escalation loop forever, and the cheapest one
    // to make is a cost centre pointing at itself.
    return { status: 409, body: { error: "a cost centre cannot be its own parent" } };
  }

  if (typeof parentId === "string") {
    const parent = await db
      .prepare("SELECT id, ledger_id FROM cost_centres WHERE id = ?")
      .bind(parentId)
      .first<{ id: string; ledger_id: string | null }>();
    if (!parent) return { status: 404, body: { error: `cost centre ${parentId} does not exist` } };

    if (parent.ledger_id !== ledgerId) {
      /**
       * **A tree crossing charts of accounts is a tree whose totals
       * mean nothing.** SAP's rule that every company in a controlling
       * area shares one chart of accounts is the same argument, one
       * level down.
       */
      return {
        status: 409,
        body: {
          error: "a cost centre's parent must be in the same ledger",
          reason: "different_ledger",
        },
      };
    }
  }

  if (limit !== undefined && limit !== null) {
    if (typeof limit !== "number" || limit < 0) {
      return { status: 400, body: { error: "approvalLimit must be a number of 0 or more" } };
    }

    const owner = ownerId !== undefined ? ownerId : null;
    if (!owner) {
      // **A limit with no owner is a number nobody can act on.**
      return {
        status: 409,
        body: { error: "an approval limit needs an owner", reason: "limit_without_owner" },
      };
    }
  }

  const sets: string[] = [];
  const values: unknown[] = [];
  if ("ledgerId" in body) {
    sets.push("ledger_id = ?");
    values.push(ledgerId);
  }
  if (parentId !== undefined) {
    sets.push("parent_cost_centre_id = ?");
    values.push(parentId);
  }
  if (ownerId !== undefined) {
    sets.push("owner_user_id = ?");
    values.push(ownerId);
  }
  if (limit !== undefined) {
    sets.push("approval_limit = ?");
    values.push(limit);
  }

  if (sets.length === 0) return { status: 400, body: { error: "nothing to change" } };

  await db
    .prepare(`UPDATE cost_centres SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...values, costCentreId)
    .run();

  return { status: 200, body: { id: costCentreId } };
}

/**
 * Who approves what is charged here, and up to how much — decision
 * 0195.
 *
 * **The chain decision 0184 describes**, walked once so nothing else
 * has to. Start at the cost centre; climb to its parent while nobody's
 * limit covers the amount; stop at the first owner whose does.
 *
 * This is *Limit* mode. **Level** — every rung signs, regardless of
 * amount — is not built, and decision 0184 records that a step is one
 * or the other, never both.
 */
export async function resolveApprovalChain(
  db: D1Database,
  costCentreId: string,
  amount: number
): Promise<{ chain: { costCentreId: string; ownerUserId: string; limit: number | null }[]; covered: boolean }> {
  const chain: { costCentreId: string; ownerUserId: string; limit: number | null }[] = [];
  const seen = new Set<string>();

  let current: string | null = costCentreId;

  while (current && !seen.has(current)) {
    seen.add(current);

    const row: { id: string; owner_user_id: string | null; approval_limit: number | null; parent_cost_centre_id: string | null } | null =
      await db
        .prepare(
          `SELECT id, owner_user_id, approval_limit, parent_cost_centre_id
           FROM cost_centres WHERE id = ?`
        )
        .bind(current)
        .first();

    if (!row) break;

    if (row.owner_user_id) {
      chain.push({
        costCentreId: row.id,
        ownerUserId: row.owner_user_id,
        limit: row.approval_limit,
      });

      /**
       * **A null limit approves anything.** Decision 0184's escalation
       * happens when an amount *exceeds* a threshold, and an owner with
       * no threshold has none to exceed — which is how a group CFO at
       * the top of a chain is configured.
       */
      if (row.approval_limit === null || amount <= row.approval_limit) {
        return { chain, covered: true };
      }
    }

    // A cost centre with no owner escalates immediately, which is a
    // real configuration rather than a broken one.
    current = row.parent_cost_centre_id;
  }

  /**
   * **The chain ran out with the amount uncovered**, which decision
   * 0184 recorded as undecided and this reports rather than resolves.
   * The caller sees who was asked and that nobody could approve it.
   */
  return { chain, covered: false };
}
