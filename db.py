import sqlite3
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "instance" / "lost_found.db"


def connect(path=DB_PATH):
    """Open a connection. The caller must close it."""
    conn = sqlite3.connect(path)
    conn.row_factory = sqlite3.Row
    # SQLite ignores foreign keys unless this is set on every connection.
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def _definitions(conn):
    """Map each table and index name to the SQL that created it."""
    rows = conn.execute("SELECT name, sql FROM sqlite_master WHERE sql IS NOT NULL")
    return {row[0]: row[1] for row in rows}


def init_db(path=DB_PATH):
    """Create any missing tables. Existing tables and data are left alone.

    Raises RuntimeError if an existing table or index differs from schema.sql.
    """
    schema = (BASE_DIR / "schema.sql").read_text(encoding="utf-8")
    fresh = sqlite3.connect(":memory:")
    try:
        fresh.executescript(schema)
        expected = _definitions(fresh)
    finally:
        fresh.close()

    Path(path).parent.mkdir(parents=True, exist_ok=True)
    conn = connect(path)
    try:
        # Check before creating anything, so a mismatched database is not touched.
        existing = _definitions(conn)
        outdated = sorted(n for n in expected if n in existing and existing[n] != expected[n])
        if outdated:
            raise RuntimeError(
                f"{path} does not match schema.sql: {', '.join(outdated)}. "
                "Migrate it, or move the file aside and run again."
            )
        conn.executescript(schema)
    finally:
        conn.close()


if __name__ == "__main__":
    init_db()
    print(f"Database ready: {DB_PATH}")
