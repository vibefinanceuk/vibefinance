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
import viewerHeadingSql from "../migrations/0046_viewer_heading_labels.sql?raw";
import unclaimedSql from "../migrations/0047_unclaimed_owner.sql?raw";
import colonsSql from "../migrations/0048_labels_with_colons.sql?raw";
import taskLineSql from "../migrations/0049_task_line_label.sql?raw";
import signinFailureSql from "../migrations/0050_signin_failure_strings.sql?raw";
import documentUnitSql from "../migrations/0051_document_unit_column.sql?raw";
import sourceOrgSql from "../migrations/0052_source_org_column.sql?raw";
import supplierScreenSql from "../migrations/0053_supplier_screen_strings.sql?raw";
import supplierLoadErrorSql from "../migrations/0054_supplier_load_error.sql?raw";
import sitePurposeSql from "../migrations/0055_site_purpose_strings.sql?raw";
import supplierPanelSql from "../migrations/0056_supplier_panel_strings.sql?raw";
import sellerCardSql from "../migrations/0057_seller_card_strings.sql?raw";
import sellerPhoneSql from "../migrations/0058_seller_card_phone.sql?raw";
import supplierSearchSql from "../migrations/0059_supplier_search_strings.sql?raw";
import buyerCardSql from "../migrations/0060_buyer_card_strings.sql?raw";
import cardActionsSql from "../migrations/0061_card_actions.sql?raw";
import supplierDetailSql from "../migrations/0062_supplier_detail_strings.sql?raw";
import awaitingErpSql from "../migrations/0063_awaiting_erp_strings.sql?raw";
import recordFromInvoiceSql from "../migrations/0064_record_from_invoice.sql?raw";
import stateActionSql from "../migrations/0065_state_action_labels.sql?raw";
import activateCloseSql from "../migrations/0066_activate_and_close.sql?raw";
import loadNewSql from "../migrations/0067_load_and_new_supplier.sql?raw";
import dashboardStringsSql from "../migrations/0068_dashboard_strings.sql?raw";
import dashboardLibrarySql from "../migrations/0069_dashboard_library_strings.sql?raw";
import dueTodaySql from "../migrations/0070_due_today.sql?raw";
import cardNamesSql from "../migrations/0071_a_name_per_card_type.sql?raw";
import whoHoldsSql from "../migrations/0072_who_holds_it.sql?raw";
import threeAlertsSql from "../migrations/0073_three_alerts_not_one.sql?raw";
import moverPickerSql from "../migrations/0074_the_mover_picker.sql?raw";
import showingOneStageSql from "../migrations/0075_showing_one_stage.sql?raw";
import whatIActedOnSql from "../migrations/0076_what_i_acted_on.sql?raw";
import nameARuleSql from "../migrations/0077_name_a_rule.sql?raw";
import activityPanelSql from "../migrations/0078_activity_panel.sql?raw";
import timelineChatTabSql from "../migrations/0079_timeline_chat_tab.sql?raw";
import systemAlertLabelSql from "../migrations/0080_system_alert_label.sql?raw";
import unreadableWordingSql from "../migrations/0081_unreadable_wording.sql?raw";
import xmlTabSql from "../migrations/0082_xml_tab.sql?raw";
import navRestructureSql from "../migrations/0083_nav_restructure.sql?raw";
import backButtonWordingSql from "../migrations/0084_back_button_wording.sql?raw";
import moodButtonWordingSql from "../migrations/0085_mood_button_wording.sql?raw";
import headerFieldsPopoutSql from "../migrations/0086_header_fields_popout.sql?raw";
import paymentTermsFieldSql from "../migrations/0087_payment_terms_field.sql?raw";
import supplierStatusCardSql from "../migrations/0088_supplier_status_card.sql?raw";
import composeBackSql from "../migrations/0089_compose_back.sql?raw";
import dashboardHeadingRewordSql from "../migrations/0090_dashboard_heading_reword.sql?raw";
import rulesTableColumnSql from "../migrations/0091_rules_table_column.sql?raw";
import orgSwitcherStringsSql from "../migrations/0092_org_switcher_strings.sql?raw";
import roleManagementStringsSql from "../migrations/0093_role_management_strings.sql?raw";
import roleManagementLoadFailedSql from "../migrations/0094_role_management_load_failed.sql?raw";
import roleEditingStringsSql from "../migrations/0095_role_editing_strings.sql?raw";
import roleAssignmentStringsSql from "../migrations/0096_role_assignment_strings.sql?raw";
import personCreationStringsSql from "../migrations/0097_person_creation_strings.sql?raw";
import popoutActionRowStringsSql from "../migrations/0098_popout_action_row_strings.sql?raw";
import teamsStringsSql from "../migrations/0099_teams_strings.sql?raw";
import accessNavRenameSql from "../migrations/0100_access_nav_rename.sql?raw";
import userPropertiesStringsSql from "../migrations/0101_user_properties_strings.sql?raw";
import orgUnitManagementStringsSql from "../migrations/0102_org_unit_management_strings.sql?raw";
import personRolesPropertiesSplitStringsSql from "../migrations/0103_person_roles_properties_split_strings.sql?raw";
import navGroupHeadingsStringsSql from "../migrations/0104_nav_group_headings_strings.sql?raw";
import sourcesActionIconsStringsSql from "../migrations/0105_sources_action_icons_strings.sql?raw";
import processManagementStringsSql from "../migrations/0106_process_management_strings.sql?raw";
import rulesProcessSelectorStringsSql from "../migrations/0107_rules_process_selector_strings.sql?raw";
import startDraftStringsSql from "../migrations/0108_start_draft_strings.sql?raw";
import newDraftWordingSql from "../migrations/0109_new_draft_wording.sql?raw";
import purchaseOrdersScreenStringsSql from "../migrations/0110_purchase_orders_screen_strings.sql?raw";
import purchaseOrdersListStringsSql from "../migrations/0111_purchase_orders_list_strings.sql?raw";
import purchaseOrdersFormatReferenceStringsSql from "../migrations/0112_purchase_orders_format_reference_strings.sql?raw";
import purchaseOrdersButtonLabelsSql from "../migrations/0113_purchase_orders_button_labels.sql?raw";
import purchaseOrdersOrgLabelSql from "../migrations/0114_purchase_orders_org_label.sql?raw";
import purchaseOrdersSearchAndPaginationStringsSql from "../migrations/0115_purchase_orders_search_and_pagination_strings.sql?raw";
import purchaseOrdersStatusStringsSql from "../migrations/0116_purchase_orders_status_strings.sql?raw";
import purchaseOrdersStatusHeadingWordingSql from "../migrations/0117_purchase_orders_status_heading_wording.sql?raw";
import suppliersSearchAndPaginationStringsSql from "../migrations/0118_suppliers_search_and_pagination_strings.sql?raw";
import orgUnitVatidRenamedTaxIdentifierSql from "../migrations/0119_org_unit_vatid_renamed_tax_identifier.sql?raw";
import documentViewerPageRendererStringsSql from "../migrations/0120_document_viewer_page_renderer_strings.sql?raw";
import documentWindowPopoutStringsSql from "../migrations/0121_document_window_popout_strings.sql?raw";
import documentPlaceholderWordingSql from "../migrations/0122_document_placeholder_wording.sql?raw";
import documentPageCyclingAndHighlightStringsSql from "../migrations/0123_document_page_cycling_and_highlight_strings.sql?raw";
import poMismatchCheckLabelSql from "../migrations/0124_po_mismatch_check_label.sql?raw";
import dashboardCardTitlesRewordedSql from "../migrations/0125_dashboard_card_titles_reworded.sql?raw";
import documentsShowingExceptionsAndAgingSql from "../migrations/0126_documents_showing_exceptions_and_aging.sql?raw";
// Migrations 0127-0144 are not wired into this file — a pre-existing
// gap, not introduced here. 0145 is wired in below, resuming the same
// import-then-exec discipline every migration through 0126 already
// follows.
import apSetupStringsSql from "../migrations/0145_ap_setup_strings.sql?raw";
import apSetupOverrideSearchStringsSql from "../migrations/0146_ap_setup_override_search_strings.sql?raw";
import accountCodingStringsSql from "../migrations/0147_account_coding_strings.sql?raw";
import codingListCsvStringsSql from "../migrations/0148_coding_list_csv_strings.sql?raw";
import accountCodingSearchAndPaginationStringsSql from "../migrations/0149_account_coding_search_and_pagination_strings.sql?raw";
import orgCompanyCodeNamingAlignmentSql from "../migrations/0150_org_company_code_naming_alignment.sql?raw";
import tasksSearchAndPaginationStringsSql from "../migrations/0151_tasks_search_and_pagination_strings.sql?raw";
import lineLevelAccountCodingFieldLabelsSql from "../migrations/0152_line_level_account_coding_field_labels.sql?raw";
import costObjectPriorityStringsSql from "../migrations/0153_cost_object_priority_strings.sql?raw";
import lineCodingPopoutStringsSql from "../migrations/0154_line_coding_popout_strings.sql?raw";
import codingSuggestionStringSql from "../migrations/0155_coding_suggestion_string.sql?raw";
import codingResultsLabelStringSql from "../migrations/0156_coding_results_label_string.sql?raw";
import codingNomatchesScopedStringSql from "../migrations/0157_coding_nomatches_scoped_string.sql?raw";
import addPersonToConversationStringsSql from "../migrations/0158_add_person_to_conversation_strings.sql?raw";
import businessApproverApproveActionStringSql from "../migrations/0159_business_approver_approve_action_string.sql?raw";
import matchingTabStringsSql from "../migrations/0160_matching_tab_strings.sql?raw";
import standardMatchingRulesStringsSql from "../migrations/0161_standard_matching_rules_strings.sql?raw";
import removeCollaboratorStringsSql from "../migrations/0162_remove_collaborator_strings.sql?raw";
import openTaskReasonStringsSql from "../migrations/0163_open_task_reason_strings.sql?raw";
import newSellerAndErpReleaseStringsSql from "../migrations/0164_new_seller_and_erp_release_strings.sql?raw";
import stageRestrictionsStringsSql from "../migrations/0165_stage_restrictions_strings.sql?raw";
import stageOffersRestrictionsStringsSql from "../migrations/0166_stage_offers_restrictions_strings.sql?raw";
import stageReverifyRuleStringsSql from "../migrations/0167_stage_reverify_rule_strings.sql?raw";
import taskActionEventsStringsSql from "../migrations/0168_task_action_events_strings.sql?raw";
import reassignStringsSql from "../migrations/0169_reassign_strings.sql?raw";
import returnTargetStringsSql from "../migrations/0170_return_target_strings.sql?raw";
import noteOkStringSql from "../migrations/0171_note_ok_string.sql?raw";
import reassignNonefoundWordingSql from "../migrations/0172_reassign_nonefound_wording.sql?raw";
import recordSupplierButtonWordingSql from "../migrations/0173_record_supplier_button_wording.sql?raw";
import routeToApproverStringsSql from "../migrations/0174_route_to_approver_strings.sql?raw";
import routeToApproverCommentSql from "../migrations/0175_route_to_approver_comment.sql?raw";
import returnToSupplierPickerStringsSql from "../migrations/0176_return_to_supplier_picker_strings.sql?raw";

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
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(viewerHeadingSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(unclaimedSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(colonsSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(taskLineSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(signinFailureSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(documentUnitSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(sourceOrgSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(supplierScreenSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(supplierLoadErrorSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(sitePurposeSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(supplierPanelSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(sellerCardSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(sellerPhoneSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(supplierSearchSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(buyerCardSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(cardActionsSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(supplierDetailSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(awaitingErpSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(recordFromInvoiceSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(stateActionSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(activateCloseSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(loadNewSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(dashboardStringsSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(dashboardLibrarySql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(dueTodaySql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(cardNamesSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(whoHoldsSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(threeAlertsSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(moverPickerSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(showingOneStageSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(whatIActedOnSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(nameARuleSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(activityPanelSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(timelineChatTabSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(systemAlertLabelSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(unreadableWordingSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(xmlTabSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(navRestructureSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(backButtonWordingSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(moodButtonWordingSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(headerFieldsPopoutSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(paymentTermsFieldSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(supplierStatusCardSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(composeBackSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(dashboardHeadingRewordSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(rulesTableColumnSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(orgSwitcherStringsSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(roleManagementStringsSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(roleManagementLoadFailedSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(roleEditingStringsSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(roleAssignmentStringsSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(personCreationStringsSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(popoutActionRowStringsSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(teamsStringsSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(accessNavRenameSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(userPropertiesStringsSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(orgUnitManagementStringsSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(personRolesPropertiesSplitStringsSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(navGroupHeadingsStringsSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(sourcesActionIconsStringsSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(processManagementStringsSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(rulesProcessSelectorStringsSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(startDraftStringsSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(newDraftWordingSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(purchaseOrdersScreenStringsSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(purchaseOrdersListStringsSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(purchaseOrdersFormatReferenceStringsSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(purchaseOrdersButtonLabelsSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(purchaseOrdersOrgLabelSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(purchaseOrdersSearchAndPaginationStringsSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(purchaseOrdersStatusStringsSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(purchaseOrdersStatusHeadingWordingSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(suppliersSearchAndPaginationStringsSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(orgUnitVatidRenamedTaxIdentifierSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(documentViewerPageRendererStringsSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(documentWindowPopoutStringsSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(documentPlaceholderWordingSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(documentPageCyclingAndHighlightStringsSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(poMismatchCheckLabelSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(dashboardCardTitlesRewordedSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(documentsShowingExceptionsAndAgingSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(apSetupStringsSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(apSetupOverrideSearchStringsSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(accountCodingStringsSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(codingListCsvStringsSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(accountCodingSearchAndPaginationStringsSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(orgCompanyCodeNamingAlignmentSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(tasksSearchAndPaginationStringsSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(lineLevelAccountCodingFieldLabelsSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(costObjectPriorityStringsSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(lineCodingPopoutStringsSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(codingSuggestionStringSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(codingResultsLabelStringSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(codingNomatchesScopedStringSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(addPersonToConversationStringsSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(businessApproverApproveActionStringSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(matchingTabStringsSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(standardMatchingRulesStringsSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(removeCollaboratorStringsSql)));
  /**
   * **Migrations 0163–0165 were never added here** — found while
   * wiring in 0166 (decision 0485) and fixed alongside it, the same
   * "found again, fixed this time" discipline decision 0484 applied to
   * `vf-ui`'s own proxy allowlist. Left the test schema without these
   * three migrations' strings; nothing failed because none of their
   * new keys were added to `string-coverage.test.ts`'s own hand-kept
   * list either, so the gap was invisible to that check too.
   */
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(openTaskReasonStringsSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(newSellerAndErpReleaseStringsSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(stageRestrictionsStringsSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(stageOffersRestrictionsStringsSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(stageReverifyRuleStringsSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(taskActionEventsStringsSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(reassignStringsSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(returnTargetStringsSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(noteOkStringSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(reassignNonefoundWordingSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(recordSupplierButtonWordingSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(routeToApproverStringsSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(routeToApproverCommentSql)));
  await env.CONTROL_DB.exec(toOneStatementPerLine(stripSqlComments(returnToSupplierPickerStringsSql)));

}
