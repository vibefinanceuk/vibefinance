-- 0154_line_coding_popout_strings.sql
-- The invoice-line Coding pop-out — decision 0453.
--
-- The operator's own ask: *"a pop-out, that is accessible from a
-- Coding icon on the invoice line... show the Org / Company Code and
-- optional Cost Center or Project, then provide the linked Commodity
-- and General Ledger Code. Each should expose a searchable drop-down
-- that searches across the already created Account Coding lists."*
--
-- **Every field's own label is reused, not restated here.** Company
-- Code is `apsetup.codingtab.companycode` (migration 0150's own "Org /
-- Company Code" — literally the operator's own words, already seeded);
-- Cost Centre/Project/Commodity Code/General Ledger Code are
-- `field.bt-133`/`field.coding.project`/`field.coding.commodity_code`/
-- `field.coding.gl_code` (migrations 0020/0152), the same labels the
-- line table's own column headers already carry. Only the pop-out's
-- own new chrome needs new keys: the icon that opens it, its heading,
-- and the search box's own states — the same shape `viewer.supplier.*`
-- (migration 0059) already established for `openSearch()`.
INSERT INTO ui_strings (key, locale, value) VALUES
 ('action.coding', 'en', 'Coding'),
 ('viewer.coding.heading', 'en', 'Line coding'),
 ('viewer.coding.searchhint', 'en', 'Type to search'),
 ('viewer.coding.nomatches', 'en', 'Nothing on file matches that.'),
 ('viewer.coding.searchfailed', 'en', 'We could not reach the service to search.'),
 ('viewer.coding.clear', 'en', 'Clear'),
 ('viewer.coding.noteditable', 'en', 'Not editable at this stage');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('action.coding', 'de', 'Kontierung'),
 ('viewer.coding.heading', 'de', 'Zeilenkontierung'),
 ('viewer.coding.searchhint', 'de', 'Zum Suchen tippen'),
 ('viewer.coding.nomatches', 'de', 'Dazu passt nichts Hinterlegtes.'),
 ('viewer.coding.searchfailed', 'de', 'Der Suchdienst war nicht erreichbar.'),
 ('viewer.coding.clear', 'de', 'Leeren'),
 ('viewer.coding.noteditable', 'de', 'In dieser Phase nicht bearbeitbar');

-- Point-in-time: every key exists in both seeded languages.
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('action.coding','viewer.coding.heading','viewer.coding.searchhint','viewer.coding.nomatches','viewer.coding.searchfailed','viewer.coding.clear','viewer.coding.noteditable') == 14
