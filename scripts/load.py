#!/usr/bin/env python3
"""Load data/raw/*.json into PostgreSQL (suttas + blocks).

Idempotent: upserts keyed on source_id; rows whose sha256 matches are skipped
(incremental sync). Run db/schema.sql first (or let --create-schema do it).

Usage:
    python scripts/load.py                        # all raw files -> DB
    python scripts/load.py --raw-dir data/raw     # explicit dir
    DATABASE_URL=postgresql://user:pw@host:5432/db python scripts/load.py
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import (  # noqa: E402
    DATABASE_URL,
    RAW_DIR,
    book_from_link,
    normalize_text,
    sha256_bytes,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("load")

SCHEMA_SQL = (Path(__file__).resolve().parent.parent / "db" / "schema.sql").read_text(encoding="utf-8")

# (source_id, link, book, label, url, raw_json, checksum)
SELECT_SUTTA = "SELECT id, checksum FROM suttas WHERE source_id = %s"

UPSERT_SUTTA = """
INSERT INTO suttas (source_id, link, book, label, url, raw_json, checksum)
VALUES (%s, %s, %s, %s, %s, %s, %s)
ON CONFLICT (source_id) DO UPDATE SET
    link      = EXCLUDED.link,
    book      = EXCLUDED.book,
    label     = EXCLUDED.label,
    url       = EXCLUDED.url,
    raw_json  = EXCLUDED.raw_json,
    checksum  = EXCLUDED.checksum,
    updated_at = now()
RETURNING id
"""

DELETE_BLOCKS = "DELETE FROM blocks WHERE sutta_id = %s"

UPSERT_BLOCK = """
INSERT INTO blocks (sutta_id, seq, tag, class, lang, content)
VALUES (%s, %s, %s, %s, %s, %s)
ON CONFLICT (sutta_id, seq) DO UPDATE SET
    tag     = EXCLUDED.tag,
    class   = EXCLUDED.class,
    lang    = EXCLUDED.lang,
    content = EXCLUDED.content
"""


def lang_of(cls: str) -> str | None:
    if "pali" in cls:
        return "pali"
    if "sinhala" in cls:
        return "sinhala"
    return None


def load_raw_file(cur, path: Path) -> tuple[str, bool]:
    """Insert one sutta + its blocks. Returns (checksum, changed)."""
    raw = path.read_bytes()
    checksum = sha256_bytes(raw)
    data = json.loads(raw)
    source_id = data["id"]
    url = f"https://tripitaka.online/sutta/{source_id}"

    existing = cur.execute(SELECT_SUTTA, (source_id,)).fetchone()
    if existing and existing[1] == checksum:
        return checksum, False

    sutta_db_id = cur.execute(UPSERT_SUTTA, (
        source_id, data.get("link"), book_from_link(data.get("link")),
        data.get("label") or "", url, raw.decode("utf-8"), checksum,
    )).fetchone()[0]

    # Replace this sutta's blocks wholesale (keeps seq numbering in sync).
    cur.execute(DELETE_BLOCKS, (sutta_db_id,))
    blocks = data["content"]["data"]
    cur.executemany(UPSERT_BLOCK, [
        (sutta_db_id, seq, b.get("tag") or "p", b.get("class") or "",
         lang_of(b.get("class") or ""), normalize_text(b.get("content") or ""))
        for seq, b in enumerate(blocks)
    ])
    return checksum, True


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--raw-dir", type=Path, default=RAW_DIR)
    ap.add_argument("--dsn", default=DATABASE_URL)
    ap.add_argument("--create-schema", action="store_true", help="run db/schema.sql first")
    ap.add_argument("--limit", type=int, help="load at most N raw files (for testing)")
    args = ap.parse_args()

    files = sorted(args.raw_dir.glob("*.json"))
    if args.limit:
        files = files[: args.limit]
    if not files:
        log.error("no raw JSON files found in %s — run scripts/crawl.py first", args.raw_dir)
        return 2

    t0 = time.time()
    loaded = skipped = failed = 0
    with psycopg.connect(args.dsn) as conn:
        if args.create_schema:
            conn.execute(SCHEMA_SQL)
        with conn.cursor() as cur:
            for path in files:
                try:
                    _, changed = load_raw_file(cur, path)
                    if changed:
                        loaded += 1
                    else:
                        skipped += 1
                except Exception as exc:  # keep going; report at the end
                    log.error("failed %s: %s", path.name, exc)
                    failed += 1
            conn.commit()
    log.info("loaded=%d unchanged=%d failed=%d in %.0fs", loaded, skipped, failed, time.time() - t0)
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
