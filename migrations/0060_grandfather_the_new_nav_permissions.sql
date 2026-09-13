-- 0060_grandfather_the_new_nav_permissions.sql
--
-- Decision 0276 — three routes that had no permission check at all
-- before this bundle (GET /dashboard, GET /tasks, GET /suppliers) now
-- require AP.Dashboard, AP.TaskView and AP.Supplier respectively.
--
-- **Every existing role is granted all three here**, so a customer
-- already relying on any of these three screens does not lose access
-- the moment this ships — nobody who could already see a screen loses
-- that ability as a side effect of adding the vocabulary to describe
-- it. Restricting a specific role from a specific screen going
-- forward is deliberate, future work (the Role permissions screen the
-- operator has in mind), not something this migration should decide
-- on anyone's behalf.
--
-- **Admin.RuleManagement is deliberately NOT touched here.** Unlike
-- the three above, GET /rules and GET /rules/stages already had a
-- permission gate (AP.Review) and this bundle tightens it on purpose,
-- at the operator's own instruction: "tighten the API too." Granting
-- Admin.RuleManagement to every role that already has AP.Review would
-- defeat that instruction outright. Any role that should keep seeing
-- Rules needs Admin.RuleManagement granted explicitly, by the
-- operator, to the specific role that should have it — not by this
-- migration guessing which one that is.
--
-- The `NOT LIKE` guard makes each statement safe to reason about even
-- if a role already happened to carry one of these three permissions;
-- json_insert's own '$[#]' path always appends, so without the guard
-- a permission already present would be duplicated in the array.
UPDATE org_roles
SET permissions_json = json_insert(permissions_json, '$[#]', 'AP.Dashboard')
WHERE permissions_json NOT LIKE '%"AP.Dashboard"%';

UPDATE org_roles
SET permissions_json = json_insert(permissions_json, '$[#]', 'AP.TaskView')
WHERE permissions_json NOT LIKE '%"AP.TaskView"%';

UPDATE org_roles
SET permissions_json = json_insert(permissions_json, '$[#]', 'AP.Supplier')
WHERE permissions_json NOT LIKE '%"AP.Supplier"%';

-- Point-in-time: every role existing right now carries all three.
-- ASSERT: SELECT count(*) FROM org_roles WHERE permissions_json NOT LIKE '%"AP.Dashboard"%' OR permissions_json NOT LIKE '%"AP.TaskView"%' OR permissions_json NOT LIKE '%"AP.Supplier"%' == 0
