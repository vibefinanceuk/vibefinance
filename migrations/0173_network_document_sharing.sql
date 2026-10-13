-- 0173_network_document_sharing.sql — decision 0770.
--
-- **Suppliers see the documents they sent.** In the supplier network, an
-- invoice or credit note shows the file the customer received (the
-- supplier's own PDF, or the page drawn from their e-invoice) and lists
-- that file to download. Never the email it came in, nor other files sent
-- with it.
--
-- On by default, since the document is the supplier's own. AP Setup ›
-- Supplier Network can turn it off, for a customer whose scanned invoices
-- carry its own stamps and notes.

ALTER TABLE network_sharing_config ADD COLUMN share_documents INTEGER NOT NULL DEFAULT 1 CHECK (share_documents IN (0, 1));

-- ASSERT: SELECT count(*) FROM network_sharing_config WHERE share_documents != 1 == 0
