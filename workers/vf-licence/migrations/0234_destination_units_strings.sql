-- 0234_destination_units_strings.sql
-- Decisions 0587 and 0588. A Destination's business units, and the rule
-- action that also sends an invoice to a Destination.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('destunits.label', 'en', 'Business units'),
 ('destunits.label', 'de', 'Geschäftseinheiten'),
 ('destunits.all', 'en', 'All business units'),
 ('destunits.all', 'de', 'Alle Geschäftseinheiten'),
 ('destunits.choose', 'en', 'Choose'),
 ('destunits.choose', 'de', 'Auswählen'),
 ('destunits.title', 'en', 'Which business units it sends for'),
 ('destunits.title', 'de', 'Für welche Geschäftseinheiten gesendet wird'),
 ('destunits.sub', 'en', 'An invoice goes to each destination that covers its business unit. A unit includes every unit beneath it. With more than one ERP, give each its own units. A rule at the stage invoices are sent from can also send one here.'),
 ('destunits.sub', 'de', 'Eine Rechnung geht an jedes Ziel, das ihre Geschäftseinheit abdeckt. Eine Einheit umfasst alle Einheiten darunter. Bei mehr als einem ERP erhält jedes seine eigenen Einheiten. Eine Regel in der Stufe, aus der Rechnungen gesendet werden, kann zusätzlich eine hierher senden.'),
 ('destunits.chooseone', 'en', 'Choose at least one business unit, or All business units.'),
 ('destunits.chooseone', 'de', 'Wählen Sie mindestens eine Geschäftseinheit oder Alle Geschäftseinheiten.'),
 ('destunits.waiting', 'en', '{n} invoices are already waiting in the units added. Save again once you have chosen:'),
 ('destunits.waiting', 'de', '{n} Rechnungen warten bereits in den hinzugefügten Einheiten. Speichern Sie erneut, nachdem Sie gewählt haben:'),
 ('destunits.setaside', 'en', 'Set them aside, and send only invoices from now on'),
 ('destunits.setaside', 'de', 'Zurückstellen und nur Rechnungen ab jetzt senden'),
 ('destunits.sendtoo', 'en', 'Send them too'),
 ('destunits.sendtoo', 'de', 'Auch diese senden'),
 ('httpsout.error.unknown_unit', 'en', 'That business unit no longer exists.'),
 ('httpsout.error.unknown_unit', 'de', 'Diese Geschäftseinheit existiert nicht mehr.'),
 ('action.send_to_destination', 'en', 'Also send to a destination'),
 ('action.send_to_destination', 'de', 'Zusätzlich an ein Ziel senden');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('destunits.label','destunits.all','destunits.choose','destunits.title','destunits.sub','destunits.chooseone','destunits.waiting','destunits.setaside','destunits.sendtoo','httpsout.error.unknown_unit','action.send_to_destination') == 22
