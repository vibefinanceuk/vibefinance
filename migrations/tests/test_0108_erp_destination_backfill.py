"""Decision 0558: migration 0108 on a database that already has ERP exports.

Two exports of one process's invoices, one of them undone, then 0108:
each becomes an outbound message on the process's ERP Destination, with
its invoices and history, the undone one closed with its reason.
"""

import sqlite3
import unittest
from pathlib import Path

MIGRATIONS = Path(__file__).resolve().parent.parent


def chain_until(db, last):
    for path in sorted(MIGRATIONS.glob("[0-9][0-9][0-9][0-9]_*.sql")):
        if int(path.name[:4]) > last:
            break
        db.executescript(path.read_text())


class ErpDestinationBackfill(unittest.TestCase):
    def test_backfill(self):
        db = sqlite3.connect(":memory:")
        db.execute("PRAGMA foreign_keys = ON")
        chain_until(db, 107)
        db.executescript(
            """
            INSERT INTO org_users (id, email, name) VALUES ('u-dan', 'dan@example.com', 'Dan');
            INSERT INTO processes (id, name) VALUES ('ap', 'Standard AP Process');
            INSERT INTO process_stages (id, process_id, name, sequence) VALUES ('eligible', 'ap', 'Payment Eligible', 1);
            INSERT INTO invoice_headers (id, facts_json) VALUES ('inv-1', '{}'), ('inv-2', '{}');
            INSERT INTO process_instances (id, process_id, subject_type, subject_id, current_stage_id, status) VALUES
              ('pi-1', 'ap', 'invoice', 'inv-1', 'eligible', 'completed'),
              ('pi-2', 'ap', 'invoice', 'inv-2', 'eligible', 'completed');
            INSERT INTO erp_exports (id, created_by, created_at, invoice_count, row_count) VALUES
              ('7f3a2291-0c4e-4b1a-9d2e-000000000001', 'u-dan', '2026-09-28 10:15:02.123', 1, 2),
              ('aa11bb22-cc33-4d44-8e55-000000000002', 'u-dan', '2026-09-29 09:02:11.000', 1, 1);
            UPDATE erp_exports SET reversed_at = '2026-09-28 16:40:00.000', reversed_by = 'u-dan', reverse_reason = 'GL code 1610 is closed'
              WHERE id LIKE '7f3a%';
            INSERT INTO erp_export_rows (export_id, seq, invoice_id, row_json) VALUES
              ('7f3a2291-0c4e-4b1a-9d2e-000000000001', 1, 'inv-1', '{}'),
              ('7f3a2291-0c4e-4b1a-9d2e-000000000001', 2, 'inv-1', '{}'),
              ('aa11bb22-cc33-4d44-8e55-000000000002', 1, 'inv-2', '{}');
            INSERT INTO erp_export_invoices (invoice_id, export_id) VALUES ('inv-2', 'aa11bb22-cc33-4d44-8e55-000000000002');
            """
        )
        # No source, so 0107 gave this process no ERP Destination: 0108 does.
        self.assertEqual(db.execute("SELECT count(*) FROM route_instances").fetchone(), (0,))
        db.executescript((MIGRATIONS / "0108_erp_destination_messages.sql").read_text())

        self.assertEqual(db.execute("SELECT id, route_id, name FROM route_instances").fetchall(), [("erp-ap", "erp-csv", "ERP")])
        rows = db.execute(
            "SELECT id, destination_id, direction, status, failed_part, error_code, error_text, received_at FROM route_messages ORDER BY received_at"
        ).fetchall()
        self.assertEqual(
            rows,
            [
                ("MSG-7F3A-2291-0C4E", "erp-ap", "out", "dismissed", "delivery", "undone", "GL code 1610 is closed", "2026-09-28T10:15:02.123Z"),
                ("MSG-AA11-BB22-CC33", "erp-ap", "out", "delivered", None, None, None, "2026-09-29T09:02:11.000Z"),
            ],
        )
        self.assertEqual(
            db.execute("SELECT message_id, item_id FROM route_message_items ORDER BY message_id").fetchall(),
            [("MSG-7F3A-2291-0C4E", "inv-1"), ("MSG-AA11-BB22-CC33", "inv-2")],
        )
        self.assertEqual(
            [r[0] for r in db.execute("SELECT event FROM route_message_events WHERE message_id = 'MSG-7F3A-2291-0C4E' ORDER BY seq")],
            ["exported", "delivered", "undone"],
        )
        self.assertEqual(db.execute("PRAGMA foreign_key_check").fetchall(), [])


if __name__ == "__main__":
    unittest.main()
