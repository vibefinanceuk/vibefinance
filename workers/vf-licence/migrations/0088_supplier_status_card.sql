-- 0088_supplier_status_card.sql
-- Decision 0299 — a Supplier status card, beside the load-file card,
-- reusing charts.js's own donutChart component. Bucket labels for the
-- ring's own legend, and a dynamic "showing X only" banner matching
-- documents.js's own `documents.showing.${key}` pattern.
INSERT INTO ui_strings (key, locale, value) VALUES
  ('suppliers.statusheading', 'en', 'Supplier status'),
  ('suppliers.status.active', 'en', 'Active'),
  ('suppliers.status.inactive', 'en', 'Inactive'),
  ('suppliers.status.onhold', 'en', 'On hold'),
  ('suppliers.status.awaitingerp', 'en', 'Awaiting ERP'),
  ('suppliers.allsuppliers', 'en', 'All suppliers'),
  ('suppliers.showing.active', 'en', 'Showing active suppliers only'),
  ('suppliers.showing.inactive', 'en', 'Showing inactive suppliers only'),
  ('suppliers.showing.onhold', 'en', 'Showing suppliers on hold only'),
  ('suppliers.showing.awaitingerp', 'en', 'Showing suppliers awaiting the ERP only'),
  ('suppliers.nonefiltered', 'en', 'No suppliers match this filter.'),
  ('suppliers.statusheading', 'de', 'Lieferantenstatus'),
  ('suppliers.status.active', 'de', 'Aktiv'),
  ('suppliers.status.inactive', 'de', 'Inaktiv'),
  ('suppliers.status.onhold', 'de', 'Gesperrt'),
  ('suppliers.status.awaitingerp', 'de', 'Ohne ERP-Kennung'),
  ('suppliers.allsuppliers', 'de', 'Alle Lieferanten'),
  ('suppliers.showing.active', 'de', 'Zeigt nur aktive Lieferanten'),
  ('suppliers.showing.inactive', 'de', 'Zeigt nur inaktive Lieferanten'),
  ('suppliers.showing.onhold', 'de', 'Zeigt nur gesperrte Lieferanten'),
  ('suppliers.showing.awaitingerp', 'de', 'Zeigt nur Lieferanten ohne ERP-Kennung'),
  ('suppliers.nonefiltered', 'de', 'Kein Lieferant entspricht diesem Filter.');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key LIKE 'suppliers.status.%' OR key = 'suppliers.statusheading' OR key LIKE 'suppliers.showing.%' OR key IN ('suppliers.allsuppliers','suppliers.nonefiltered') == 22
