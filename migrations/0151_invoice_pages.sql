-- 0151_invoice_pages.sql — decision 0690.
--
-- The working pages of a scanned invoice: one greyscale JPEG per page, no
-- larger than 1600 pixels a side, made from the scan by Cloudflare Images.
-- They are what the model read and what the viewer shows. The PDF as it
-- arrived stays the invoice's `original` document.
--
-- **One image per page, with its size, for the lasso** (Dan, 8 October
-- 2026: "I would like to enhance the document viewer to support lasso
-- functionality"). A region drawn on a page is in this image's pixels;
-- kept as fractions of the page (0–1), it maps to this image for cropping
-- and reading, and through original_width/original_height to the scan at
-- full resolution where a sharper crop is wanted.

CREATE TABLE invoice_pages (
  id              TEXT PRIMARY KEY,
  invoice_id      TEXT NOT NULL REFERENCES invoice_headers(id),
  page_number     INTEGER NOT NULL CHECK (page_number >= 1),
  r2_key          TEXT NOT NULL,
  content_type    TEXT NOT NULL,
  width           INTEGER NOT NULL CHECK (width > 0),
  height          INTEGER NOT NULL CHECK (height > 0),
  -- The page in the scan as it arrived, where it could be read.
  original_width  INTEGER,
  original_height INTEGER,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (invoice_id, page_number)
);

-- ASSERT: SELECT count(*) FROM invoice_pages == 0
