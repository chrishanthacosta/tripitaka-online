#!/usr/bin/env python3
"""Crawl every sutta of tripitaka.online into data/raw/{source_id:06d}.json.

The site publishes a sitemap (robots.txt allows all). Each /sutta/{id} page
is client-rendered, but /api/sutta/{id} returns the full text as clean JSON:
    {"id":…, "label":…, "link":…, "content": {"data":[{tag,id,class,content},…]}}

Resumable: skips source files that already exist unless --force.
Usage:
    python scripts/crawl.py                  # full crawl (4,157 suttas, ~15-30 min)
    python scripts/crawl.py --limit 20       # quick smoke test
    python scripts/crawl.py --ids 17,122     # specific suttas
    python scripts/crawl.py --force          # re-download everything
"""
from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys
import time
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import (  # noqa: E402
    API_URL,
    DEFAULT_CONCURRENCY,
    DEFAULT_RETRIES,
    REQUEST_TIMEOUT,
    RAW_DIR,
    SITEMAP_URL,
    USER_AGENT,
    ensure_dirs,
    parse_sitemap,
    raw_path,
    sha256_bytes,
)

_LOG_FILE = Path(__file__).resolve().parent.parent / "logs" / "crawl.log"
_LOG_FILE.parent.mkdir(parents=True, exist_ok=True)
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler(_LOG_FILE),
    ],
)
log = logging.getLogger("crawl")


async def fetch_one(client: httpx.AsyncClient, source_id: int, retries: int) -> bool:
    """Download one sutta. Returns True on success. Raises on final failure."""
    url = API_URL.format(id=source_id)
    delay = 1.0
    for attempt in range(1, retries + 1):
        try:
            resp = await client.get(url)
            resp.raise_for_status()
            # Validate shape so we never persist a 404-page/error body
            data = resp.json()
            if data.get("id") != source_id or "content" not in data:
                raise ValueError(f"unexpected payload shape for {source_id}")
            raw_path(source_id).write_bytes(resp.content)
            log.info("saved %d (%d bytes)", source_id, len(resp.content))
            return True
        except (httpx.HTTPError, ValueError, json.JSONDecodeError) as exc:
            if attempt < retries:
                log.warning("retry %d/%d for %d after %s (%.0fs)", attempt, retries, source_id, exc, delay)
                await asyncio.sleep(delay)
                delay *= 2
            else:
                log.error("FAILED %d after %d attempts: %s", source_id, retries, exc)
                raise
    return False


async def crawl(ids: list[int], concurrency: int, retries: int, force: bool) -> tuple[int, int]:
    ensure_dirs()
    todo = [i for i in ids if force or not raw_path(i).exists()]
    skipped = len(ids) - len(todo)
    if skipped:
        log.info("skipping %d already-downloaded suttas", skipped)

    sem = asyncio.Semaphore(concurrency)
    failed: list[int] = []

    async def worker(source_id: int) -> None:
        async with sem:
            try:
                async with httpx.AsyncClient(
                    timeout=REQUEST_TIMEOUT,
                    headers={"User-Agent": USER_AGENT},
                    follow_redirects=True,
                ) as client:
                    await fetch_one(client, source_id, retries)
            except Exception:
                failed.append(source_id)

    t0 = time.time()
    await asyncio.gather(*(worker(i) for i in todo))
    elapsed = time.time() - t0
    log.info("done: %d fetched, %d failed, %d skipped in %.0fs", len(todo) - len(failed), len(failed), skipped, elapsed)

    # One final pass over failures (transient network blips)
    if failed:
        log.info("final retry pass over %d failures", len(failed))
        still_failed: list[int] = []
        async with httpx.AsyncClient(
            timeout=REQUEST_TIMEOUT,
            headers={"User-Agent": USER_AGENT},
            follow_redirects=True,
        ) as client:
            for i in failed:
                try:
                    await fetch_one(client, i, retries)
                except Exception:
                    still_failed.append(i)
        failed = still_failed
        if failed:
            log.error("permanently failed: %s", failed)
    return len(ids) - len(failed), len(failed)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--sitemap", default=SITEMAP_URL, help="sitemap URL or local file path")
    ap.add_argument("--limit", type=int, help="only fetch the first N ids (for testing)")
    ap.add_argument("--ids", help="comma-separated source ids to fetch")
    ap.add_argument("--concurrency", type=int, default=DEFAULT_CONCURRENCY)
    ap.add_argument("--retries", type=int, default=DEFAULT_RETRIES)
    ap.add_argument("--force", action="store_true", help="re-download even if present")
    args = ap.parse_args()

    if args.ids:
        ids = [int(x) for x in args.ids.split(",") if x.strip()]
    else:
        if args.sitemap.startswith("http"):
            resp = httpx.get(args.sitemap, timeout=REQUEST_TIMEOUT,
                             headers={"User-Agent": USER_AGENT}, follow_redirects=True)
            resp.raise_for_status()
            text = resp.text
        else:
            text = Path(args.sitemap).read_text(encoding="utf-8")
        ids = parse_sitemap(text)
        if args.limit:
            ids = ids[: args.limit]
    log.info("crawling %d suttas from %s", len(ids), args.sitemap)

    ok, failed = asyncio.run(crawl(ids, args.concurrency, args.retries, args.force))
    print(f"OK={ok} FAILED={failed}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
