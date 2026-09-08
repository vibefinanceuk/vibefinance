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
import partyStringsSql from "../migrations/0021_party_panel_strings.sql?raw";
import checkLabelsSql from "../migrations/0022_validation_check_labels.sql?raw";
import actionExpandSql from "../migrations/0023_action_expand.sql?raw";
import sourcesScreenSql from "../migrations/0024_sources_screen_strings.sql?raw";
import newSourceSql from "../migrations/0025_new_source_strings.sql?raw";
import nameLimitsSql from "../migrations/0026_source_name_limits.sql?raw";
import sourceActionsSql from "../migrations/0027_source_actions_strings.sql?raw";
import outcomeStringsSql from "../migrations/0028_source_outcome_strings.sql?raw";
import releaseStringsSql from "../migrations/0029_release_address_strings.sql?raw";
import manifestConfigSql from "../migrations/0030_manifest_completes_the_config.sql?raw";
import actionStringsSql from "../migrations/0031_action_strings.sql?raw";
import moodStringsSql from "../migrations/0032_mood_strings.sql?raw";
import noDomainSql from "../migrations/0033_no_domain_string.sql?raw";
import adminActionsSql from "../migrations/0034_admin_actions.sql?raw";
import rulesScreenSql from "../migrations/0035_rules_screen_strings.sql?raw";
import progressSql from "../migrations/0036_progress_strings.sql?raw";
import readbackSql from "../migrations/0037_readback_strings.sql?raw";
import composeSql from "../migrations/0038_compose_strings.sql?raw";
import rulesWordingSql from "../migrations/0039_rules_screen_wording.sql?raw";
import ruleDetailSql from "../migrations/0040_rule_detail_strings.sql?raw";
import actionLabelsSql from "../migrations/0041_missing_action_labels.sql?raw";
import exampleFactsSql from "../migrations/0042_example_facts_strings.sql?raw";
import unreadableSql from "../migrations/0043_unreadable_document_strings.sql?raw";
import documentsSql from "../migrations/0044_documents_screen_strings.sql?raw";
import lineDescriptionSql from "../migrations/0045_line_description_label.sql?raw";

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
const TABLES_IN_DROP_ORDER = ["admin_actions", "ui_strings", "customer_branding", "user_environment_access", "user_credentials", "login_attempts", "signup_requests", "usage_periods", "licences", "environments", "customers"];

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
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(partyStringsSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(checkLabelsSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(actionExpandSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(sourcesScreenSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(newSourceSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(nameLimitsSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(sourceActionsSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(outcomeStringsSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(releaseStringsSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(manifestConfigSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(actionStringsSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(moodStringsSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(noDomainSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(adminActionsSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(rulesScreenSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(progressSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(readbackSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(composeSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(rulesWordingSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(ruleDetailSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(actionLabelsSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(exampleFactsSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(unreadableSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(documentsSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(lineDescriptionSql)));

}
