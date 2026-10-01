import { listsInMapping, listsInOutbound, lookupKey, type FnContext, type MappingDefinition, type OutboundMapping } from "@vibefinance/shared";
import type { RouteResult } from "./org-route.js";

/**
 * **The customer's own look-up lists — decision 0568.**
 *
 * Dan chose look-ups next, for units first and a supplier's codes second,
 * with the lists **shared**: a list is kept once, on the Routes screen,
 * and any supplier mapping may use it through the `look_up` function. One
 * Units list serves every supplier.
 *
 * A list is two columns, *From* (as a supplier writes it) and *To* (what
 * it becomes). A value is found whatever its case or surrounding spaces.
 * The whole list is saved at once, as a person edits a table, and saving
 * refuses a row with nothing in it or a From written twice, naming it.
 *
 * Lists are read as they are when an invoice is read; they are not
 * versioned with a mapping. Retiring one keeps its entries, and a mapping
 * that still names it says the list is not available, in words.
 */

const MAX_ENTRIES = 5000;
const now = () => new Date().toISOString();

function newListId(): string {
  const hex = [...crypto.getRandomValues(new Uint8Array(4))].map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
  return `LL-${hex.slice(0, 4)}-${hex.slice(4, 8)}`;
}

interface ListRow {
  id: string;
  name: string;
  description: string | null;
  status: string;
  updated_at: string;
}

/** Which mappings use each list, by name: shown beside the list, and said before retiring it. */
async function usersOf(db: D1Database): Promise<Map<string, string[]>> {
  const rows = (
    await db
      .prepare(
        `SELECT m.name, v.definition_json FROM supplier_mappings m
         JOIN supplier_mapping_versions v ON v.mapping_id = m.id AND v.status IN ('live', 'draft')
         WHERE m.status = 'active'`
      )
      .all<{ name: string; definition_json: string }>()
  ).results;
  const users = new Map<string, string[]>();
  for (const r of rows) {
    let def: MappingDefinition;
    try {
      def = JSON.parse(r.definition_json) as MappingDefinition;
    } catch {
      continue;
    }
    for (const id of listsInMapping(def)) {
      const names = users.get(id) ?? [];
      if (!names.includes(r.name)) names.push(r.name);
      users.set(id, names);
    }
  }
  // Decision 0591: a Destination's own outbound mapping uses lists too.
  const outbound = (
    await db
      .prepare(
        `SELECT i.name, v.definition_json FROM outbound_mapping_versions v JOIN route_instances i ON i.id = v.instance_id
         WHERE v.status IN ('live', 'draft') AND i.status != 'retired'`
      )
      .all<{ name: string | null; definition_json: string }>()
  ).results;
  for (const r of outbound) {
    let def: OutboundMapping;
    try {
      def = JSON.parse(r.definition_json) as OutboundMapping;
    } catch {
      continue;
    }
    for (const id of listsInOutbound(def)) {
      const names = users.get(id) ?? [];
      const name = r.name ?? "Destination";
      if (!names.includes(name)) names.push(name);
      users.set(id, names);
    }
  }
  return users;
}

/** `GET /lookup-lists` — every active list, with how many entries and which mappings use it. */
export async function handleListLookupLists(db: D1Database): Promise<RouteResult> {
  const rows = (
    await db
      .prepare(
        `SELECT l.id, l.name, l.description, l.status, l.updated_at,
                (SELECT count(*) FROM lookup_entries e WHERE e.list_id = l.id) AS entries
         FROM lookup_lists l WHERE l.status = 'active' ORDER BY lower(l.name)`
      )
      .all<ListRow & { entries: number }>()
  ).results;
  const users = await usersOf(db);
  return {
    status: 200,
    body: {
      lists: rows.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        entries: r.entries,
        updatedAt: r.updated_at,
        usedBy: users.get(r.id) ?? [],
      })),
    },
  };
}

function cleanName(v: unknown): string | null {
  const s = typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "";
  return s === "" ? null : s.slice(0, 80);
}

async function nameTaken(db: D1Database, name: string, except?: string): Promise<boolean> {
  const hit = await db
    .prepare("SELECT id FROM lookup_lists WHERE status = 'active' AND lower(name) = lower(?) AND id != ?")
    .bind(name, except ?? "")
    .first();
  return !!hit;
}

/** `POST /lookup-lists` — a new, empty list with a name. */
export async function handleCreateLookupList(db: D1Database, userId: string, body: Record<string, unknown>): Promise<RouteResult> {
  const name = cleanName(body.name);
  if (!name) return { status: 400, body: { error: "a list needs a name", reason: "no_name" } };
  if (await nameTaken(db, name)) return { status: 409, body: { error: `there is already a list called ${name}`, reason: "name_taken" } };
  const id = newListId();
  const description = typeof body.description === "string" && body.description.trim() !== "" ? body.description.trim().slice(0, 300) : null;
  await db
    .prepare(
      `INSERT INTO lookup_lists (id, name, description, created_at, created_by, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, name, description, now(), userId, now(), userId)
    .run();
  return { status: 201, body: { id, name } };
}

/** `GET /lookup-lists/:id` — the list and every entry, in the order a person reads them. */
export async function handleGetLookupList(db: D1Database, id: string): Promise<RouteResult> {
  const list = await db.prepare("SELECT id, name, description, status, updated_at FROM lookup_lists WHERE id = ?").bind(id).first<ListRow>();
  if (!list) return { status: 404, body: { error: `look-up list ${id} does not exist` } };
  const entries = (
    await db
      .prepare("SELECT from_value, to_value FROM lookup_entries WHERE list_id = ? ORDER BY key")
      .bind(id)
      .all<{ from_value: string; to_value: string }>()
  ).results;
  const users = await usersOf(db);
  return {
    status: 200,
    body: {
      list: { id: list.id, name: list.name, description: list.description, status: list.status, updatedAt: list.updated_at },
      entries: entries.map((e) => ({ from: e.from_value, to: e.to_value })),
      usedBy: users.get(list.id) ?? [],
    },
  };
}

/**
 * `PUT /lookup-lists/:id` — its name, and its entries replaced whole. Rows
 * that are wholly empty are ignored, as a table's last blank row is; a row
 * with only one side, or a From written twice, is refused, naming it.
 */
export async function handleSaveLookupList(db: D1Database, userId: string, id: string, body: Record<string, unknown>): Promise<RouteResult> {
  const list = await db.prepare("SELECT id, name, status FROM lookup_lists WHERE id = ?").bind(id).first<ListRow>();
  if (!list) return { status: 404, body: { error: `look-up list ${id} does not exist` } };
  if (list.status === "retired") return { status: 409, body: { error: "the list is retired", reason: "retired" } };
  const name = body.name === undefined ? list.name : cleanName(body.name);
  if (!name) return { status: 400, body: { error: "a list needs a name", reason: "no_name" } };
  if (name !== list.name && (await nameTaken(db, name, id))) {
    return { status: 409, body: { error: `there is already a list called ${name}`, reason: "name_taken" } };
  }
  if (!Array.isArray(body.entries)) return { status: 400, body: { error: "entries is a list of {from, to}", reason: "no_entries" } };
  const rows = (body.entries as unknown[])
    .map((e) => {
      const r = (e ?? {}) as { from?: unknown; to?: unknown };
      return { from: typeof r.from === "string" ? r.from.trim() : "", to: typeof r.to === "string" ? r.to.trim() : "" };
    })
    .filter((r) => r.from !== "" || r.to !== "");
  if (rows.length > MAX_ENTRIES) return { status: 422, body: { error: `a list holds at most ${MAX_ENTRIES} entries`, reason: "too_many" } };
  const seen = new Map<string, string>();
  for (const [i, r] of rows.entries()) {
    if (r.from === "") return { status: 422, body: { error: `row ${i + 1} has nothing in From`, reason: "empty_from", row: i + 1 } };
    if (r.to === "") return { status: 422, body: { error: `row ${i + 1} (${r.from}) has nothing in To`, reason: "empty_to", row: i + 1 } };
    const key = lookupKey(r.from);
    if (seen.has(key)) {
      return { status: 422, body: { error: `${r.from} is in the list twice (rows ${seen.get(key)} and ${i + 1})`, reason: "duplicate", row: i + 1 } };
    }
    seen.set(key, String(i + 1));
  }
  const statements = [
    db.prepare("UPDATE lookup_lists SET name = ?, updated_at = ?, updated_by = ? WHERE id = ?").bind(name, now(), userId, id),
    db.prepare("DELETE FROM lookup_entries WHERE list_id = ?").bind(id),
    ...rows.map((r) =>
      db.prepare("INSERT INTO lookup_entries (list_id, key, from_value, to_value) VALUES (?, ?, ?, ?)").bind(id, lookupKey(r.from), r.from, r.to)
    ),
  ];
  // D1 batches are one transaction: the list is replaced whole, or not at all.
  await db.batch(statements);
  return { status: 200, body: { id, name, entries: rows.length } };
}

/** `POST /lookup-lists/:id/retire` — it leaves the Routes screen; its entries are kept. */
export async function handleRetireLookupList(db: D1Database, userId: string, id: string): Promise<RouteResult> {
  const list = await db.prepare("SELECT id, status FROM lookup_lists WHERE id = ?").bind(id).first<ListRow>();
  if (!list) return { status: 404, body: { error: `look-up list ${id} does not exist` } };
  if (list.status === "retired") return { status: 409, body: { error: "the list is already retired", reason: "retired" } };
  await db.prepare("UPDATE lookup_lists SET status = 'retired', retired_at = ?, retired_by = ? WHERE id = ?").bind(now(), userId, id).run();
  return { status: 200, body: { id, status: "retired", usedBy: (await usersOf(db)).get(id) ?? [] } };
}

/**
 * The lists a mapping names, loaded for the functions (`FnContext`). A
 * retired or missing list is left out, so `look_up` says it is not
 * available rather than reading an old list.
 */
export async function lookupsFor(db: D1Database, def: MappingDefinition): Promise<FnContext> {
  return loadLookups(db, listsInMapping(def));
}

export async function loadLookups(db: D1Database, ids: string[]): Promise<FnContext> {
  const lookups: NonNullable<FnContext["lookups"]> = {};
  for (const id of ids) {
    const list = await db.prepare("SELECT id, name FROM lookup_lists WHERE id = ? AND status = 'active'").bind(id).first<{ id: string; name: string }>();
    if (!list) continue;
    const rows = (await db.prepare("SELECT key, to_value FROM lookup_entries WHERE list_id = ?").bind(id).all<{ key: string; to_value: string }>()).results;
    lookups[id] = { name: list.name, entries: Object.fromEntries(rows.map((r) => [r.key, r.to_value])) };
  }
  return { lookups };
}

/**
 * Every active list, for compiling a function: its id and name with a few
 * entries for the prompt, and the lists themselves for the worked examples.
 */
export async function allLookups(db: D1Database): Promise<{
  lists: Array<{ id: string; name: string; examples: Array<[string, string]> }>;
  ctx: FnContext;
}> {
  const rows = (await db.prepare("SELECT id FROM lookup_lists WHERE status = 'active' ORDER BY lower(name)").all<{ id: string }>()).results;
  const ctx = await loadLookups(db, rows.map((r) => r.id));
  const lists = [];
  for (const r of rows) {
    const examples = (
      await db.prepare("SELECT from_value, to_value FROM lookup_entries WHERE list_id = ? ORDER BY key LIMIT 3").bind(r.id).all<{ from_value: string; to_value: string }>()
    ).results.map((e) => [e.from_value, e.to_value] as [string, string]);
    lists.push({ id: r.id, name: ctx.lookups?.[r.id]?.name ?? r.id, examples });
  }
  return { lists, ctx };
}

/** The names of the lists a definition names that are not active lists, for refusing a draft. */
export async function unknownLists(db: D1Database, def: MappingDefinition): Promise<string[]> {
  const out: string[] = [];
  for (const id of listsInMapping(def)) {
    const hit = await db.prepare("SELECT 1 AS x FROM lookup_lists WHERE id = ? AND status = 'active'").bind(id).first();
    if (!hit) out.push(id);
  }
  return out;
}
