#!/usr/bin/env python3
"""Consistency checks: sitemap ids vs raw files vs DB rows vs text files.

Usage:
    python scripts/verify.py                    # full check (needs DB up)
    python scripts/verify.py --no-db            # raw/files only
    python scripts/verify.py --sitemap /path/sitemap.xml   # offline sitemap
"""
from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import (  # noqa: E402
    DATABASE_URL,
    RAW_DIR,
    REQUEST_TIMEOUT,
    SITEMAP_URL,
    TEXTS_DIR,
    USER_AGENT,
    parse_sitemap,
)

problems = 0


def check(ok: bool, msg: str) -> None:
    global problems
    print(("  ✓ " if ok else "  ✗ ") + msg)
    if not ok:
        problems += 1


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--sitemap", default=SITEMAP_URL)
    ap.add_argument("--dsn", default=DATABASE_URL)
    ap.add_argument("--no-db", action="store_true")
    args = ap.parse_args()

    # 1. Sitemap vs raw files
    if args.sitemap.startswith("http"):
        resp = httpx.get(args.sitemap, timeout=REQUEST_TIMEOUT,
                         headers={"User-Agent": USER_AGENT}, follow_redirects=True)
        resp.raise_for_status()
        sitemap_text = resp.text
    else:
        sitemap_text = Path(args.sitemap).read_text(encoding="utf-8")
    ids = parse_sitemap(sitemap_text)
    print(f"sitemap: {len(ids)} sutta urls")

    have = {int(p.stem) for p in RAW_DIR.glob("*.json")} if RAW_DIR.exists() else set()
    missing = [i for i in ids if i not in have]
    extra = sorted(have - set(ids))
    # Distinguish stale sitemap entries (API 404s) from genuinely missing data.
    dead: list[int] = []
    for i in missing:
        try:
            r = httpx.get(f"https://tripitaka.online/api/sutta/{i}", timeout=REQUEST_TIMEOUT,
                          headers={"User-Agent": USER_AGENT}, follow_redirects=True)
            if r.status_code == 404:
                dead.append(i)
        except Exception:
            pass
    real_missing = [i for i in missing if i not in dead]
    if dead:
        print(f"  info: {len(dead)} sitemap ids are dead (API 404, page is an empty stub): {dead}")
    check(not real_missing,
          f"raw/ has {len(have)} files; {len(real_missing)} sitemap ids missing: {real_missing[:10]}")
    check(not extra, f"{len(extra)} raw files not in sitemap: {extra[:10]}")

    # 2. Raw files parse + sanity
    bad = 0
    lang_stats: Counter = Counter()
    null_links = 0
    for p in RAW_DIR.glob("*.json"):
        try:
            d = json.loads(p.read_text(encoding="utf-8"))
            classes = [b.get("class", "") for b in d["content"]["data"]]
            if not d.get("link"):
                null_links += 1
            lang_stats["pali"] += any("pali" in c for c in classes)
            lang_stats["sinhala"] += any("sinhala" in c for c in classes)
        except Exception:
            bad += 1
    check(bad == 0, f"{bad} raw files fail to parse")
    print(f"  info: {lang_stats['pali']} suttas have pali text, {lang_stats['sinhala']} have sinhala text, "
          f"{null_links} with empty link (-> misc/)")

    # 3. Text export presence
    if TEXTS_DIR.exists():
        txts = list(TEXTS_DIR.rglob("*.txt"))
        check(len(txts) >= len(have) * 3,
              f"texts/ has {len(txts)} txt files (expect >= {len(have) * 3}: full+pali+sinhala per sutta)")

    # 4. DB
    if not args.no_db:
        try:
            import psycopg

            with psycopg.connect(args.dsn) as conn:
                n_suttas = conn.execute("SELECT count(*) FROM suttas").fetchone()[0]
                n_blocks = conn.execute("SELECT count(*) FROM blocks").fetchone()[0]
                missing_in_db = conn.execute(
                    "SELECT count(*) FROM suttas WHERE source_id = ANY(%s)",
                    (list(ids),),
                ).fetchone()[0]
            expect_db = len(ids) - len(dead)   # dead sitemap entries have no API data
            check(n_suttas == expect_db, f"db suttas={n_suttas} vs expected={expect_db}")
            print(f"  info: db blocks={n_blocks}, suttas matched in sitemap={missing_in_db}")
        except Exception as exc:
            check(False, f"db check failed: {exc}")

    print("RESULT:", "OK" if problems == 0 else f"{problems} problem(s)")
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
