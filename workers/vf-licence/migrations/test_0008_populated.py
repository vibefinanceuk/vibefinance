"""Migration 0008 against a database with dependent rows.

The check that was missing. The first remote attempt failed on a
foreign key because the local verification seeded `environments` and
the `customers` it points AT -- but nothing that points at IT.

D1 runs a migration inside one implicit transaction, so this mimics
that: BEGIN, every statement, COMMIT. Running the statements
individually would not reproduce the failure, because it appears at
COMMIT rather than at any single statement.
"""

import glob
import re
import sqlite3
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent


def build_to(before: str) -> sqlite3.Connection:
    db = sqlite3.connect(":memory:", isolation_level=None)
    db.execute("PRAGMA foreign_keys=ON")
    for f in sorted(glob.glob(str(HERE / "*.sql"))):
        if before in f:
            return db
        db.executescript(re.sub(r"^--.*$", "", Path(f).read_text(), flags=re.M))
    return db


def seed_dependents(db: sqlite3.Connection) -> None:
    """Rows in every table that REFERENCES environments."""
    db.executescript(
        """
        INSERT INTO customers (id, name) VALUES ('Acme', 'Acme Ltd');
        INSERT INTO environments (id, customer_id, kind, region, instance_url)
          VALUES ('Acme-production', 'Acme', 'production', 'eu', 'https://x');
        INSERT INTO licences (environment_id, plan, status, volume_entitlement, valid_from)
          VALUES ('Acme-production', 'trial', 'active', 1000, '2026-01-01');
        INSERT INTO usage_periods (environment_id, period_key)
          VALUES ('Acme-production', '2026-09');
        INSERT INTO signup_requests (id, company_name, contact_name, contact_email, environment_id)
          VALUES ('sr1', 'Acme Ltd', 'Dan', 'dan@acme.com', 'Acme-production');
        """
    )


def apply_0008(db: sqlite3.Connection) -> None:
    body = re.sub(r"^--.*$", "", (HERE / "0008_environments_per_region.sql").read_text(), flags=re.M)
    db.execute("BEGIN")
    for stmt in (s.strip() for s in body.split(";")):
        if stmt:
            db.execute(stmt)
    db.execute("COMMIT")


class TestMigration0008AgainstDependents(unittest.TestCase):
    def setUp(self) -> None:
        self.db = build_to("0008")
        seed_dependents(self.db)
        apply_0008(self.db)

    def count(self, sql: str) -> int:
        return self.db.execute(sql).fetchone()[0]

    def test_referencing_rows_survive(self):
        """The failure this test exists for: dropping a referenced table
        orphans everything pointing at it."""
        self.assertEqual(self.count("SELECT count(*) FROM licences"), 1)
        self.assertEqual(self.count("SELECT count(*) FROM usage_periods"), 1)

    def test_foreign_keys_still_resolve(self):
        """Surviving as rows is not enough -- they must still join."""
        self.assertEqual(
            self.count(
                "SELECT count(*) FROM licences l JOIN environments e ON e.id = l.environment_id"
            ),
            1,
        )

    def test_every_column_carried_across(self):
        self.db.execute(
            """UPDATE environments SET worker_name='vf-app', d1_database_name='vf-app-poc',
               d1_database_id='7cac', locale='en', api_key_hash='hash' WHERE id='Acme-production'"""
        )
        row = self.db.execute(
            "SELECT customer_id, kind, region, instance_url, locale FROM environments WHERE id='Acme-production'"
        ).fetchone()
        self.assertEqual(row, ("Acme", "production", "eu", "https://x", "en"))

    def test_a_second_production_in_another_region_is_permitted(self):
        self.db.execute(
            """INSERT INTO environments (id, customer_id, kind, region, instance_url)
               VALUES ('Acme-production-us', 'Acme', 'production', 'us', 'https://y')"""
        )
        self.assertEqual(self.count("SELECT count(*) FROM environments"), 2)

    def test_a_second_production_in_the_same_region_is_still_refused(self):
        """Both directions. A widening that widened too far would pass a
        test checking only the new case."""
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                """INSERT INTO environments (id, customer_id, kind, region, instance_url)
                   VALUES ('dupe', 'Acme', 'production', 'eu', 'https://z')"""
            )

    def test_a_NEW_licence_can_still_be_inserted(self):
        """The check the second attempt did not have, and the reason it
        shipped broken.

        Renaming a referenced table makes SQLite rewrite dependent
        foreign keys to follow it. Existing rows still resolved, so a
        survival test passed -- and every NEW licence failed, because
        the child now pointed at the renamed table. Inserting after the
        migration is the only thing that catches it.
        """
        self.db.execute(
            """INSERT INTO environments (id, customer_id, kind, region, instance_url)
               VALUES ('Acme-sandbox-eu', 'Acme', 'sandbox', 'eu', 'https://s')"""
        )
        self.db.execute(
            """INSERT INTO licences (environment_id, plan, status, volume_entitlement, valid_from)
               VALUES ('Acme-sandbox-eu', 'trial', 'active', 500, '2026-01-01')"""
        )
        self.assertEqual(self.count("SELECT count(*) FROM licences"), 2)

    def test_a_new_licence_for_an_unknown_environment_is_still_refused(self):
        """The foreign key must still bite -- pointing children at a
        table that permits anything would also pass the test above."""
        with self.assertRaises(sqlite3.IntegrityError):
            self.db.execute(
                """INSERT INTO licences (environment_id, plan, status, volume_entitlement, valid_from)
                   VALUES ('no-such-environment', 'trial', 'active', 500, '2026-01-01')"""
            )

    def test_children_reference_the_real_environments_table(self):
        """Stated as schema rather than behaviour, because this is what
        silently went wrong: the FK text itself named the wrong table."""
        for child in ("licences", "usage_periods", "signup_requests"):
            sql = self.db.execute(
                "SELECT sql FROM sqlite_master WHERE name = ?", (child,)
            ).fetchone()[0]
            self.assertIn("REFERENCES environments(id)", sql, f"{child} points elsewhere")
            self.assertNotIn("_hold_", sql)

    def test_no_holding_table_survives(self):
        self.assertEqual(
            self.count(
                "SELECT count(*) FROM sqlite_master WHERE type='table' AND name LIKE '\\_hold\\_%' ESCAPE '\\'"
            ),
            0,
        )

    def test_signup_requests_survive(self):
        self.assertEqual(self.count("SELECT count(*) FROM signup_requests"), 1)


if __name__ == "__main__":
    unittest.main()
