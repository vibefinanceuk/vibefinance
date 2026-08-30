/**
 * Permission identifiers a role can be granted — see
 * docs/decisions/0009-org-authority-profiles.md. Deliberately mapped
 * to vf-app's real, current route surface (including this bundle's
 * own new org/* management routes), not an aspirational or invented
 * permission model — nothing here is enforced by any route yet (that
 * remains a separate, future bundle), so a permission with no
 * corresponding real capability would just be speculative.
 *
 * Same closed-vocabulary discipline as CIUS_PROFILES in profiles.ts
 * and the rule interpreter's own vocabulary — a role's
 * permissions_json must only ever contain values from this list,
 * validated at the application layer before insert.
 */
export const PERMISSIONS = [
  "rules.compile",
  "rules.evaluate",
  "rules.view_examples",
  "rules.confirm_examples",
  "rules.activate",
  "usage.push",
  "licence.refresh",
  "org.manage_units",
  "org.manage_users",
  "org.manage_roles",
  "org.manage_authority_limits",
  "org.manage_profiles",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export function isKnownPermission(value: unknown): value is Permission {
  return typeof value === "string" && (PERMISSIONS as readonly string[]).includes(value);
}

/** Every element of `values` must be a known permission — used to
 * validate a role's whole permissions_json array in one call, mirroring
 * how validateRule() checks every condition/action in a rule, not just
 * the first one. */
export function isKnownPermissionList(values: unknown): values is Permission[] {
  return Array.isArray(values) && values.every(isKnownPermission);
}
