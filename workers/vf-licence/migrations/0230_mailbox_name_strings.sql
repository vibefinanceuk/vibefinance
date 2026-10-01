-- 0230_mailbox_name_strings.sql
-- Decision 0582. An email source's address is created with a mailbox name
-- chosen and previewed, apart from the source's name, and the screen's help.

INSERT INTO ui_strings (key, locale, value) VALUES
 ('processroutes.createaddress', 'en', 'Create the address'),
 ('processroutes.createaddress', 'de', 'Adresse erstellen'),
 ('processroutes.createaddresssub', 'en', 'Suppliers send invoices for {name} to this address. It cannot be changed once created, so choose the mailbox name with care. The source''s name is only what people read here, and can be renamed until invoices arrive through it.'),
 ('processroutes.createaddresssub', 'de', 'Lieferanten senden Rechnungen für {name} an diese Adresse. Sie kann nach dem Erstellen nicht geändert werden, wählen Sie den Postfachnamen also mit Bedacht. Der Name der Quelle ist nur, was hier angezeigt wird, und kann umbenannt werden, bis Rechnungen darüber eingehen.'),
 ('processroutes.mailbox', 'en', 'Mailbox name'),
 ('processroutes.mailbox', 'de', 'Postfachname'),
 ('processroutes.mailboxhint', 'en', 'Letters, numbers, hyphens and dots. Your company''s own part is added after it, so it can never clash with anyone else''s.'),
 ('processroutes.mailboxhint', 'de', 'Buchstaben, Ziffern, Bindestriche und Punkte. Der eigene Teil Ihres Unternehmens wird angehängt, sodass sie nie mit einer anderen kollidieren kann.'),
 ('processroutes.willbe', 'en', 'The address will be'),
 ('processroutes.willbe', 'de', 'Die Adresse wird'),
 ('processroutes.mailboxtaken', 'en', 'Another of your sources already has that address. Choose a different mailbox name.'),
 ('processroutes.mailboxtaken', 'de', 'Eine andere Ihrer Quellen hat diese Adresse bereits. Wählen Sie einen anderen Postfachnamen.'),
 ('processroutes.mailboxunusable', 'en', 'A mailbox name needs letters or numbers, and the address at most 64 characters before the @.'),
 ('processroutes.mailboxunusable', 'de', 'Ein Postfachname braucht Buchstaben oder Ziffern, und die Adresse höchstens 64 Zeichen vor dem @.');

UPDATE ui_strings SET value = 'Where each process takes information in and sends it out. Sources deliver to the process''s first stage, Destinations read from its last. Choose a source to give it an address, set its org, rename or retire it, or add a new one. An email source''s address is created with a mailbox name you choose, and its name is only what people read. An HTTPS source has its own address and keys: make a key for each system that sends, shown once. Replace a lost key with a new one of the same name, and revoke one without stopping the others.' WHERE key = 'help.screen.processroutes' AND locale = 'en';
UPDATE ui_strings SET value = 'Wo jeder Prozess Informationen aufnimmt und abgibt. Quellen liefern an die erste Stufe des Prozesses, Ziele lesen aus der letzten. Wählen Sie eine Quelle, um ihr eine Adresse zu geben, ihre Organisation festzulegen, sie umzubenennen oder stillzulegen, oder fügen Sie eine neue hinzu. Die Adresse einer E-Mail-Quelle wird mit einem Postfachnamen Ihrer Wahl erstellt, und ihr Name ist nur, was angezeigt wird. Eine HTTPS-Quelle hat eine eigene Adresse und Schlüssel: Erstellen Sie einen Schlüssel für jedes sendende System, einmal angezeigt. Ersetzen Sie einen verlorenen Schlüssel durch einen neuen mit demselben Namen, und widerrufen Sie einen, ohne die anderen anzuhalten.' WHERE key = 'help.screen.processroutes' AND locale = 'de';

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('processroutes.createaddress','processroutes.createaddresssub','processroutes.mailbox','processroutes.mailboxhint','processroutes.willbe','processroutes.mailboxtaken','processroutes.mailboxunusable') == 14
-- ASSERT: SELECT count(*) FROM ui_strings WHERE key = 'help.screen.processroutes' AND value LIKE '%mailbox name you choose%' == 1
