"""Shared configuration and helpers for the tripitaka.online mirror pipeline."""
from __future__ import annotations

import hashlib
import os
import re
import unicodedata
from pathlib import Path

# ---------------------------------------------------------------------------
# Paths (repo layout: project root contains scripts/, data/, db/, logs/)
# ---------------------------------------------------------------------------
ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
RAW_DIR = DATA_DIR / "raw"          # raw/{source_id:06d}.json
TEXTS_DIR = DATA_DIR / "texts"      # texts/{book}/{link}.txt  (+ .pali/.sinhala variants)
LOG_DIR = ROOT / "logs"

BASE_URL = "https://tripitaka.online"
SITEMAP_URL = f"{BASE_URL}/sitemap.xml"
API_URL = f"{BASE_URL}/api/sutta/{{id}}"

USER_AGENT = "tripitaka-local-mirror/0.1 (educational archive; polite crawler)"
REQUEST_TIMEOUT = 30.0
DEFAULT_CONCURRENCY = 5
DEFAULT_RETRIES = 3

# Default Postgres connection (override with DATABASE_URL env var).
# Compose maps the container to host port 5434 (5432/5433 are used by other projects).
DATABASE_URL = os.environ.get(
    "DATABASE_URL", "postgresql://tripitaka:tripitaka@localhost:5434/tripitaka"
)

SITEMAP_RE = re.compile(r"<loc>https://tripitaka\.online/sutta/(\d+)</loc>")


def ensure_dirs() -> None:
    for d in (RAW_DIR, TEXTS_DIR, LOG_DIR):
        d.mkdir(parents=True, exist_ok=True)


def sha256_bytes(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def normalize_text(s: str) -> str:
    """NFC-normalize, strip BOM/zero-width chars outside words, fix line endings."""
    s = unicodedata.normalize("NFC", s)
    s = s.replace("\u200b", "").replace("\ufeff", "")
    s = s.replace("\r\n", "\n").replace("\r", "\n")
    return s.strip()


def raw_path(source_id: int) -> Path:
    return RAW_DIR / f"{source_id:06d}.json"


def parse_sitemap(text: str) -> list[int]:
    """Extract sutta ids from the sitemap XML, in document order, deduped."""
    seen: dict[int, None] = {}
    for m in SITEMAP_RE.finditer(text):
        seen[int(m.group(1))] = None
    return list(seen)


def book_from_link(link: str | None) -> str | None:
    """'dn1_1' -> 'dn1'; 'sn3_1-2-4-9' -> 'sn3'. None for empty/missing link."""
    if not link:
        return None
    m = re.match(r"([a-z]+\d+)", link.strip())
    return m.group(1) if m else None


def safe_filename(link: str) -> str:
    """Keep only [a-z0-9._-]; fall back to 'sutta' if empty."""
    s = re.sub(r"[^a-z0-9._-]+", "_", link.strip().lower())
    return s or "sutta"
