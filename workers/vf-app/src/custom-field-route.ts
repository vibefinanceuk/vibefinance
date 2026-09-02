import type { RouteResult } from "./org-route.js";
import {
  deriveCustomFieldKey,
  isKnownFieldType,
  FIELD_TYPES,
  type CustomFieldDefinition,
} from "@vibefinance/shared";

/**
 * The customer field registry — decision 0041.
 *
 * A customer declares a field once, as a real, named, typed entity,
 * and it joins their own vocabulary. The vocabulary stays closed; it
 * becomes closed PER CUSTOMER rather than closed globally. Every
 * property that makes the rule engine safe survives — a rule can
 * still only reference declared fields, validateRule() still refuses
 * anything outside the set, and the compiler's prompt still receives
 * a finite, authoritative list.
 *
 * Declared per environment, structurally: this table lives in the
 * customer's own vf-app database, and a sandbox has a different one
 * (decision 0036). A customer experimenting in sandbox therefore
 * cannot silently alter production behaviour — the separation costs
 * no column because the databases are already separate.
 *
 * No authentication, matching the same "raw API for now" precedent
 * already used for /org/units, /org/teams and /org/cost-centres.
 */

interface CreateCustomFieldBody {
  label?: unknown;
  type?: unknown;
  description?: unknown;
}

interface CustomFieldRow {
  key: string;
  label: string;
  type: string;
  description: string;
  created_at: string;
}

function toView(row: CustomFieldRow): Record<string, unknown> {
  return {
    key: row.key,
    label: row.label,
    type: row.type,
    description: row.description,
    createdAt: row.created_at,
  };
}

export async function handleCreateCustomField(
  db: D1Database,
  body: CreateCustomFieldBody
): Promise<RouteResult> {
  const { label, type, description } = body;
  if (
    typeof label !== "string" ||
    !label.trim() ||
    typeof type !== "string" ||
    typeof description !== "string" ||
    !description.trim()
  ) {
    return {
      status: 400,
      body: { error: "label, type and description (all non-empty strings) are required" },
    };
  }
  if (!isKnownFieldType(type)) {
    return {
      status: 400,
      body: { error: `type must be one of ${FIELD_TYPES.join(", ")}, got '${type}'` },
    };
  }

  // The key is derived, never accepted from the caller — decision
  // 0041. Avoids collisions, invalid characters, and two customers'
  // rules being subtly incompatible in ways nobody notices.
  const key = deriveCustomFieldKey(label);
  if (key === "custom.") {
    return {
      status: 400,
      body: { error: `label '${label}' contains no alphanumeric characters, so no field key can be derived from it` },
    };
  }

  const existing = await db.prepare("SELECT key, label FROM custom_fields WHERE key = ?").bind(key).first<{
    key: string;
    label: string;
  }>();
  if (existing) {
    // Deliberately reports the existing label, not just the key: two
    // labels differing only in case or punctuation derive to the same
    // key, and "Transport Reference already exists" is a far more
    // useful message than "custom.transport_reference already exists"
    // to someone who just typed "transport reference".
    return {
      status: 409,
      body: { error: `field '${existing.label}' already exists as ${key}` },
    };
  }

  await db
    .prepare("INSERT INTO custom_fields (key, label, type, description) VALUES (?, ?, ?, ?)")
    .bind(key, label.trim(), type, description.trim())
    .run();

  return { status: 201, body: { key, label: label.trim(), type, description: description.trim() } };
}

export async function handleListCustomFields(db: D1Database): Promise<RouteResult> {
  const rows = await db.prepare("SELECT * FROM custom_fields ORDER BY key").all<CustomFieldRow>();
  return { status: 200, body: { fields: rows.results.map(toView) } };
}

/**
 * Loads a customer's declared fields for vocabulary resolution.
 *
 * This is the ONE database read in the whole custom-field path. It
 * happens at the edge, in a route handler, and the resolved result is
 * passed inward — which is exactly what keeps validateRule() and the
 * interpreter synchronous and pure. Neither ever performs a lookup;
 * they receive a complete answer.
 *
 * That purity is what keeps decision 0003's support argument true. It
 * becomes, honestly, "reproduces from three inputs: their rules, the
 * invoice, and their field definitions" — but it stays reproducible,
 * which is the property that actually matters.
 */
export async function loadCustomFields(db: D1Database): Promise<CustomFieldDefinition[]> {
  const rows = await db
    .prepare("SELECT key, label, type, description FROM custom_fields ORDER BY key")
    .all<{ key: string; label: string; type: string; description: string }>();
  return rows.results.map((row) => ({
    key: row.key,
    label: row.label,
    // Safe by construction: the column carries a CHECK constraint to
    // exactly the FieldType set, so anything stored is already valid.
    type: row.type as CustomFieldDefinition["type"],
    description: row.description,
  }));
}
