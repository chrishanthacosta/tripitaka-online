#!/usr/bin/env python3
"""Export suttas to plain-text files under data/texts/.

Reads from PostgreSQL by default (canonical); use --source raw to render
straight from data/raw/*.json without a database.

Layout (per sutta, keyed by canonical `link`; `misc/` when link is missing):
    texts/{book}/{link}.txt            full text: headings + pali/sinhala in order
    texts/{book}/{link}.pali.txt       Pali paragraphs only
    texts/{book}/{link}.sinhala.txt    Sinhala paragraphs only

Usage:
    python scripts/export.py                  # DB -> texts
    python scripts/export.py --source raw     # raw JSON -> texts (no DB needed)
    python scripts/export.py --format md      # also emit .md variants
"""
from __future__ import annotations

import argparse
import json
import logging
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import (  # noqa: E402
    DATABASE_URL,
    RAW_DIR,
    TEXTS_DIR,
    book_from_link,
    normalize_text,
    safe_filename,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("export")

HEADING_TAGS = {"h1", "h2", "h3"}


def render_full(blocks: list[dict]) -> str:
    """Blocks in original order: headings printed plainly, paragraphs separated
    by blank lines. A short '[[pali]]' / '[[sinhala]]' marker precedes each
    paragraph so the two languages are distinguishable in one file."""
    out: list[str] = []
    for b in blocks:
        tag, cls, content = b.get("tag"), b.get("class") or "", b.get("content") or ""
        if tag in HEADING_TAGS:
            out.append("\n" + content + "\n")
        else:
            marker = "[[pali]]" if "pali" in cls else ("[[sinhala]]" if "sinhala" in cls else "")
            out.append(f"{marker} {content}".rstrip() if marker else content)
    return "\n\n".join(x.strip() for x in out if x.strip()) + "\n"


def render_lang(blocks: list[dict], lang: str) -> str:
    return "\n\n".join(b.get("content") or "" for b in blocks if b.get("lang") == lang) + "\n"


def export_one(book: str | None, link: str | None, source_id: int, label: str, blocks: list[dict], fmt: str) -> Path:
    sub = book or "misc"
    name = safe_filename(link) if link else f"sutta-{source_id}"
    d = TEXTS_DIR / sub
    d.mkdir(parents=True, exist_ok=True)

    # Vagga/section pages have no text blocks; keep the title so the file
    # is not empty and the section structure survives.
    if not blocks:
        blocks = [{"tag": "h1", "class": "sutta-title", "lang": None, "content": label}]

    if fmt == "md":
        full = "\n\n".join(
            f"### {b['content']}" if b["tag"] in HEADING_TAGS else b["content"]
            for b in blocks
        ) + "\n"
        (d / f"{name}.md").write_text(full, encoding="utf-8")
    else:
        (d / f"{name}.txt").write_text(render_full(blocks), encoding="utf-8")

    (d / f"{name}.pali.txt").write_text(render_lang(blocks, "pali"), encoding="utf-8")
    (d / f"{name}.sinhala.txt").write_text(render_lang(blocks, "sinhala"), encoding="utf-8")
    return d / f"{name}.txt"


def iter_from_db(dsn: str):
    import psycopg

    with psycopg.connect(dsn) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """SELECT s.source_id, s.link, s.book, s.label,
                          COALESCE(jsonb_agg(jsonb_build_object(
                              'tag', b.tag, 'class', b.class, 'lang', b.lang, 'content', b.content
                          ) ORDER BY b.seq) FILTER (WHERE b.id IS NOT NULL), '[]'::jsonb) AS blocks
                   FROM suttas s LEFT JOIN blocks b ON b.sutta_id = s.id
                   GROUP BY s.source_id, s.link, s.book, s.label
                   ORDER BY s.source_id"""
            )
            for source_id, link, book, label, blocks in cur.fetchall():
                yield source_id, link, book, label, list(blocks)


def iter_from_raw(raw_dir: Path):
    for path in sorted(raw_dir.glob("*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        source_id = data["id"]
        link = data.get("link")
        blocks = []
        for seq, b in enumerate(data["content"]["data"]):
            cls = b.get("class") or ""
            blocks.append({
                "tag": b.get("tag") or "p",
                "class": cls,
                "lang": "pali" if "pali" in cls else ("sinhala" if "sinhala" in cls else None),
                "content": normalize_text(b.get("content") or ""),
            })
        yield source_id, link, book_from_link(link), data.get("label") or "", blocks


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--source", choices=["db", "raw"], default="db")
    ap.add_argument("--dsn", default=DATABASE_URL)
    ap.add_argument("--raw-dir", type=Path, default=RAW_DIR)
    ap.add_argument("--format", choices=["txt", "md"], default="txt")
    args = ap.parse_args()

    TEXTS_DIR.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    count = 0
    if args.source == "db":
        it = iter_from_db(args.dsn)
    else:
        it = iter_from_raw(args.raw_dir)
    for source_id, link, book, label, blocks in it:
        out = export_one(book, link, source_id, label, blocks, args.format)
        count += 1
    log.info("exported %d suttas to %s in %.0fs", count, TEXTS_DIR, time.time() - t0)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
