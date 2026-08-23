#!/usr/bin/env python3
"""Export the whole mirror to a static site (for GitHub Pages / any static host).

Reads PostgreSQL and writes:

    site/index.html                      (built web app — copied from web/dist)
    site/data/stats.json
    site/data/books.json
    site/data/suttas/list.json           (all sutta metas: title/book/link/neighbors)
    site/data/suttas/{source_id}.json    (blocks + bjt translation inline)
    site/data/dicts.json                 (compact dictionary index for the popup)
    site/data/search.json                (word -> suttas posting index)

The web app is built with VITE_STATIC=1 so it reads ./data/… instead of the
FastAPI backend. Total data ~150-250 MB — within GitHub Pages limits.

Usage:
    VITE_STATIC=1 pnpm --dir web build          # build the static bundle first
    python3 scripts/static_export.py            # then export the data
    python3 scripts/static_export.py --site-dir site
"""
from __future__ import annotations

import argparse
import json
import shutil
import sys
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import DATABASE_URL, RAW_DIR  # noqa: E402
from dict_common import clean_si_word, roman_key, si2roman, strip_zw  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "web" / "dist"
DICTS_SQLITE = ROOT / "data" / "dicts" / "dicts.sqlite"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--site-dir", type=Path, default=ROOT / "site")
    ap.add_argument("--dsn", default=DATABASE_URL)
    ap.add_argument("--no-dicts", action="store_true", help="skip the dictionary index (big)")
    ap.add_argument("--no-search", action="store_true", help="skip the word search index (big)")
    args = ap.parse_args()

    site = args.site_dir
    data_dir = site / "data"
    suttas_dir = data_dir / "suttas"
    (data_dir / "suttas").mkdir(parents=True, exist_ok=True)

    if DIST.is_dir():
        print("copying web/dist -> site/")
        shutil.rmtree(site, ignore_errors=True)
        (data_dir / "suttas").mkdir(parents=True, exist_ok=True)
        shutil.copytree(DIST, site, dirs_exist_ok=True)
    else:
        print("WARNING: web/dist missing — build with VITE_STATIC=1 first")

    with psycopg.connect(args.dsn) as conn:
        with conn.cursor() as cur:
            # stats + books
            stats = {
                "suttas": cur.execute("SELECT count(*) FROM suttas").fetchone()[0],
                "blocks": cur.execute("SELECT count(*) FROM blocks").fetchone()[0],
                "books": cur.execute("SELECT count(DISTINCT book) FROM suttas WHERE book IS NOT NULL").fetchone()[0],
                "pali_blocks": cur.execute("SELECT count(*) FROM blocks WHERE lang='pali'").fetchone()[0],
                "sinhala_blocks": cur.execute("SELECT count(*) FROM blocks WHERE lang='sinhala'").fetchone()[0],
            }
            (data_dir / "stats.json").write_text(json.dumps(stats, ensure_ascii=False), encoding="utf-8")
            print("stats:", stats)

            books = [{"book": r[0], "count": r[1]} for r in cur.execute(
                "SELECT book, count(*) FROM suttas WHERE book IS NOT NULL GROUP BY book ORDER BY book"
            )]
            (data_dir / "books.json").write_text(json.dumps(books, ensure_ascii=False), encoding="utf-8")

            # sutta metas + neighbors (one pass)
            cur.execute("""SELECT source_id, link, book, label,
                                  url FROM suttas ORDER BY source_id""")
            metas = cur.fetchall()
            meta_by_id = {m[0]: {"source_id": m[0], "link": m[1], "book": m[2],
                                 "label": m[3], "url": m[4]} for m in metas}
            print("suttas:", len(metas))

            # neighbors within the same book
            for source_id, _link, book, _label, _url in metas:
                prev = next = None
                if book:
                    r = cur.execute("SELECT source_id, link, label, book FROM suttas "
                                    "WHERE book=%s AND source_id<%s ORDER BY source_id DESC LIMIT 1",
                                    (book, source_id)).fetchone()
                    if r:
                        prev = {"source_id": r[0], "link": r[1], "label": r[2], "book": r[3]}
                    r = cur.execute("SELECT source_id, link, label, book FROM suttas "
                                    "WHERE book=%s AND source_id>%s ORDER BY source_id ASC LIMIT 1",
                                    (book, source_id)).fetchone()
                    if r:
                        next = {"source_id": r[0], "link": r[1], "label": r[2], "book": r[3]}
                meta_by_id[source_id]["prev"] = prev
                meta_by_id[source_id]["next"] = next

            list_path = data_dir / "suttas" / "list.json"
            list_path.write_text(json.dumps(list(meta_by_id.values()), ensure_ascii=False), encoding="utf-8")
            print("list.json:", list_path.stat().st_size // 1024, "KB")

            # per-sutta data (blocks + bjt translation)
            n = 0
            total_bytes = 0
            cur.execute("""SELECT s.source_id, b.seq, b.tag, b.class, b.lang, b.content
                           FROM blocks b JOIN suttas s ON s.id = b.sutta_id
                           ORDER BY s.source_id, b.seq""")
            blocks_by_sutta: dict[int, list] = {}
            for source_id, seq, tag, cls, lang, content in cur.fetchall():
                blocks_by_sutta.setdefault(source_id, []).append(
                    {"seq": seq, "tag": tag, "class": cls, "lang": lang, "content": content}
                )
            cur.execute("""SELECT s.source_id, t.lang, t.seq, t.tag, t.content
                           FROM translations t JOIN suttas s ON s.id = t.sutta_id
                           WHERE t.source='bjt' ORDER BY s.source_id, t.lang, t.seq""")
            bjt_by_sutta: dict[int, dict[str, list]] = {}
            for source_id, lang, seq, tag, content in cur.fetchall():
                bjt_by_sutta.setdefault(source_id, {}).setdefault(lang, []).append(
                    {"seq": seq, "tag": tag, "content": content}
                )
            for source_id, meta in meta_by_id.items():
                payload = {
                    "source_id": source_id,
                    "link": meta["link"],
                    "label": meta["label"],
                    "book": meta["book"],
                    "url": meta["url"],
                    "prev": meta["prev"],
                    "next": meta["next"],
                    "blocks": blocks_by_sutta.get(source_id, []),
                    "bjt": bjt_by_sutta.get(source_id, None),
                }
                raw = json.dumps(payload, ensure_ascii=False).encode("utf-8")
                (suttas_dir / f"{source_id}.json").write_bytes(raw)
                total_bytes += len(raw)
                n += 1
            print(f"per-sutta json: {n} files, {total_bytes // 1024 // 1024} MB")

    # dictionary index (compact: skip DPD examples/detail to bound size)
    if not args.no_dicts and DICTS_SQLITE.exists():
        import sqlite3

        conn = sqlite3.connect(DICTS_SQLITE)
        # word_si -> entries and word_roman_key -> entries
        out: dict[str, list[dict]] = {}
        for src, wsi, wrom, rk, pos, definition, root, sanskrit in conn.execute(
            """SELECT source, word_si, word_roman, word_roman_key, pos, definition, root, sanskrit
               FROM entries WHERE word_si IS NOT NULL OR word_roman_key IS NOT NULL"""
        ):
            key = wsi or rk
            if not key or len(key) < 2:
                continue
            e = {"s": src, "p": pos, "d": definition}
            if wrom:
                e["w"] = wrom
            if root:
                e["r"] = root
            if sanskrit:
                e["k"] = sanskrit
            out.setdefault(key, []).append(e)
        (data_dir / "dicts.json").write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
        print("dicts.json:", (data_dir / "dicts.json").stat().st_size // 1024 // 1024, "MB, keys:", len(out))
        conn.close()

    # search index: pali word (roman key) -> sorted sutta ids
    if not args.no_search:
        import sqlite3

        conn = sqlite3.connect(DICTS_SQLITE)  # reuse connection? no — separate
        conn.close()
        with psycopg.connect(args.dsn) as conn:
            postings: dict[str, set[int]] = {}
            cur = conn.cursor()
            cur.execute("""SELECT s.source_id, b.content FROM blocks b JOIN suttas s ON s.id=b.sutta_id
                           WHERE b.lang='pali'""")
            for source_id, content in cur.fetchall():
                key = roman_key(si2roman(strip_zw(content)))
                seen = set()
                for w in key.split():
                    w = w.strip(".,;:!?()")
                    if len(w) >= 3 and w not in seen:
                        seen.add(w)
                        postings.setdefault(w, set()).add(source_id)
            idx = {w: sorted(sids) for w, sids in postings.items()}
            (data_dir / "search.json").write_text(json.dumps(idx, ensure_ascii=False), encoding="utf-8")
            print("search.json:", (data_dir / "search.json").stat().st_size // 1024 // 1024, "MB, words:", len(idx))

    print("static site ready at", site)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
