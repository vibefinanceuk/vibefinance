-- 0231_rename_source_strings.sql
-- Decision 0583. A source can be renamed after invoices arrived through it,
-- unless a rule names it as the channel: the rename pop-out says what a
-- rename changes, and names the rules or the clash when refused.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('sources.renamehint', 'en', 'The name is what people read. The address never changes, and invoices already received keep the name they arrived under.'),
 ('sources.renamehint', 'de', 'Der Name ist, was angezeigt wird. Die Adresse ändert sich nie, und bereits eingegangene Rechnungen behalten den Namen, unter dem sie eingingen.'),
 ('sources.renamerules', 'en', 'These rules test for this source''s name as the channel: {rules}. Change them to the new name, or end them, then rename.'),
 ('sources.renamerules', 'de', 'Diese Regeln prüfen auf den Namen dieser Quelle als Kanal: {rules}. Ändern Sie sie auf den neuen Namen oder beenden Sie sie, dann umbenennen.'),
 ('sources.renametaken', 'en', 'Another source in this process already has that name.'),
 ('sources.renametaken', 'de', 'Eine andere Quelle in diesem Prozess hat bereits diesen Namen.');

-- 0582's Create the address said a source could be renamed only until
-- invoices arrived through it, which 0583 lifts.
UPDATE ui_strings SET value = 'Suppliers send invoices for {name} to this address. It cannot be changed once created, so choose the mailbox name with care. The source''s name is only what people read here, and can be renamed at any time.' WHERE key = 'processroutes.createaddresssub' AND locale = 'en';
UPDATE ui_strings SET value = 'Lieferanten senden Rechnungen für {name} an diese Adresse. Sie kann nach dem Erstellen nicht geändert werden, wählen Sie den Postfachnamen also mit Bedacht. Der Name der Quelle ist nur, was hier angezeigt wird, und kann jederzeit umbenannt werden.' WHERE key = 'processroutes.createaddresssub' AND locale = 'de';

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('sources.renamehint','sources.renamerules','sources.renametaken') == 6
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key = 'processroutes.createaddresssub' AND value LIKE '%until invoices%' == 0
