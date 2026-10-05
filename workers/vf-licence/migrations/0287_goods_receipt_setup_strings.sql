-- 0287_goods_receipt_setup_strings.sql
-- Decision 0643 — Goods receipts, slice 1: Receipting required on a
-- supplier, the ready-made AP Receiving role, and goods return reasons.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('suppliers.matchoption', 'en', 'How invoices are matched'),
 ('suppliers.matchoption', 'de', 'Wie Rechnungen abgeglichen werden'),
 ('suppliers.matchoption.unset', 'en', 'Not set'),
 ('suppliers.matchoption.unset', 'de', 'Nicht festgelegt'),
 ('suppliers.matchoption.two_way', 'en', 'Two-way: against the purchase order'),
 ('suppliers.matchoption.two_way', 'de', 'Zweifach: gegen die Bestellung'),
 ('suppliers.matchoption.three_way', 'en', 'Receipting required: the order and the goods receipt'),
 ('suppliers.matchoption.three_way', 'de', 'Wareneingang erforderlich: Bestellung und Wareneingang'),
 ('suppliers.matchoption.none', 'en', 'Not matched'),
 ('suppliers.matchoption.none', 'de', 'Kein Abgleich'),
 ('suppliers.receipting.short', 'en', 'Receipting required'),
 ('suppliers.receipting.short', 'de', 'Wareneingang erforderlich'),
 ('roles.readymade.receiving', 'en', 'Add the AP Receiving role'),
 ('roles.readymade.receiving', 'de', 'Rolle AP-Wareneingang hinzufügen'),
 ('roles.readymade.receivingname', 'en', 'AP Receiving'),
 ('roles.readymade.receivingname', 'de', 'AP-Wareneingang'),
 ('apsetup.goodsreturnreasons', 'en', 'Goods return reasons'),
 ('apsetup.goodsreturnreasons', 'de', 'Gründe für Warenrücksendungen'),
 ('apsetup.goodsreturnreasons.sub', 'en', 'Why goods were sent back to a supplier. Every return recorded against a goods receipt names one. Retire a reason rather than remove it: past returns keep showing it.'),
 ('apsetup.goodsreturnreasons.sub', 'de', 'Warum Ware an einen Lieferanten zurückging. Jede Rücksendung zu einem Wareneingang nennt einen Grund. Deaktivieren Sie einen Grund, statt ihn zu entfernen: Frühere Rücksendungen zeigen ihn weiterhin.');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('suppliers.matchoption', 'suppliers.matchoption.unset', 'suppliers.matchoption.two_way', 'suppliers.matchoption.three_way', 'suppliers.matchoption.none', 'suppliers.receipting.short', 'roles.readymade.receiving', 'roles.readymade.receivingname', 'apsetup.goodsreturnreasons', 'apsetup.goodsreturnreasons.sub') == 20

-- The agents' supplier question names three-way matching as the screens now do.
UPDATE ui_strings SET value = 'Receipting required' WHERE key = 'agents.qmatch.three_way' AND locale = 'en';
UPDATE ui_strings SET value = 'Wareneingang erforderlich' WHERE key = 'agents.qmatch.three_way' AND locale = 'de';

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key = 'agents.qmatch.three_way' AND value IN ('Receipting required', 'Wareneingang erforderlich') == 2
