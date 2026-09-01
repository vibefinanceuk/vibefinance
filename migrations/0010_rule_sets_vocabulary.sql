-- 0010_rule_sets_vocabulary.sql
-- Which closed field vocabulary a rule set's rules compile and
-- validate against. See docs/decisions/0022-expense-vocabulary.md and
-- decision 0015's own flagged prerequisite: "each process definition
-- would declare which field vocabulary its rules compile against...
-- validateRule(), isKnownField()... currently check against ONE
-- global, module-level vocabulary. This has to become parameterized."
-- shared/interpreter/vocabulary.ts's VOCABULARIES registry is the
-- code-level closed set this column's own values must stay within —
-- the same relationship rule_sets.status or CIUS_PROFILES already
-- have to their own code-defined closed lists.
--
-- Defaulted to 'invoice' so every rule set that existed before this
-- migration is correctly, automatically tagged as what it always was
-- — every rule_set built by this system so far was built for AP or
-- AR, both genuinely EN 16931 invoices under decision 0021's own
-- confirmed finding.

ALTER TABLE rule_sets ADD COLUMN vocabulary TEXT NOT NULL DEFAULT 'invoice';

-- Standing invariant: closed to the vocabularies this codebase
-- actually knows how to compile and validate against — a typo or a
-- vocabulary named here that vocabulary.ts's own VOCABULARIES
-- registry doesn't recognize would silently validate every rule in
-- that rule set against nothing, the same class of silent-wrong-
-- answer failure this project has been careful to avoid everywhere
-- else.
-- ASSERT ALWAYS: SELECT count(*) FROM rule_sets WHERE vocabulary NOT IN ('invoice', 'expense') == 0
