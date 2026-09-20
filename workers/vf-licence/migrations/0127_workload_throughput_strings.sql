-- 0127_workload_throughput_strings.sql
--
-- Decision 0415 — the Workload screen, the first real route and UI
-- backed by `AP.Analysis`. "In order to make this a reality — what
-- would you start with?" / "let's go!": the vertical slice is the
-- Management Dashboard design's own "Throughput by user, stacked by
-- stage" chart, built for real rather than mocked up.
INSERT INTO ui_strings (key, locale, value) VALUES
 ('nav.workload', 'en', 'Workload'),
 ('workload.heading', 'en', 'Workload'),
 ('workload.sub', 'en', 'Team throughput by stage'),
 ('workload.throughput', 'en', 'Throughput by user'),
 ('workload.throughputsub', 'en', 'Completed in the last 7 days, stacked by stage'),
 ('workload.nothroughput', 'en', 'Nothing completed in the last 7 days');

INSERT INTO ui_strings (key, locale, value) VALUES
 ('nav.workload', 'de', 'Auslastung'),
 ('workload.heading', 'de', 'Auslastung'),
 ('workload.sub', 'de', 'Teamdurchsatz nach Phase'),
 ('workload.throughput', 'de', 'Durchsatz nach Benutzer'),
 ('workload.throughputsub', 'de', 'Abgeschlossen in den letzten 7 Tagen, gestapelt nach Phase'),
 ('workload.nothroughput', 'de', 'In den letzten 7 Tagen nichts abgeschlossen');

-- ASSERT: SELECT count(*) FROM ui_strings WHERE key IN ('nav.workload','workload.heading','workload.sub','workload.throughput','workload.throughputsub','workload.nothroughput') == 12
