"""Decision 0557: migration 0107 on a database that already has sources.

The replay runs the chain on an empty database, where the backfill has
nothing to do. This builds a populated one first: two processes (one with
stages and sources, one with neither), sources of several mechanisms, a
retired one, and a route message naming a source, then applies 0107 and
checks what it made.
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


class RoutesBackfill(unittest.TestCase):
    def test_backfill(self):
        db = sqlite3.connect(":memory:")
        db.execute("PRAGMA foreign_keys = ON")
        chain_until(db, 106)
        db.executescript(
            """
            INSERT INTO processes (id, name) VALUES ('ap', 'Standard AP Process'), ('empty', 'Nothing yet');
            INSERT INTO process_stages (id, process_id, name, sequence) VALUES
              ('intake', 'ap', 'Intake', 1), ('review', 'ap', 'AP Review', 2), ('eligible', 'ap', 'Payment Eligible', 3);
            INSERT INTO process_stage_versions (process_id, version, stage_id, sequence)
              SELECT process_id, 1, id, sequence FROM process_stages;
            INSERT INTO sources (id, process_id, name, mechanism, email_address) VALUES
              ('ap-mailbox', 'ap', 'AP mailbox', 'email', 'ap-mailbox.acme@vibefinance-ai.com'),
              ('supplier-api', 'ap', 'New Supplier Integration', 'https', NULL),
              ('old-drop', 'ap', 'Old SFTP drop', 'sftp', NULL);
            UPDATE sources SET status = 'retired', retired_at = '2026-01-01' WHERE id = 'old-drop';
            INSERT INTO route_messages (id, instance_id, direction, status, received_at)
              VALUES ('MSG-1', 'ap-mailbox', 'in', 'delivered', '2026-09-29T10:00:00Z');
            """
        )
        db.executescript((MIGRATIONS / "0107_routes_and_instances.sql").read_text())

        assert db.execute("SELECT entry_stage_id, exit_stage_id FROM processes WHERE id = 'ap'").fetchone() == ("intake", "eligible")
        assert db.execute("SELECT entry_stage_id, exit_stage_id FROM processes WHERE id = 'empty'").fetchone() == (None, None)

        sources = db.execute(
            "SELECT id, route_id, process_id, source_id, name, status FROM route_instances WHERE source_id IS NOT NULL ORDER BY id"
        ).fetchall()
        assert sources == [
            ("ap-mailbox", "email-in", "ap", "ap-mailbox", None, None),
            ("old-drop", "sftp-in", "ap", "old-drop", None, None),
            ("supplier-api", "https-in", "ap", "supplier-api", None, None),
        ]
        # One ERP destination, for the process that receives invoices only.
        assert db.execute("SELECT id, route_id, process_id, name, status FROM route_instances WHERE source_id IS NULL").fetchall() == [
            ("erp-ap", "erp-csv", "ap", "ERP", "active")
        ]
        # The message still names its source, now an instance with the same id.
        assert db.execute("SELECT i.route_id FROM route_messages m JOIN route_instances i ON i.id = m.instance_id").fetchone() == ("email-in",)
        assert db.execute("SELECT count(*) FROM route_versions WHERE status = 'live'").fetchone() == (3,)
        assert db.execute("PRAGMA foreign_key_check").fetchall() == []


if __name__ == "__main__":
    unittest.main()
