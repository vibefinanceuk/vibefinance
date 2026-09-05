import { isKnownInvoiceProfile, isKnownR2Jurisdiction, R2_JURISDICTIONS } from "./profiles.js";
import { isKnownPermissionList } from "./permissions.js";
import { generateApiKey, hashApiKey } from "./user-auth.js";

export interface RouteResult {
  status: number;
  body: Record<string, unknown>;
}

/**
 * Minimal CRUD for the org/authority/profiles subsystem — see
 * docs/decisions/0009-org-authority-profiles.md. Deliberately no
 * authentication, no session, no permission enforcement anywhere in
 * this file: these routes create the data a future bundle would
 * check against, not check it themselves yet. Matches the same
 * "raw API for now, no admin UI" precedent already established for
 * vf-licence's customers/licences endpoints.
 */

interface CreateUnitBody {
  id?: unknown;
  name?: unknown;
  parentUnitId?: unknown;
  /** What this unit is — decision 0111. Defaults to an operating unit. */
  kind?: unknown;
  /** BT-49, the buyer electronic address Peppol routes on. */
  buyerEndpoint?: unknown;
  /** BT-48, the buyer VAT identifier. */
  vatId?: unknown;
  /** BT-10, the buyer own routing reference. */
  buyerReference?: unknown;
}

export async function handleCreateUnit(db: D1Database, body: CreateUnitBody): Promise<RouteResult> {
  const { id, name, parentUnitId, kind, buyerEndpoint, vatId, buyerReference } = body;
  if (typeof id !== "string" || !id || typeof name !== "string" || !name) {
    return { status: 400, body: { error: "id and name (both strings) are required" } };
  }
  if (parentUnitId !== undefined && typeof parentUnitId !== "string") {
    return { status: 400, body: { error: "parentUnitId, if provided, must be a string" } };
  }

  const existing = await db.prepare("SELECT id FROM org_units WHERE id = ?").bind(id).first();
  if (existing) {
    return { status: 409, body: { error: `unit ${id} already exists` } };
  }

  if (parentUnitId) {
    const parentExists = await db.prepare("SELECT id FROM org_units WHERE id = ?").bind(parentUnitId).first();
    if (!parentExists) {
      return { status: 404, body: { error: `parent unit ${parentUnitId as string} does not exist` } };
    }
  }

  /**
   * What this unit **is** — decision 0111.
   *
   * A legal entity is a tax and reporting boundary; an operating unit
   * is where payables happen and where an invoice is assigned. Defaults
   * to `operating_unit`, because that is what every unit created before
   * this existed was implicitly being used as.
   */
  const unitKind = kind === undefined ? "operating_unit" : kind;
  if (unitKind !== "legal_entity" && unitKind !== "operating_unit") {
    return {
      status: 422,
      body: { error: "kind must be 'legal_entity' or 'operating_unit'" },
    };
  }

  if (parentUnitId && unitKind === "operating_unit") {
    // A hierarchy that nests arbitrarily is one nobody can reason
    // about. Checked here so the caller gets a reason; a standing
    // invariant refuses it either way.
    const parent = await db
      .prepare("SELECT kind FROM org_units WHERE id = ?")
      .bind(parentUnitId)
      .first<{ kind: string }>();
    if (parent && parent.kind !== "legal_entity") {
      return {
        status: 422,
        body: { error: `an operating unit sits under a legal entity, and ${parentUnitId} is a ${parent.kind}` },
      };
    }
  }

  /**
   * The identifiers an arriving invoice can be matched against, each
   * named as the standard names it. **BT-49 is what Peppol itself
   * routes on** — the buyer's electronic address.
   */
  for (const [label, value] of [
    ["buyerEndpoint", buyerEndpoint],
    ["vatId", vatId],
    ["buyerReference", buyerReference],
  ] as const) {
    if (value !== undefined && (typeof value !== "string" || value.trim() === "")) {
      return { status: 422, body: { error: `${label}, if provided, must be a non-empty string` } };
    }
  }

  await db
    .prepare(
      "INSERT INTO org_units (id, name, parent_unit_id, kind, buyer_endpoint, vat_id, buyer_reference) VALUES (?, ?, ?, ?, ?, ?, ?)"
    )
    .bind(
      id,
      name,
      parentUnitId ?? null,
      unitKind,
      (buyerEndpoint as string) ?? null,
      (vatId as string) ?? null,
      (buyerReference as string) ?? null
    )
    .run();

  return {
    status: 201,
    body: {
      id,
      name,
      parentUnitId: parentUnitId ?? null,
      kind: unitKind,
      buyerEndpoint: buyerEndpoint ?? null,
      vatId: vatId ?? null,
      buyerReference: buyerReference ?? null,
    },
  };
}

/**
 * Every org unit, with what an invoice can be matched against —
 * decision 0111.
 *
 * **Nothing could read them before.** Units could be created and never
 * listed, which made a customer writing an `assign_org` rule guess at
 * the id they were naming.
 */
export async function handleListUnits(db: D1Database): Promise<RouteResult> {
  const rows = await db
    .prepare(
      `SELECT id, name, kind, parent_unit_id, buyer_endpoint, vat_id, buyer_reference
       FROM org_units ORDER BY kind DESC, name ASC`
    )
    .all<{
      id: string;
      name: string;
      kind: string;
      parent_unit_id: string | null;
      buyer_endpoint: string | null;
      vat_id: string | null;
      buyer_reference: string | null;
    }>();

  return {
    status: 200,
    body: {
      units: rows.results.map((r) => ({
        id: r.id,
        name: r.name,
        kind: r.kind,
        parentUnitId: r.parent_unit_id,
        buyerEndpoint: r.buyer_endpoint,
        vatId: r.vat_id,
        buyerReference: r.buyer_reference,
      })),
    },
  };
}

interface CreateUserBody {
  id?: unknown;
  email?: unknown;
  name?: unknown;
  unitId?: unknown;
  locale?: unknown;
}

export async function handleCreateUser(db: D1Database, body: CreateUserBody): Promise<RouteResult> {
  const { id, email, name, unitId, locale } = body;
  if (typeof id !== "string" || !id || typeof email !== "string" || !email || typeof name !== "string" || !name) {
    return { status: 400, body: { error: "id, email and name (all strings) are required" } };
  }
  if (unitId !== undefined && typeof unitId !== "string") {
    return { status: 400, body: { error: "unitId, if provided, must be a string" } };
  }
  if (locale !== undefined && typeof locale !== "string") {
    return { status: 400, body: { error: "locale, if provided, must be a string" } };
  }

  const existingId = await db.prepare("SELECT id FROM org_users WHERE id = ?").bind(id).first();
  if (existingId) {
    return { status: 409, body: { error: `user ${id} already exists` } };
  }
  const existingEmail = await db.prepare("SELECT id FROM org_users WHERE email = ?").bind(email).first();
  if (existingEmail) {
    return { status: 409, body: { error: `a user with email ${email} already exists` } };
  }

  if (unitId) {
    const unitExists = await db.prepare("SELECT id FROM org_units WHERE id = ?").bind(unitId).first();
    if (!unitExists) {
      return { status: 404, body: { error: `unit ${unitId as string} does not exist` } };
    }
  }

  // The plaintext key exists only in this response — only its hash is
  // ever stored, from this point on. Same discipline as
  // vf-licence's customer keys (docs/decisions/0006-endpoint-
  // authentication.md): if it's lost, the fix is rotating it
  // (POST /org/users/:id/rotate-key), never recovering it.
  const apiKey = generateApiKey();
  const apiKeyHash = await hashApiKey(apiKey);

  await db
    .prepare("INSERT INTO org_users (id, email, name, unit_id, locale, api_key_hash) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(id, email, name, unitId ?? null, locale ?? null, apiKeyHash)
    .run();

  return {
    status: 201,
    body: { id, email, name, unitId: unitId ?? null, locale: locale ?? null, status: "active", apiKey },
  };
}

interface CreateRoleBody {
  id?: unknown;
  name?: unknown;
  permissions?: unknown;
}

export async function handleCreateRole(db: D1Database, body: CreateRoleBody): Promise<RouteResult> {
  const { id, name, permissions } = body;
  if (typeof id !== "string" || !id || typeof name !== "string" || !name) {
    return { status: 400, body: { error: "id and name (both strings) are required" } };
  }
  const permissionList = permissions ?? [];
  // Refusal as a first-class output, the same discipline the rule
  // interpreter's own closed vocabulary already follows: a role that
  // asks for a permission outside the known list is rejected outright,
  // never silently dropped or silently stored as free text.
  if (!isKnownPermissionList(permissionList)) {
    return {
      status: 422,
      body: { error: "one or more permissions are not in the closed permission vocabulary" },
    };
  }

  const existing = await db.prepare("SELECT id FROM org_roles WHERE id = ?").bind(id).first();
  if (existing) {
    return { status: 409, body: { error: `role ${id} already exists` } };
  }

  await db
    .prepare("INSERT INTO org_roles (id, name, permissions_json) VALUES (?, ?, ?)")
    .bind(id, name, JSON.stringify(permissionList))
    .run();

  return { status: 201, body: { id, name, permissions: permissionList } };
}

export async function handleAssignRole(db: D1Database, userId: string, roleId: unknown): Promise<RouteResult> {
  if (typeof roleId !== "string" || !roleId) {
    return { status: 400, body: { error: "roleId (string) is required" } };
  }

  const userExists = await db.prepare("SELECT id FROM org_users WHERE id = ?").bind(userId).first();
  if (!userExists) {
    return { status: 404, body: { error: `user ${userId} does not exist` } };
  }
  const roleExists = await db.prepare("SELECT id FROM org_roles WHERE id = ?").bind(roleId).first();
  if (!roleExists) {
    return { status: 404, body: { error: `role ${roleId} does not exist` } };
  }

  const alreadyAssigned = await db
    .prepare("SELECT 1 FROM org_user_roles WHERE user_id = ? AND role_id = ?")
    .bind(userId, roleId)
    .first();
  if (alreadyAssigned) {
    return { status: 409, body: { error: `user ${userId} already has role ${roleId}` } };
  }

  await db.prepare("INSERT INTO org_user_roles (user_id, role_id) VALUES (?, ?)").bind(userId, roleId).run();

  return { status: 201, body: { userId, roleId } };
}

interface SetAuthorityLimitBody {
  currency?: unknown;
  maxAmount?: unknown;
}

/**
 * Upsert, not insert-only: an authority limit for a user/currency pair
 * is meant to be revised over time (a promotion, a policy change) —
 * matches usage_periods' own idempotent-upsert precedent
 * (docs/decisions/0004-usage-telemetry.md), here for the same reason:
 * the composite key IS the identity, so setting it again is a
 * correction, not a duplicate.
 */
export async function handleSetAuthorityLimit(
  db: D1Database,
  userId: string,
  body: SetAuthorityLimitBody
): Promise<RouteResult> {
  const { currency, maxAmount } = body;
  if (typeof currency !== "string" || !currency || typeof maxAmount !== "number") {
    return { status: 400, body: { error: "currency (string) and maxAmount (number) are required" } };
  }
  if (maxAmount < 0) {
    return { status: 400, body: { error: "maxAmount must not be negative" } };
  }

  const userExists = await db.prepare("SELECT id FROM org_users WHERE id = ?").bind(userId).first();
  if (!userExists) {
    return { status: 404, body: { error: `user ${userId} does not exist` } };
  }

  await db
    .prepare(
      `INSERT INTO org_authority_limits (user_id, currency, max_amount) VALUES (?, ?, ?)
       ON CONFLICT(user_id, currency) DO UPDATE SET max_amount = excluded.max_amount`
    )
    .bind(userId, currency, maxAmount)
    .run();

  return { status: 200, body: { userId, currency, maxAmount } };
}

interface SetProfileBody {
  id?: unknown;
  ciusProfile?: unknown;
  unitId?: unknown;
  r2Jurisdiction?: unknown;
}

/**
 * r2Jurisdiction (decision 0033) — optional, closed to R2_JURISDICTIONS
 * ('eu' | 'fedramp' | 'us') or omitted entirely for unspecified/
 * automatic. Deliberately not enforced as immutable here: nothing
 * yet actually creates a real R2 bucket against this value (decision
 * 0013's own R2 retention design remains unbuilt), so there is no
 * real bucket-creation event to key an immutability check against
 * yet. Cloudflare's own R2 jurisdiction, once a bucket actually
 * exists, cannot be changed — a future bucket-creation implementation
 * will need its own precondition check once that piece is built,
 * this column alone does not yet enforce it.
 */
export async function handleSetProfile(db: D1Database, body: SetProfileBody): Promise<RouteResult> {
  const { id, ciusProfile, unitId, r2Jurisdiction } = body;
  if (typeof id !== "string" || !id) {
    return { status: 400, body: { error: "id (string) is required" } };
  }
  if (r2Jurisdiction !== undefined && !isKnownR2Jurisdiction(r2Jurisdiction)) {
    return {
      status: 422,
      body: { error: `${String(r2Jurisdiction)} is not a supported R2 jurisdiction (supported: ${R2_JURISDICTIONS.join(", ")})` },
    };
  }
  if (!isKnownInvoiceProfile(ciusProfile)) {
    return { status: 422, body: { error: `${String(ciusProfile)} is not a known CIUS profile` } };
  }
  if (unitId !== undefined && typeof unitId !== "string") {
    return { status: 400, body: { error: "unitId, if provided, must be a string" } };
  }

  const existing = await db.prepare("SELECT id FROM org_profiles WHERE id = ?").bind(id).first();
  if (existing) {
    return { status: 409, body: { error: `profile ${id} already exists` } };
  }

  if (unitId) {
    const unitExists = await db.prepare("SELECT id FROM org_units WHERE id = ?").bind(unitId).first();
    if (!unitExists) {
      return { status: 404, body: { error: `unit ${unitId as string} does not exist` } };
    }
  }

  await db
    .prepare("INSERT INTO org_profiles (id, cius_profile, unit_id, r2_jurisdiction) VALUES (?, ?, ?, ?)")
    .bind(id, ciusProfile, unitId ?? null, (r2Jurisdiction as string) ?? null)
    .run();

  return { status: 201, body: { id, ciusProfile, unitId: unitId ?? null, r2Jurisdiction: r2Jurisdiction ?? null } };
}

/**
 * Placing an invoice by hand — decision 0111.
 *
 * The third way an invoice acquires an org, after a rule and a source
 * default. `org_assigned_by` has always had `'manual'` in its `CHECK`
 * and **nothing could produce it** — a value declared and unreachable,
 * which is this project's most frequent finding.
 *
 * This is what a person does when a document arrives that no rule
 * placed and no source defaulted: decision 0111 makes that a task
 * rather than a silent default, and this is how the task is discharged.
 */
export async function handlePlaceInvoice(
  db: D1Database,
  invoiceId: string,
  orgUnitId: unknown
): Promise<RouteResult> {
  if (typeof orgUnitId !== "string" || orgUnitId.trim() === "") {
    return { status: 400, body: { error: "orgUnitId (a string) is required" } };
  }

  const invoice = await db
    .prepare("SELECT id, org_unit_id, org_assigned_by FROM invoice_headers WHERE id = ?")
    .bind(invoiceId)
    .first<{ id: string; org_unit_id: string | null; org_assigned_by: string | null }>();
  if (!invoice) {
    return { status: 404, body: { error: `invoice ${invoiceId} does not exist` } };
  }

  const unit = await db
    .prepare("SELECT id, kind FROM org_units WHERE id = ?")
    .bind(orgUnitId)
    .first<{ id: string; kind: string }>();
  if (!unit) {
    return { status: 404, body: { error: `org unit ${orgUnitId} does not exist` } };
  }
  if (unit.kind !== "operating_unit") {
    // A legal entity is a tax and reporting boundary; payables happen
    // in the operating unit. A standing invariant refuses this too.
    return {
      status: 422,
      body: { error: `${orgUnitId} is a ${unit.kind}, and an invoice is assigned to an operating unit` },
    };
  }

  await db
    .prepare("UPDATE invoice_headers SET org_unit_id = ?, org_assigned_by = 'manual' WHERE id = ?")
    .bind(orgUnitId, invoiceId)
    .run();

  return {
    status: 200,
    body: {
      invoiceId,
      orgUnitId,
      assignedBy: "manual",
      // What it was before, so a person overriding a rule can see they
      // did — and so an audit can tell a correction from a placement.
      previousOrgUnitId: invoice.org_unit_id,
      previousAssignedBy: invoice.org_assigned_by,
    },
  };
}
