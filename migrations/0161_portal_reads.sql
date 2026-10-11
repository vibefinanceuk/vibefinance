-- 0161_portal_reads.sql — decision 0728.
--
-- When each person in the supplier network last opened each invoice, so the
-- network can show messages from the customer as unread until they do. Kept
-- here, in the customer's own instance, by the person's link (one per
-- person per customer, from vf-licence): the network itself keeps nothing.

CREATE TABLE portal_reads (
  link_id    TEXT NOT NULL,
  invoice_id TEXT NOT NULL REFERENCES invoice_headers(id),
  read_at    TEXT NOT NULL,
  PRIMARY KEY (link_id, invoice_id)
);

-- ASSERT: SELECT count(*) FROM portal_reads == 0
