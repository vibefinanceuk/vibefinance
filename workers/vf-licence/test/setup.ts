import { env } from "cloudflare:test";
// Same reasoning as workers/vf-app/test/setup.ts: bundled at build time
// via ?raw, not read at runtime — tests run inside real workerd, where
// an arbitrary host-path readFileSync does not reliably resolve.
import schemaSql from "../migrations/0001_control_plane_schema.sql?raw";
import usagePeriodsSql from "../migrations/0002_usage_periods.sql?raw";
import apiKeysSql from "../migrations/0003_customer_api_keys.sql?raw";
import fleetMetadataSql from "../migrations/0004_fleet_metadata.sql?raw";
import customerEnvironmentsSql from "../migrations/0005_customer_environments.sql?raw";
import signupRequestsSql from "../migrations/0006_signup_requests.sql?raw";
import expiryWarningsSql from "../migrations/0007_licence_expiry_warnings.sql?raw";
import environmentsPerRegionSql from "../migrations/0008_environments_per_region.sql?raw";
import loginAttemptsSql from "../migrations/0009_login_attempts.sql?raw";
import credentialsSql from "../migrations/0010_credentials_and_access.sql?raw";
import grantsCarryCustomerSql from "../migrations/0011_grants_carry_their_customer.sql?raw";
import brandingSql from "../migrations/0012_branding.sql?raw";
import uiStringsSql from "../migrations/0013_ui_strings.sql?raw";
import seedStringsSql from "../migrations/0014_seed_ui_strings.sql?raw";
import productNameSql from "../migrations/0015_product_name_string.sql?raw";
import frameStringsSql from "../migrations/0016_interface_frame_strings.sql?raw";
import lineStringsSql from "../migrations/0017_line_keying_strings.sql?raw";
import lineFieldStringsSql from "../migrations/0018_line_field_strings.sql?raw";
import missingLabelsSql from "../migrations/0019_missing_line_labels.sql?raw";
import remainingLabelsSql from "../migrations/0020_remaining_field_labels.sql?raw";

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
const TABLES_IN_DROP_ORDER = ["ui_strings", "customer_branding", "user_environment_access", "user_credentials", "login_attempts", "signup_requests", "usage_periods", "licences", "environments", "customers"];

export async function applyTestSchema(): Promise<void> {
  for (const table of TABLES_IN_DROP_ORDER) {
    await env.CONTROL_DB.exec(`DROP TABLE IF EXISTS ${table};`);
  }
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(schemaSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(usagePeriodsSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(apiKeysSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(fleetMetadataSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(customerEnvironmentsSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(signupRequestsSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(expiryWarningsSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(environmentsPerRegionSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(loginAttemptsSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(credentialsSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(grantsCarryCustomerSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(brandingSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(uiStringsSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(seedStringsSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(productNameSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(frameStringsSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(lineStringsSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(lineFieldStringsSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(missingLabelsSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(remainingLabelsSql)));
}
