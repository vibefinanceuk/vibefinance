-- 0150_source_email_size_limit.sql — decision 0691.
--
-- An Email source's limit on what it accepts, and what the sender is told.
--
--   max_email_mb          the largest email accepted, in megabytes. A larger
--                         one is refused while it arrives: nothing is stored
--                         or read, and the sender's mail system returns our
--                         message to them. NULL is the default, 10 MB.
--                         Cloudflare's own limit is 25 MB, so nothing larger.
--   email_reject_message  this source's own wording for that message, which
--                         overrides the default kept in Interface wording
--                         (`email.reject.toolarge`). NULL uses the default.
--                         {size} and {limit} are filled in.

ALTER TABLE sources ADD COLUMN max_email_mb INTEGER CHECK (max_email_mb IS NULL OR (max_email_mb BETWEEN 1 AND 25));
ALTER TABLE sources ADD COLUMN email_reject_message TEXT CHECK (email_reject_message IS NULL OR length(email_reject_message) <= 500);

-- ASSERT ALWAYS: SELECT count(*) FROM sources WHERE max_email_mb IS NOT NULL AND (max_email_mb < 1 OR max_email_mb > 25) == 0
