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
        body: {
          error: `an operating unit sits under a legal entity, and ${parentUnitId} is ${kindInWords(parent.kind)}`,
        },
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

/**
 * **Everything a role-management screen needs, in one call** —
 * decision 0319, the same reasoning decision 0240's own dashboard
 * already gives for reading every card's data at once: computed once
 * rather than four or five round trips for one screen.
 *
 * **Read-only, deliberately the first half.** Every write this data
 * needs — assigning a role, revoking one, setting a limit — already
 * exists as its own route; this adds only the ability to see the
 * result of them, which today requires reading the database directly.
 *
 * **Scoped for a delegated administrator, decision 0321** — the exact
 * gap decision 0201 itself named: *"'AP Manager (France)' is a
 * pairing nobody can see listed."* Decision 0319 closed that only for
 * an instance administrator (`Admin.Configure`); this closes it for
 * the delegated one that decision was written for. `null` means no
 * restriction — an instance administrator, or a person holding
 * `Admin.UserManagement` unscoped. A real list mirrors exactly what
 * `handleAssignRole` already lets the same person grant: units at or
 * beneath what they administer, and assignments *at* one of those
 * units specifically — never an unscoped ("everywhere") assignment,
 * the same `cannot_grant_everywhere` refusal that route already
 * enforces for granting one.
 *
 * **Roles themselves are never scoped.** A role's own name and the
 * permissions it grants are a global definition, not a fact about any
 * person or any org — showing "AP Manager: AP.Approve, AP.Review" to
 * a delegated administrator reveals nothing about who holds it or
 * where.
 */
export async function handleGetOrgOverview(
  db: D1Database,
  scopeUnits: string[] | null = null
): Promise<RouteResult> {
  const unitPlaceholders = scopeUnits ? scopeUnits.map(() => "?").join(", ") : "";

  const units = await db
    .prepare(
      `SELECT id, name, kind, parent_unit_id FROM org_units
       ${scopeUnits ? `WHERE id IN (${unitPlaceholders})` : ""}
       ORDER BY kind DESC, name ASC`
    )
    .bind(...(scopeUnits ?? []))
    .all<{ id: string; name: string; kind: string; parent_unit_id: string | null }>();

  const assignments = await db
    .prepare(
      `SELECT ur.user_id, u.name AS user_name, ur.role_id, r.name AS role_name,
              ur.unit_id, un.name AS unit_name, ur.granted_at
       FROM org_user_roles ur
       JOIN org_users u ON u.id = ur.user_id
       JOIN org_roles r ON r.id = ur.role_id
       LEFT JOIN org_units un ON un.id = ur.unit_id
       ${scopeUnits ? `WHERE ur.unit_id IN (${unitPlaceholders})` : ""}
       ORDER BY u.name ASC, r.name ASC`
    )
    .bind(...(scopeUnits ?? []))
    .all<{
      user_id: string;
      user_name: string;
      role_id: string;
      role_name: string;
      unit_id: string | null;
      unit_name: string | null;
      granted_at: string;
    }>();

  /**
   * **A person is in scope by either door** — holding a scoped
   * assignment, or having their own home unit within it. A delegated
   * administrator naming a colleague nobody has assigned a role to
   * yet is exactly the case a "who is here, unassigned" view exists
   * for.
   */
  const users = await db
    .prepare(
      `SELECT id, email, name, unit_id, status FROM org_users
       ${
         scopeUnits
           ? `WHERE unit_id IN (${unitPlaceholders})
              OR id IN (SELECT user_id FROM org_user_roles WHERE unit_id IN (${unitPlaceholders}))`
           : ""
       }
       ORDER BY name ASC`
    )
    .bind(...(scopeUnits ?? []), ...(scopeUnits ?? []))
    .all<{ id: string; email: string; name: string; unit_id: string | null; status: string }>();

  const roles = await db
    .prepare(`SELECT id, name, permissions_json FROM org_roles ORDER BY name ASC`)
    .all<{ id: string; name: string; permissions_json: string }>();

  const scopedUserIds = users.results.map((u) => u.id);
  const limitPlaceholders = scopeUnits ? scopedUserIds.map(() => "?").join(", ") : "";

  const authorityLimits = await db
    .prepare(
      `SELECT al.user_id, u.name AS user_name, al.currency, al.max_amount
       FROM org_authority_limits al
       JOIN org_users u ON u.id = al.user_id
       ${scopeUnits ? `WHERE al.user_id IN (${limitPlaceholders})` : ""}
       ORDER BY u.name ASC, al.currency ASC`
    )
    .bind(...(scopeUnits ? scopedUserIds : []))
    .all<{ user_id: string; user_name: string; currency: string; max_amount: number }>();

  return {
    status: 200,
    body: {
      units: units.results.map((r) => ({ id: r.id, name: r.name, kind: r.kind, parentUnitId: r.parent_unit_id })),
      users: users.results.map((r) => ({
        id: r.id,
        email: r.email,
        name: r.name,
        unitId: r.unit_id,
        status: r.status,
      })),
      roles: roles.results.map((r) => {
        let permissions: string[] = [];
        try {
          permissions = JSON.parse(r.permissions_json) as string[];
        } catch {
          // A role with unparseable permissions is shown as granting
          // nothing, the same fallback enforce.ts's own permissionsFor
          // already uses — one bad row must not break the whole screen.
        }
        return { id: r.id, name: r.name, permissions };
      }),
      assignments: assignments.results.map((r) => ({
        userId: r.user_id,
        userName: r.user_name,
        roleId: r.role_id,
        roleName: r.role_name,
        unitId: r.unit_id,
        unitName: r.unit_name,
        grantedAt: r.granted_at,
      })),
      authorityLimits: authorityLimits.results.map((r) => ({
        userId: r.user_id,
        userName: r.user_name,
        currency: r.currency,
        maxAmount: r.max_amount,
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

export async function handleAssignRole(
  db: D1Database,
  userId: string,
  roleId: unknown,
  /**
   * Where the role is to be held — decision 0201. Null means
   * everywhere, which is every assignment predating decision 0199.
   */
  unitId: string | null = null,
  /**
   * Which units the person **doing the assigning** administers.
   *
   * `null` means everywhere — an administrator with `Admin.Users` held
   * unscoped, and every customer not using units. Passing it is how a
   * route says *"this is a delegated administrator"*.
   */
  granterUnits: string[] | null = null
): Promise<RouteResult> {
  if (typeof roleId !== "string" || !roleId) {
    return { status: 400, body: { error: "roleId (string) is required" } };
  }

  /**
   * **A France administrator may not grant beyond France** — decision
   * 0201.
   *
   * The operator's requirement is that *AP Manager (France)* has
   * *"user–role allocation permissions for the France org"*. The
   * dangerous half is the other direction: granting a role **everywhere**
   * would hand somebody more than the granter holds, and granting it in
   * Germany would reach outside their own org.
   *
   * Both are privilege escalation by a route being helpful, and both
   * are refused. A delegated administrator may grant only **at or
   * below** what they administer.
   */
  if (granterUnits !== null) {
    if (unitId === null) {
      return {
        status: 403,
        body: {
          error: "you may only assign a role within an org you administer",
          reason: "cannot_grant_everywhere",
        },
      };
    }

    if (!granterUnits.includes(unitId)) {
      return {
        status: 403,
        body: {
          error: `you do not administer ${unitId}`,
          reason: "outside_administered_units",
        },
      };
    }
  }

  if (unitId !== null) {
    const unitExists = await db
      .prepare("SELECT id FROM org_units WHERE id = ?")
      .bind(unitId)
      .first();
    if (!unitExists) {
      return { status: 404, body: { error: `unit ${unitId} does not exist` } };
    }
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
    /**
     * **Per place, since decision 0199.** This asked whether the person
     * held the role *at all*, which was the same question until a role
     * could be held somewhere — and now wrongly refuses somebody
     * holding *AP Clerk* in France from also holding it in Germany.
     */
    .prepare(
      `SELECT 1 FROM org_user_roles
       WHERE user_id = ? AND role_id = ?
         AND ((unit_id IS NULL AND ?3 IS NULL) OR unit_id = ?3)`
    )
    .bind(userId, roleId, unitId)
    .first();
  if (alreadyAssigned) {
    return { status: 409, body: { error: `user ${userId} already has role ${roleId}` } };
  }

  /**
   * **Holding it everywhere already covers holding it in France**, and
   * a scoped row beside an unscoped one would read as a restriction it
   * is not — which migration 0047 refuses as a standing invariant.
   */
  const alreadyEverywhere = await db
    .prepare(
      "SELECT 1 FROM org_user_roles WHERE user_id = ? AND role_id = ? AND unit_id IS NULL"
    )
    .bind(userId, roleId)
    .first();

  if (alreadyEverywhere && unitId !== null) {
    return {
      status: 409,
      body: {
        error: "this person already holds that role everywhere",
        reason: "already_held_everywhere",
      },
    };
  }

  await db
    .prepare("INSERT OR IGNORE INTO org_user_roles (user_id, role_id, unit_id) VALUES (?, ?, ?)")
    .bind(userId, roleId, unitId)
    .run();

  return { status: 201, body: { userId, roleId, unitId } };
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
 * What a unit is, in words rather than in the enum's own spelling.
 *
 * A message a customer reads should not expose `operating_unit`, and
 * "a operating_unit" was a real message this returned.
 */
function kindInWords(kind: string): string {
  return kind === "legal_entity" ? "a legal entity" : "an operating unit";
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
      body: {
        error: `${orgUnitId} is ${kindInWords(unit.kind)}, and an invoice is assigned to an operating unit`,
      },
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
