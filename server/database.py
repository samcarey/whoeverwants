"""Database connection management using psycopg connection pool."""

import os
from contextlib import contextmanager

import psycopg
from psycopg.rows import dict_row

DATABASE_URL = os.environ.get("DATABASE_URL", "")


def get_connection():
    """Get a new database connection with dict row factory."""
    return psycopg.connect(DATABASE_URL, row_factory=dict_row)


@contextmanager
def get_db():
    """Context manager for database connections with auto-commit."""
    conn = get_connection()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()
