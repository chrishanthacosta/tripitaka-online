"""Database access for the tripitaka.online mirror API (PostgreSQL)."""
from __future__ import annotations

import os

from psycopg_pool import ConnectionPool

# Compose maps the container to host port 5434 (see docker-compose.yml).
DATABASE_URL = os.environ.get(
    "DATABASE_URL", "postgresql://tripitaka:tripitaka@localhost:5434/tripitaka"
)

pool = ConnectionPool(
    DATABASE_URL,
    min_size=1,
    max_size=8,
    open=False,  # lazy: opened on first use
)


def open_pool() -> None:
    if pool.closed:
        pool.open(wait=True, timeout=10)
