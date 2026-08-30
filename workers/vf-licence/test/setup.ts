import { env } from "cloudflare:test";
// Same reasoning as workers/vf-app/test/setup.ts: bundled at build time
// via ?raw, not read at runtime — tests run inside real workerd, where
// an arbitrary host-path readFileSync does not reliably resolve.
import schemaSql from "../migrations/0001_control_plane_schema.sql?raw";
import usagePeriodsSql from "../migrations/0002_usage_periods.sql?raw";

function stripSqlComments(sql: string): string {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
}

function toOneStatementPerLine(sql: string): string {
  const collapsed = sql.replace(/\s+/g, " ").trim();
  return collapsed
    .split(";")
    .map((stmt) => stmt.trim())
    .filter((stmt) => stmt.length > 0)
    .map((stmt) => `${stmt};`)
    .join("\n");
}

// Same known divergences as vf-app's setup.ts: D1's exec() splits by
// newline and rejects comment-only statement chunks (handled by the two
// functions above), and storage does not appear to reset between it()
// blocks in this pool-workers version, so every table is dropped and
// recreated before each test rather than relying on framework isolation.
const TABLES_IN_DROP_ORDER = ["usage_periods", "licences", "customers"];

export async function applyTestSchema(): Promise<void> {
  for (const table of TABLES_IN_DROP_ORDER) {
    await env.CONTROL_DB.exec(`DROP TABLE IF EXISTS ${table};`);
  }
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(schemaSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(usagePeriodsSql)));
}
