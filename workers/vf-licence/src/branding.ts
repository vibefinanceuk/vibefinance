import type { RouteResult } from "./customers-route.js";

/**
 * A customer's livery — decision 0096.
 *
 * **Branding reaches tokens only**, so a customer cannot break a screen
 * (`docs/design/operator-interface.md` section 7). Five values, four of
 * them colours. Spacing, type scale and layout are structural and are
 * not theirs to set.
 *
 * Set by the operator, never by the customer (decision 0083 section 3).
 */

/** The default livery, and what every customer gets until told otherwise. */
export const DEFAULT_BRANDING = {
  brandBar: "#0f6e56",
  brandFill: "#0f6e56",
  brandChip: "#9fe1cb",
  brandChipText: "#04342c",
  brandName: "VibeFinance",
} as const;

export interface Branding {
  brandBar: string;
  brandFill: string;
  brandChip: string;
  brandChipText: string;
  brandName: string;
}

const HEX_COLOUR = /^#[0-9a-fA-F]{6}$/;

/**
 * A brand name that cannot escape the CSS string it is written into.
 *
 * Same reasoning as the colours, different alphabet: these values are
 * interpolated into a stylesheet the browser executes, and a customer's
 * livery must not be able to rewrite a screen.
 */
function isSafeBrandName(value: string): boolean {
  return value.trim() !== "" && value.length <= 60 && !/["\\;}<>]/.test(value);
}

export async function loadBranding(db: D1Database, customerId: string): Promise<Branding> {
  const row = await db
    .prepare(
      "SELECT brand_bar, brand_fill, brand_chip, brand_chip_text, brand_name FROM customer_branding WHERE customer_id = ?"
    )
    .bind(customerId)
    .first<Record<string, string | null>>();

  // Absent means the default, and so does any individual null — a
  // customer who set only their bar colour keeps the rest. No row is
  // required for a customer who never wanted a livery.
  return {
    brandBar: row?.brand_bar ?? DEFAULT_BRANDING.brandBar,
    brandFill: row?.brand_fill ?? DEFAULT_BRANDING.brandFill,
    brandChip: row?.brand_chip ?? DEFAULT_BRANDING.brandChip,
    brandChipText: row?.brand_chip_text ?? DEFAULT_BRANDING.brandChipText,
    brandName: row?.brand_name ?? DEFAULT_BRANDING.brandName,
  };
}

export async function setBranding(
  db: D1Database,
  customerId: string,
  body: Record<string, unknown>,
  updatedBy: string | null = null
): Promise<RouteResult> {
  const customer = await db.prepare("SELECT id FROM customers WHERE id = ?").bind(customerId).first();
  if (!customer) {
    return { status: 404, body: { error: `customer ${customerId} does not exist` } };
  }

  const colours = ["brandBar", "brandFill", "brandChip", "brandChipText"] as const;
  const values: Record<string, string | null> = {};

  for (const key of colours) {
    const raw = body[key];
    if (raw === undefined || raw === null) {
      values[key] = null;
      continue;
    }
    if (typeof raw !== "string" || !HEX_COLOUR.test(raw)) {
      // Validated here as well as by the standing invariant, so the
      // caller gets a reason rather than a constraint error. The
      // invariant holds however the row arrived.
      return {
        status: 422,
        body: { error: `${key} must be a six-digit hex colour such as #0f6e56` },
      };
    }
    values[key] = raw;
  }

  const name = body.brandName;
  if (name === undefined || name === null) {
    values.brandName = null;
  } else if (typeof name !== "string" || !isSafeBrandName(name)) {
    return {
      status: 422,
      body: {
        error: "brandName must be plain text under 60 characters",
        detail: "it is written into a stylesheet, so quotes, semicolons and braces are refused",
      },
    };
  } else {
    values.brandName = name.trim();
  }

  await db
    .prepare(
      `INSERT INTO customer_branding (customer_id, brand_bar, brand_fill, brand_chip, brand_chip_text, brand_name, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (customer_id) DO UPDATE SET
         brand_bar = excluded.brand_bar, brand_fill = excluded.brand_fill,
         brand_chip = excluded.brand_chip, brand_chip_text = excluded.brand_chip_text,
         brand_name = excluded.brand_name, updated_at = excluded.updated_at,
         updated_by = excluded.updated_by`
    )
    .bind(
      customerId,
      values.brandBar,
      values.brandFill,
      values.brandChip,
      values.brandChipText,
      values.brandName,
      new Date().toISOString(),
      updatedBy
    )
    .run();

  return { status: 200, body: { customerId, branding: await loadBranding(db, customerId) } };
}

/**
 * The stylesheet the shared UI fetches.
 *
 * Served as CSS rather than JSON on purpose: a `<link>` in the document
 * head applies before the first paint, where JSON would mean fetching,
 * parsing and setting variables in script — and a flash of the wrong
 * livery while it happened.
 *
 * **Unauthenticated**, because the login screen needs it before anybody
 * has signed in. It discloses four colours and a name, which a customer
 * puts on their letterhead anyway.
 */
export async function handleBrandingStylesheet(
  db: D1Database,
  customerId: string | null
): Promise<Response> {
  // An unknown or absent customer gets the default rather than an
  // error: a login screen that fails to render because somebody
  // mistyped a query parameter is worse than one that looks generic.
  const branding = customerId ? await loadBranding(db, customerId) : { ...DEFAULT_BRANDING };

  const css = `:root {
  --brand-bar: ${branding.brandBar};
  --brand-fill: ${branding.brandFill};
  --brand-chip: ${branding.brandChip};
  --brand-chip-text: ${branding.brandChipText};
  --brand-name: "${branding.brandName}";
}
`;

  return new Response(css, {
    status: 200,
    headers: {
      "Content-Type": "text/css; charset=utf-8",
      // Short, so a livery change appears without a redeploy, and long
      // enough that every page load does not hit the control plane.
      "Cache-Control": "public, max-age=300",
    },
  });
}
