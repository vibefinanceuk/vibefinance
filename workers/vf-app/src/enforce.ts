import { authenticateUser } from "./user-auth.js";
import type { AuthenticatedUser } from "./user-auth.js";
import type { Permission } from "./permissions.js";

interface RoleRow {
  permissions_json: string;
}

/**
 * Does this user hold ANY role granting the given permission? A user
 * can hold more than one role (org_user_roles is many-to-many); this
 * returns true if any one of them grants it.
 */
export async function hasPermission(db: D1Database, userId: string, permission: Permission): Promise<boolean> {
  const rows = await db
    .prepare(
      `SELECT r.permissions_json AS permissions_json
       FROM org_roles r
       JOIN org_user_roles ur ON ur.role_id = r.id
       WHERE ur.user_id = ?`
    )
    .bind(userId)
    .all<RoleRow>();

  for (const row of rows.results) {
    const permissions = JSON.parse(row.permissions_json) as string[];
    if (permissions.includes(permission)) return true;
  }
  return false;
}

export type AuthorizationResult =
  | { authorized: true; user: AuthenticatedUser }
  | { authorized: false; status: 401 | 403 };

/**
 * Authenticate, then authorize — the combined check most routes
 * actually need. 401 (no valid key at all) is distinguished from 403
 * (a real, authenticated user who simply lacks this permission) —
 * different facts, worth telling apart rather than collapsing into one
 * generic "no" for whoever's debugging a client integration.
 */
export async function requirePermission(
  db: D1Database,
  request: Request,
  permission: Permission
): Promise<AuthorizationResult> {
  const user = await authenticateUser(db, request);
  if (!user) {
    return { authorized: false, status: 401 };
  }
  const allowed = await hasPermission(db, user.id, permission);
  if (!allowed) {
    return { authorized: false, status: 403 };
  }
  return { authorized: true, user };
}

/**
 * Every permission this person holds, across all their roles — decision
 * 0095.
 *
 * `hasPermission` answers "may they do X". A screen needs the whole set
 * at once: which buttons to render at all, rather than discovering by
 * being refused.
 */
export async function permissionsFor(db: D1Database, userId: string): Promise<string[]> {
  const rows = await db
    .prepare(
      `SELECT r.permissions_json AS permissions_json
       FROM org_user_roles ur
       JOIN org_roles r ON r.id = ur.role_id
       WHERE ur.user_id = ?`
    )
    .bind(userId)
    .all<{ permissions_json: string }>();

  const all = new Set<string>();
  for (const row of rows.results) {
    try {
      for (const p of JSON.parse(row.permissions_json) as string[]) all.add(p);
    } catch {
      // A role with unparseable permissions grants nothing rather than
      // failing the whole request — one bad row must not lock somebody
      // out of every screen.
    }
  }
  return [...all].sort();
}
