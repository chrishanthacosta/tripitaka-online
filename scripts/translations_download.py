#!/usr/bin/env python3
"""Download the Buddha Jayanthi Tripitaka databases (tipitaka.lk data.zip).

Source: https://github.com/pathnirvana/tipitaka.lk/releases/download/v2.0/data.zip
Contains db/fts.db (all sutta text: Pali + Sinhala translation) and
dist/static/data/tree.json (book/sutta structure).

Usage:
    python3 scripts/translations_download.py
"""
from __future__ import annotations

import zipfile
from pathlib import Path

import httpx

DATA_DIR = Path(__file__).resolve().parent.parent / "data" / "translations"
URL = "https://github.com/pathnirvana/tipitaka.lk/releases/download/v2.0/data.zip"
MEMBERS = {"db/fts.db": "fts.db", "dist/static/data/tree.json": "tree.json"}


def main() -> int:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    data_zip = DATA_DIR / "data.zip"
    if not data_zip.exists():
        print(f"downloading {URL} (~180 MB)…")
        with httpx.stream("GET", URL, timeout=1800, follow_redirects=True) as r:
            r.raise_for_status()
            with open(data_zip, "wb") as f:
                for chunk in r.iter_bytes(1 << 20):
                    f.write(chunk)
        print(f"saved {data_zip} ({data_zip.stat().st_size // 1024 // 1024} MB)")
    with zipfile.ZipFile(data_zip) as z:
        for member, out_name in MEMBERS.items():
            target = DATA_DIR / out_name
            if target.exists():
                print(f"  {out_name}: already present")
                continue
            print(f"  extracting {member} -> {out_name}")
            with z.open(member) as src, open(target, "wb") as dst:
                while True:
                    chunk = src.read(1 << 20)
                    if not chunk:
                        break
                    dst.write(chunk)
    print("done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
