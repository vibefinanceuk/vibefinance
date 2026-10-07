-- 0147_receipt_conversation_reads.sql — decision 0660.
--
-- When each person last caught up with a goods receipt's conversation:
-- opening its Timeline / Chat, or Done on the Conversations section of
-- Tasks. What came after (being added, or someone else writing) is what
-- that section shows them.

CREATE TABLE goods_receipt_reads (
  receipt_id TEXT NOT NULL REFERENCES goods_receipts(id),
  user_id    TEXT NOT NULL REFERENCES org_users(id),
  seen_at    TEXT NOT NULL,
  PRIMARY KEY (receipt_id, user_id)
);
CREATE INDEX idx_goods_receipt_reads_user ON goods_receipt_reads(user_id);

-- ASSERT: SELECT count(*) FROM goods_receipt_reads == 0
