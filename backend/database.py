"""Initialize PrintNa's local SQLite database."""

import sqlite3
from contextlib import closing
from pathlib import Path


DATABASE_PATH = Path(__file__).resolve().parents[1] / "data" / "printna.db"
SCHEMA_VERSION = 1


def initialize_database(path: Path = DATABASE_PATH) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(path)) as connection, connection:
        connection.execute("BEGIN IMMEDIATE")
        version = connection.execute("PRAGMA user_version").fetchone()[0]
        if version == SCHEMA_VERSION:
            return
        if version != 0:
            raise RuntimeError(f"Unsupported database schema version {version}")

        connection.execute("""
            CREATE TABLE projects (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL CHECK (length(trim(name)) > 0),
                layout_json TEXT NOT NULL CHECK (json_valid(layout_json)),
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
            )
        """)
        connection.execute("""
            CREATE TABLE preferences (
                key TEXT PRIMARY KEY NOT NULL,
                value_json TEXT NOT NULL CHECK (json_valid(value_json))
            )
        """)
        connection.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")


if __name__ == "__main__":
    initialize_database()
    print(DATABASE_PATH)
