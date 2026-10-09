-- 0314_supplier_layout_strings.sql
-- Decision 0702 — each supplier's invoice layout is learned from where its
-- invoices' values were. The viewer's "usually here", and what a supplier's
-- page says has been learned.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('viewer.layout.usually', 'en', 'Usually here for this supplier'),
 ('viewer.layout.usually', 'de', 'Bei diesem Lieferanten meist hier'),
 ('suppliers.layouts.title', 'en', 'Invoice layouts learned'),
 ('suppliers.layouts.title', 'de', 'Gelernte Rechnungslayouts'),
 ('suppliers.layouts.none', 'en', 'Nothing learned yet: it learns as this supplier''s invoices are worked on.'),
 ('suppliers.layouts.none', 'de', 'Noch nichts gelernt: Es lernt, während die Rechnungen dieses Lieferanten bearbeitet werden.'),
 ('suppliers.layouts.summary', 'en', '{layouts} layout(s), learned from {invoices} invoices'),
 ('suppliers.layouts.summary', 'de', '{layouts} Layout(s), gelernt aus {invoices} Rechnungen'),
 ('suppliers.layouts.fields', 'en', 'Knows where to find: {fields}'),
 ('suppliers.layouts.fields', 'de', 'Weiß, wo zu finden: {fields}'),
 ('suppliers.layouts.forget', 'en', 'Forget what was learned'),
 ('suppliers.layouts.forget', 'de', 'Gelerntes vergessen'),
 ('suppliers.layouts.forgotten', 'en', 'Forgotten. It learns again from invoices worked on from now.'),
 ('suppliers.layouts.forgotten', 'de', 'Vergessen. Es lernt neu aus Rechnungen, die ab jetzt bearbeitet werden.');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key = 'viewer.layout.usually' OR key LIKE 'suppliers.layouts.%' == 14
