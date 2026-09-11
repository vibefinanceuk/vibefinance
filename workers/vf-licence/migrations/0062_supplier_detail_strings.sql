-- 0062_supplier_detail_strings.sql
-- Decision 0230 — a supplier, and what may be done to it.
--
-- **`holdaction`, not `hold`.** The column header on the table already
-- owns `suppliers.hold`, and it reads *"Hold"* as a **state** — the
-- thing a row is in. This one is a **verb**, and one key cannot be both
-- without one of the two reading oddly.
--
-- **The warning says what will happen, not what should have.** *"Data
-- changes should be made there"* invites somebody to wonder whether it
-- matters; *"the next load will overwrite this"* answers it.
INSERT INTO ui_strings (key, locale, value) VALUES
 ('suppliers.holdaction', 'en', 'Hold supplier'),
 ('suppliers.release', 'en', 'Release hold'),
 ('suppliers.activate', 'en', 'Activate'),
 ('suppliers.deactivate', 'en', 'Deactivate'),
 ('suppliers.holdreason', 'en', 'Why is this supplier being held?'),
 ('suppliers.holdreasonhint', 'en', 'Reason, e.g. invoice under dispute'),
 ('suppliers.holdconfirm', 'en', 'Hold supplier'),
 ('suppliers.save', 'en', 'Save changes'),
 ('suppliers.saveanyway', 'en', 'Save here anyway'),
 ('suppliers.mastersays', 'en', 'Your ERP is the master for supplier data. Changes made here will be overwritten by the next supplier file you load, so make them in the ERP as well.'),
 ('suppliers.changefailed', 'en', 'That change could not be saved.');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('suppliers.holdaction', 'de', 'Lieferant sperren'),
 ('suppliers.release', 'de', 'Sperre aufheben'),
 ('suppliers.activate', 'de', 'Aktivieren'),
 ('suppliers.deactivate', 'de', 'Deaktivieren'),
 ('suppliers.holdreason', 'de', 'Warum wird dieser Lieferant gesperrt?'),
 ('suppliers.holdreasonhint', 'de', 'Grund, z. B. Rechnung strittig'),
 ('suppliers.holdconfirm', 'de', 'Lieferant sperren'),
 ('suppliers.save', 'de', 'Änderungen speichern'),
 ('suppliers.saveanyway', 'de', 'Trotzdem hier speichern'),
 ('suppliers.mastersays', 'de', 'Ihr ERP ist die führende Quelle für Lieferantendaten. Hier vorgenommene Änderungen werden von der nächsten geladenen Lieferantendatei überschrieben — nehmen Sie sie daher auch im ERP vor.'),
 ('suppliers.changefailed', 'de', 'Diese Änderung konnte nicht gespeichert werden.');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('suppliers.holdaction','suppliers.release','suppliers.activate','suppliers.deactivate','suppliers.holdreason','suppliers.holdreasonhint','suppliers.holdconfirm','suppliers.save','suppliers.saveanyway','suppliers.mastersays','suppliers.changefailed') == 22
