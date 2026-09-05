import type { RouteResult } from "./customers-route.js";

/**
 * The interface's words — decision 0107.
 *
 * **In the control plane, for the same reason branding is** (0096): the
 * login screen needs its words before an instance has been chosen, so
 * an instance cannot be the source.
 *
 * **In D1 rather than a bundled file**, so fixing a wording or adding a
 * language does not need a UI deployment.
 */

const SUPPORTED = ["en", "de", "fr", "es", "it", "nl"] as const;
export type UiLocale = (typeof SUPPORTED)[number];

/**
 * Which language to answer in.
 *
 * `vf-app` takes this from a per-deployment var, on the reasoning that
 * one Worker serves one customer whose integration operates in one
 * language (decision 0008). **`vf-ui` is one shared deployment**, so
 * that reasoning does not carry: the language has to come from the
 * person.
 *
 * An unrecognised or absent locale is English, never an error — the one
 * rule 0008 established that does carry over unchanged.
 */
export function resolveUiLocale(requested: string | null): UiLocale {
  if (!requested) return "en";
  // `de-DE` and `de` are the same language for these purposes, and a
  // browser sends the first.
  const base = requested.split(",")[0].split("-")[0].trim().toLowerCase();
  return (SUPPORTED as readonly string[]).includes(base) ? (base as UiLocale) : "en";
}

export async function handleUiStrings(db: D1Database, requested: string | null): Promise<Response> {
  const locale = resolveUiLocale(requested);

  // English first, then the requested language over the top. **Falling
  // back per key rather than per language**: a partially translated
  // locale should show what it has and English for the rest, not
  // collapse entirely to English because one string is missing.
  const rows = await db
    .prepare(
      `SELECT key, locale, value FROM ui_strings
       WHERE locale = 'en' OR locale = ?
       ORDER BY CASE WHEN locale = 'en' THEN 0 ELSE 1 END`
    )
    .bind(locale)
    .all<{ key: string; locale: string; value: string }>();

  const strings: Record<string, string> = {};
  for (const row of rows.results) strings[row.key] = row.value;

  return new Response(JSON.stringify({ locale, strings }), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      // Cached briefly, like branding. Long enough that every page load
      // does not reach the control plane, short enough that a wording
      // fix appears without a deployment — which is most of why these
      // live in a database.
      "Cache-Control": "public, max-age=300",
      Vary: "Accept-Language",
    },
  });
}

export async function handleSetUiString(
  db: D1Database,
  body: Record<string, unknown>
): Promise<RouteResult> {
  const { key, locale, value } = body;
  if (typeof key !== "string" || key.trim() === "" || key !== key.toLowerCase()) {
    return { status: 422, body: { error: "key must be a lowercase dotted name" } };
  }
  if (typeof locale !== "string" || !(SUPPORTED as readonly string[]).includes(locale)) {
    return { status: 422, body: { error: `locale must be one of ${SUPPORTED.join(", ")}` } };
  }
  if (typeof value !== "string" || value.trim() === "") {
    // A key present with an empty string is worse than one absent: the
    // absent one falls back to English, the blank one renders nothing.
    return { status: 422, body: { error: "value must not be empty" } };
  }

  if (locale !== "en") {
    // English is the fallback, and the fallback has to exist. A German
    // string with no English sibling breaks it for everybody who is not
    // German — which a standing invariant also refuses.
    const english = await db
      .prepare("SELECT 1 FROM ui_strings WHERE key = ? AND locale = 'en'")
      .bind(key)
      .first();
    if (!english) {
      return {
        status: 422,
        body: {
          error: `no English value exists for ${key}`,
          detail: "English is the fallback, so it must be set before any translation",
        },
      };
    }
  }

  await db
    .prepare(
      `INSERT INTO ui_strings (key, locale, value) VALUES (?, ?, ?)
       ON CONFLICT (key, locale) DO UPDATE SET value = excluded.value`
    )
    .bind(key, locale, value.trim())
    .run();

  return { status: 200, body: { key, locale, value: value.trim() } };
}

/**
 * Every key, with its English text and whatever translations exist —
 * decision 0107.
 *
 * **What a translator needs.** Without this the only way to see the
 * full set is to read a seed migration, which makes the framework
 * usable only by somebody with the source in front of them.
 *
 * Reports what is missing rather than leaving it to be inferred: a list
 * of forty keys where six are absent is hard to read, and
 * `missing: ["fr", "es"]` is not.
 */
export async function handleListUiStrings(db: D1Database): Promise<RouteResult> {
  const rows = await db
    .prepare("SELECT key, locale, value FROM ui_strings ORDER BY key, locale")
    .all<{ key: string; locale: string; value: string }>();

  const byKey = new Map<string, Record<string, string>>();
  for (const row of rows.results) {
    if (!byKey.has(row.key)) byKey.set(row.key, {});
    byKey.get(row.key)![row.locale] = row.value;
  }

  const keys = [...byKey.entries()].map(([key, values]) => ({
    key,
    values,
    // Which languages this key still needs. The point of the endpoint:
    // a translator wants the gaps, not the inventory.
    missing: SUPPORTED.filter((l) => !(l in values)),
  }));

  return {
    status: 200,
    body: {
      locales: SUPPORTED,
      keys,
      coverage: Object.fromEntries(
        SUPPORTED.map((locale) => [
          locale,
          `${keys.filter((k) => locale in k.values).length}/${keys.length}`,
        ])
      ),
    },
  };
}

/**
 * Set many strings for one language at once.
 *
 * Translating a language a `PUT` at a time is tedious enough that
 * nobody would, which would make the framework theoretical.
 *
 * **All or nothing.** A partial write would leave a language half
 * applied with no way to tell which half, and the caller resubmitting
 * would not know what to resend.
 */
export async function handleBulkUiStrings(
  db: D1Database,
  body: Record<string, unknown>
): Promise<RouteResult> {
  const { locale, strings: incoming } = body;

  if (typeof locale !== "string" || !(SUPPORTED as readonly string[]).includes(locale)) {
    return { status: 422, body: { error: `locale must be one of ${SUPPORTED.join(", ")}` } };
  }
  if (typeof incoming !== "object" || incoming === null || Array.isArray(incoming)) {
    return { status: 400, body: { error: "strings (an object of key to value) is required" } };
  }

  const entries = Object.entries(incoming as Record<string, unknown>);
  if (entries.length === 0) {
    return { status: 400, body: { error: "strings must contain at least one key" } };
  }

  const blank = entries.filter(([, v]) => typeof v !== "string" || v.trim() === "");
  if (blank.length > 0) {
    return {
      status: 422,
      body: { error: `empty values for: ${blank.map(([k]) => k).join(", ")}` },
    };
  }

  if (locale !== "en") {
    // English is the fallback and has to exist first — the same rule
    // the standing invariant enforces, checked here so the caller gets
    // the list rather than a constraint error.
    const english = await db
      .prepare("SELECT key FROM ui_strings WHERE locale = 'en'")
      .all<{ key: string }>();
    const known = new Set(english.results.map((r) => r.key));
    const orphans = entries.map(([k]) => k).filter((k) => !known.has(k));
    if (orphans.length > 0) {
      return {
        status: 422,
        body: {
          error: `no English value exists for: ${orphans.join(", ")}`,
          detail: "English is the fallback, so it must be set before any translation",
        },
      };
    }
  }

  await db.batch(
    entries.map(([key, value]) =>
      db
        .prepare(
          `INSERT INTO ui_strings (key, locale, value) VALUES (?, ?, ?)
           ON CONFLICT (key, locale) DO UPDATE SET value = excluded.value`
        )
        .bind(key.toLowerCase(), locale, (value as string).trim())
    )
  );

  return { status: 200, body: { locale, written: entries.length } };
}
