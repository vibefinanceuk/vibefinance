import { isKnownCiusProfile } from "./profiles.js";
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
}

export async function handleCreateUnit(db: D1Database, body: CreateUnitBody): Promise<RouteResult> {
  const { id, name, parentUnitId } = body;
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

  await db
    .prepare("INSERT INTO org_units (id, name, parent_unit_id) VALUES (?, ?, ?)")
    .bind(id, name, parentUnitId ?? null)
    .run();

  return { status: 201, body: { id, name, parentUnitId: parentUnitId ?? null } };
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
}

export async function handleSetProfile(db: D1Database, body: SetProfileBody): Promise<RouteResult> {
  const { id, ciusProfile, unitId } = body;
  if (typeof id !== "string" || !id) {
    return { status: 400, body: { error: "id (string) is required" } };
  }
  if (!isKnownCiusProfile(ciusProfile)) {
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
    .prepare("INSERT INTO org_profiles (id, cius_profile, unit_id) VALUES (?, ?, ?)")
    .bind(id, ciusProfile, unitId ?? null)
    .run();

  return { status: 201, body: { id, ciusProfile, unitId: unitId ?? null } };
}
