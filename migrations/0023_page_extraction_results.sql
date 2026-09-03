-- 0023_page_extraction_results.sql
-- Decision 0047 — extract each page as it is uploaded.
--
-- Established by a controlled test, not by reasoning. Page 1 alone,
-- through this same path with the same R2 round-trip and the same
-- per-page prompt, extracts perfectly: all eight line items. Page 1
-- followed by page 2 times out ON PAGE 1, which runs first.
--
-- So neither storage nor the prompt is at fault. A single Worker
-- request cannot reliably make two large inference calls, whatever
-- the underlying limit is -- concurrency, rate, or a budget the
-- runtime allocates across the request once it knows more work is
-- queued.
--
-- The fix is to stop trying. Each page is extracted in its OWN
-- request, at upload time, and the result is stored here. Finalise
-- then merges what already exists and makes no model call at all.
--
-- Better architecture regardless of the limit that forced it:
-- uploads are naturally spread over time, every page gets a full
-- request budget, and finalise becomes fast and deterministic.
ALTER TABLE pending_document_pages ADD COLUMN extraction_json TEXT;

-- Why a page failed, when it did. A page that could not be read does
-- not sink the document -- the others may carry everything needed --
-- but the reason has to survive to finalise, because a missing page
-- is exactly why a total might not match its lines.
ALTER TABLE pending_document_pages ADD COLUMN extraction_error TEXT;

ALTER TABLE pending_document_pages ADD COLUMN extracted_at TEXT;

-- Standing invariant: a page is never both extracted and failed. The
-- two come from the same operation, so recording both would mean the
-- row was written by something other than that operation.
-- ASSERT ALWAYS: SELECT count(*) FROM pending_document_pages WHERE extraction_json IS NOT NULL AND extraction_error IS NOT NULL == 0

-- Standing invariant: a timestamp accompanies any outcome, and never
-- appears without one. An extracted_at with neither a result nor an
-- error would claim work happened while recording nothing about it.
-- ASSERT ALWAYS: SELECT count(*) FROM pending_document_pages WHERE extracted_at IS NOT NULL AND extraction_json IS NULL AND extraction_error IS NULL == 0
-- ASSERT ALWAYS: SELECT count(*) FROM pending_document_pages WHERE extracted_at IS NULL AND (extraction_json IS NOT NULL OR extraction_error IS NOT NULL) == 0

-- Standing invariant: a stored extraction is always real JSON. It is
-- parsed at finalise, and a malformed value would fail there --
-- after the upload that produced it has long returned, where it is
-- far harder to attribute.
-- ASSERT ALWAYS: SELECT count(*) FROM pending_document_pages WHERE extraction_json IS NOT NULL AND json_valid(extraction_json) = 0 == 0
