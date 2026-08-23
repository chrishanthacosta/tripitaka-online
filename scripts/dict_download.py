"""Download all Pali / Sinhala / English dictionaries into data/dicts/raw/.

Sources (all freely downloadable; see README for attribution):

  DPD           Digital Pāḷi Dictionary          digitalpalidictionary.github.io
                - dpd-txt.zip  (plain-text export, ~4 MB)
                - dpd.db.tar.xz (full SQLite database, ~165 MB; --full)
  NCPED         New Concise Pali-English Dict.    SuttaCentral sc-data (JSON)
  PED           PTS Pali-English Dictionary      vpnry/ptsped (SQL export)
  Buddhadatta   Pali-Sinhala Dictionary          pnfo/pali-sinhala-dictionary (JSON)
  Sumangala     Pali-Sinhala Dictionary          pnfo/pali-sinhala-dictionary (JSON)
  sin-eng-sin   Sinhala-English-Sinhala          DPD other-dictionaries (StarDict)

Usage:
    python3 scripts/dict_download.py             # everything except the full DPD db
    python3 scripts/dict_download.py --full      # also fetch dpd.db.tar.xz (~165 MB)
"""
from __future__ import annotations

import argparse
import shutil
import sys
import zipfile
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import REQUEST_TIMEOUT, USER_AGENT, ensure_dirs  # noqa: E402

RAW = Path(__file__).resolve().parent.parent / "data" / "dicts" / "raw"

SOURCES: dict[str, tuple[str, str]] = {
    # name -> (url, local filename)
    "dpd-txt": (
        "https://github.com/digitalpalidictionary/dpd-db/releases/latest/download/dpd-txt.zip",
        "dpd-txt.zip",
    ),
    "dpd-db": (
        "https://github.com/digitalpalidictionary/dpd-db/releases/latest/download/dpd.db.tar.xz",
        "dpd.db.tar.xz",
    ),
    "ncped": (
        "https://raw.githubusercontent.com/suttacentral/sc-data/main/dictionaries/simple/en/pli2en_ncped.json",
        "ncped.json",
    ),
    "ped": (
        "https://raw.githubusercontent.com/vpnry/ptsped/main/dev/PTSPED-2021-sql.zip",
        "ptsped-sql.zip",
    ),
    "buddhadatta": (
        "https://raw.githubusercontent.com/pnfo/pali-sinhala-dictionary/main/buddhadatta_dict.json",
        "buddhadatta_dict.json",
    ),
    "sumangala": (
        "https://raw.githubusercontent.com/pnfo/pali-sinhala-dictionary/main/sumangala_dict.json",
        "sumangala_dict.json",
    ),
    "sin-eng-sin": (
        "https://github.com/digitalpalidictionary/other-dictionaries/releases/latest/download/sin-eng-sin-gd.zip",
        "sin-eng-sin-gd.zip",
    ),
}

# archives that need unpacking: (zip name, member prefix -> extract dir)
ZIPS = {
    "dpd-txt.zip": "dpd-txt",            # contains dpd.txt
    "ptsped-sql.zip": "ptsped-sql",      # contains PTSPED-2021-5.sql
    "sin-eng-sin-gd.zip": "sin-eng-sin", # StarDict: .ifo/.idx/.dict.dz
}


def fetch(name: str, force: bool) -> None:
    url, fname = SOURCES[name]
    target = RAW / fname
    if target.exists() and not force:
        print(f"  {name}: already present ({target.stat().st_size // 1024} KB), skipping")
        return
    print(f"  {name}: downloading {url}")
    with httpx.stream("GET", url, timeout=600, follow_redirects=True,
                      headers={"User-Agent": USER_AGENT}) as r:
        r.raise_for_status()
        tmp = target.with_suffix(".part")
        with open(tmp, "wb") as f:
            for chunk in r.iter_bytes(1 << 20):
                f.write(chunk)
        tmp.rename(target)
    print(f"  {name}: {target.stat().st_size // 1024} KB")


def unpack(fname: str) -> None:
    zpath = RAW / fname
    outdir = RAW / ZIPS[fname]
    if outdir.is_dir() and any(outdir.iterdir()):
        print(f"  {fname}: already unpacked -> {outdir}")
        return
    outdir.mkdir(parents=True, exist_ok=True)
    print(f"  {fname}: unpacking -> {outdir}")
    with zipfile.ZipFile(zpath) as z:
        z.extractall(outdir)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--full", action="store_true", help="also download dpd.db.tar.xz (~165 MB)")
    ap.add_argument("--force", action="store_true")
    args = ap.parse_args()

    ensure_dirs()
    RAW.mkdir(parents=True, exist_ok=True)
    names = [n for n in SOURCES if args.full or n != "dpd-db"]
    print(f"downloading {len(names)} sources into {RAW}")
    for n in names:
        fetch(n, args.force)
    for z in ZIPS:
        if (RAW / z).exists():
            unpack(z)
    print("done.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
