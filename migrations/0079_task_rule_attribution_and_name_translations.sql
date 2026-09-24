-- 0079_task_rule_attribution_and_name_translations.sql
-- "Why is this task here" — decision 0478. Two additive pieces, zero
-- behaviour change on deploy: every existing task and rule keeps
-- working exactly as it does today until the UI built on top of these
-- actually reads them.

-- **Which rule raised this task — decision 0478's own gap.**
-- `evaluateRuleSet` (shared/interpreter/evaluate.ts) has always known
-- this, via `attributedActions`; `workflow-engine.ts`'s own
-- `assign_task` handling only ever read the older, unattributed
-- `actions` list, discarding the rule id before a task was even
-- created. Nullable, the same reasoning `stage_visit_id` already
-- carries (0009): a task raised directly via the manual/API path
-- (task-route.ts's own POST /tasks) has no rule to name.
ALTER TABLE tasks ADD COLUMN rule_id TEXT REFERENCES rules(id);

-- **A rule's own display name, per locale — decision 0478.** Not a
-- second copy of `rules.name`: this is what a viewer sees INSTEAD of
-- it, when their own locale has one, exactly the same "the resolver
-- supplies it, nothing here invents one" shape decision 0200 already
-- gave `process_stages.required_permission`. A rule with no row here
-- for a locale shows its own author's name unchanged — the safe,
-- unsurprising default, never a blank.
--
-- Deliberately separate from the closed, code-known UI string table
-- (vf-licence's own `strings` — every `activity.*`/`purchaseorders.*`
-- key this whole session has added) rather than folded into it: a
-- rule's name is a customer's own data, created and edited at
-- runtime, not a fixed vocabulary the codebase defines ahead of time.
-- The four standard matching rules are the one exception — their
-- names ARE code-known constants (`STANDARD_MATCHING_RULES` in
-- matching-config-route.ts) and are translated through the ordinary
-- string table instead, keyed by the rule's own stable `key`
-- ("po_line_not_found", etc.), not through this table at all.
CREATE TABLE rule_name_translations (
  rule_id TEXT NOT NULL REFERENCES rules(id),
  locale  TEXT NOT NULL,
  name    TEXT NOT NULL,
  PRIMARY KEY (rule_id, locale)
);

-- Point-in-time: no task has a rule yet, no rule has a translation yet.
-- ASSERT: SELECT count(*) FROM tasks WHERE rule_id IS NOT NULL == 0
-- ASSERT: SELECT count(*) FROM rule_name_translations == 0

-- Standing invariant: a task's own rule, when set, is a real rule —
-- the foreign key already says so, restated the same way 0078's own
-- buyer_user_id invariant is.
-- ASSERT ALWAYS: SELECT count(*) FROM tasks WHERE rule_id IS NOT NULL AND rule_id NOT IN (SELECT id FROM rules) == 0

-- Standing invariant: a translation names a real rule.
-- ASSERT ALWAYS: SELECT count(*) FROM rule_name_translations WHERE rule_id NOT IN (SELECT id FROM rules) == 0

-- Standing invariant: a translation's locale is one this deployment
-- actually knows — i18n.ts's own SUPPORTED_LOCALES, restated here the
-- same doubled-up way the permission vocabulary already is (0048 and
-- since), so a typo'd locale is a refused write, not silent dead data
-- nothing ever reads back.
-- ASSERT ALWAYS: SELECT count(*) FROM rule_name_translations WHERE locale NOT IN ('en','de','fr','es','it','nl') == 0
