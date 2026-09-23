-- 0157_coding_nomatches_scoped_string.sql
-- Reported live: General Ledger Code returning no rows from the Coding
-- pop-out "even though it seems to be populated" — decision 0459.
--
-- Traced to intended behaviour, not a bug: decision 0355 already
-- established "a missing filter is not everything" for this codebase,
-- and `coding-list-route.ts` has a dedicated, passing test for the
-- entry-level case of the same rule — an entry with no Company Code /
-- Commodity Code filter value set at all does not match a filtered
-- read, on purpose, the same as an entry scoped to a different value
-- would not. General Ledger Code's own zero rows almost certainly mean
-- its entries have not yet been given those filter values in AP Setup
-- → Account Coding, not that anything is broken.
--
-- What was actually missing was the pop-out's own silence about why —
-- a scoped field's empty result looked identical to an unscoped field
-- that genuinely has no matches. One new key, appended in `viewer.js`
-- after a comma-joined list of whichever of this field's own declared
-- filters are currently active (read live, the same as `filters()`
-- itself), naming what narrowed the search rather than leaving it to
-- be read as a plain failure.
INSERT INTO ui_strings (key, locale, value) VALUES
 ('viewer.coding.nomatchesscoped', 'en', 'Narrowed by:');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('viewer.coding.nomatchesscoped', 'de', 'Eingegrenzt durch:');

-- Point-in-time: the key exists in both seeded languages.
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key = 'viewer.coding.nomatchesscoped' == 2
