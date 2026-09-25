-- 0164_new_seller_and_erp_release_strings.sql
-- Decision 0480 — two additions:
--   - the New Seller form: a standalone button and popout beside
--     decision 0222/0233's existing supplier search, for the case that
--     search was never meant to cover (a supplier this tenant has
--     genuinely never seen before, not one already on file but hard to
--     find);
--   - the three code-known reasons an engine-created task (no rule
--     behind it) can land on the "Here because" banner — decision
--     0478's own reason line, extended by migration 0080's
--     `tasks.system_reason` to cover a task nothing authored. Same
--     shape as `matching.standardrule.*.name` in migration 0163:
--     these are platform constants, translated through this ordinary
--     string table, not through `rule_name_translations` (which
--     exists for a customer's own authored rule names).

INSERT INTO ui_strings (key, locale, value) VALUES
 ('viewer.supplier.newseller', 'en', 'New Seller'),
 ('viewer.supplier.newsellerheading', 'en', 'Record a new seller'),
 ('viewer.supplier.newsellerhint', 'en', 'Enter what the invoice itself tells you. A team will complete the setup with the ERP.'),
 ('viewer.supplier.namerequired', 'en', 'Company name is required.'),
 ('viewer.supplier.save', 'en', 'Save'),
 ('viewer.supplier.savefailed', 'en', 'Could not save this supplier. Try again.'),
 ('viewer.supplier.pounidentified', 'en', 'This invoice names a purchase order but no supplier could be matched. A purchase order cannot exist for a supplier that was never set up — this needs investigation, not a new record.'),
 ('workflow.systemreason.supplier_unidentified.name', 'en', 'Awaiting a new supplier record'),
 ('workflow.systemreason.supplier_awaiting_erp.name', 'en', 'Awaiting an ERP identifier for this supplier'),
 ('workflow.systemreason.po_supplier_unidentified.name', 'en', 'Purchase order references a supplier that was never set up');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('viewer.supplier.newseller', 'de', 'Neuer Lieferant'),
 ('viewer.supplier.newsellerheading', 'de', 'Neuen Lieferanten erfassen'),
 ('viewer.supplier.newsellerhint', 'de', 'Geben Sie ein, was die Rechnung selbst zeigt. Ein Team schließt die Einrichtung im ERP ab.'),
 ('viewer.supplier.namerequired', 'de', 'Firmenname ist erforderlich.'),
 ('viewer.supplier.save', 'de', 'Speichern'),
 ('viewer.supplier.savefailed', 'de', 'Dieser Lieferant konnte nicht gespeichert werden. Bitte erneut versuchen.'),
 ('viewer.supplier.pounidentified', 'de', 'Diese Rechnung nennt eine Bestellung, aber es konnte kein Lieferant zugeordnet werden. Eine Bestellung kann für einen nie angelegten Lieferanten nicht existieren — das erfordert eine Prüfung, keinen neuen Datensatz.'),
 ('workflow.systemreason.supplier_unidentified.name', 'de', 'Wartet auf einen neuen Lieferantendatensatz'),
 ('workflow.systemreason.supplier_awaiting_erp.name', 'de', 'Wartet auf eine ERP-Kennung für diesen Lieferanten'),
 ('workflow.systemreason.po_supplier_unidentified.name', 'de', 'Bestellung verweist auf einen nie angelegten Lieferanten');

-- Point-in-time: every key exists in both seeded languages.
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('viewer.supplier.newseller','viewer.supplier.newsellerheading','viewer.supplier.newsellerhint','viewer.supplier.namerequired','viewer.supplier.save','viewer.supplier.savefailed','viewer.supplier.pounidentified','workflow.systemreason.supplier_unidentified.name','workflow.systemreason.supplier_awaiting_erp.name','workflow.systemreason.po_supplier_unidentified.name') == 20
