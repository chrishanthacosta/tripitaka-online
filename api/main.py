"""FastAPI backend for the local Tripitaka mirror.

Serves the React frontend (web/dist) when built, plus a JSON API:

    GET /api/stats                 dataset counts
    GET /api/books                 book groups + sutta counts
    GET /api/suttas?book=&q=&...   list suttas (filter by book / label / link)
    GET /api/suttas/{id}           one sutta with ordered blocks
    GET /api/suttas/{id}/neighbors prev/next sutta within the same book
    GET /api/search?q=&lang=&...   block-level substring search (pg_trgm/ILIKE)

Run (dev):
    uvicorn api.main:app --reload --port 8080
"""
from __future__ import annotations

import os
import re
import sqlite3
import sys
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "scripts"))
from api.db import open_pool, pool  # noqa: E402
from dict_common import clean_si_word, roman_key, si2roman, strip_zw  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "web" / "dist"
DICTS_SQLITE = ROOT / "data" / "dicts" / "dicts.sqlite"

SOURCE_LABELS = {
    "dpd": "Digital Pāḷi Dictionary (Pali→English)",
    "ncped": "NCPED — New Concise Pali-English (Buddhadatta)",
    "ped": "PTS Pāli-English Dictionary (PED)",
    "buddhadatta": "Pali-Sinhala Dictionary (Buddhadatta)",
    "sumangala": "Pali-Sinhala Dictionary (Sumangala)",
    "sin_eng_sin": "Sinhala↔English Dictionary",
}


def _nasal_fold(key: str) -> str:
    """'saṃgha' -> 'saṅgha' key (anusvara before velars)."""
    return re.sub(r"ṃ(?=[kg])", "ṅ", key)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    open_pool()
    yield
    pool.close()


app = FastAPI(title="Tripitaka Local", version="0.1.0", lifespan=lifespan)

# Dev convenience: allow the Vite dev server to call the API directly.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------
class Book(BaseModel):
    book: str
    count: int


class SuttaMeta(BaseModel):
    source_id: int
    link: Optional[str]
    label: str
    book: Optional[str]


class Block(BaseModel):
    seq: int
    tag: str
    class_: str
    lang: Optional[str]
    content: str

    model_config = {"populate_by_name": True}


class SuttaDetail(SuttaMeta):
    url: str
    blocks: list[Block]
    prev: Optional[SuttaMeta] = None
    next: Optional[SuttaMeta] = None


class SearchHit(BaseModel):
    source_id: int
    link: Optional[str]
    label: str
    book: Optional[str]
    seq: int
    lang: Optional[str]
    content: str


class SearchResult(BaseModel):
    query: str
    total: int
    hits: list[SearchHit]


class Stats(BaseModel):
    suttas: int
    blocks: int
    books: int
    pali_blocks: int
    sinhala_blocks: int


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------
@app.get("/api/stats", response_model=Stats)
def stats() -> Stats:
    with pool.connection() as conn:
        suttas = conn.execute("SELECT count(*) FROM suttas").fetchone()[0]
        blocks = conn.execute("SELECT count(*) FROM blocks").fetchone()[0]
        books = conn.execute("SELECT count(DISTINCT book) FROM suttas WHERE book IS NOT NULL").fetchone()[0]
        pali = conn.execute("SELECT count(*) FROM blocks WHERE lang = 'pali'").fetchone()[0]
        sinhala = conn.execute("SELECT count(*) FROM blocks WHERE lang = 'sinhala'").fetchone()[0]
    return Stats(suttas=suttas, blocks=blocks, books=books, pali_blocks=pali, sinhala_blocks=sinhala)


@app.get("/api/books", response_model=list[Book])
def books() -> list[Book]:
    with pool.connection() as conn:
        rows = conn.execute(
            "SELECT book, count(*) FROM suttas WHERE book IS NOT NULL GROUP BY book ORDER BY book"
        ).fetchall()
    return [Book(book=r[0], count=r[1]) for r in rows]


@app.get("/api/suttas")
def list_suttas(
    book: Optional[str] = None,
    q: Optional[str] = None,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> dict:
    where: list[str] = []
    params: dict = {"limit": limit, "offset": offset}
    if book:
        where.append("book = %(book)s")
        params["book"] = book
    if q:
        where.append("(label ILIKE %(q)s OR link ILIKE %(q)s)")
        params["q"] = f"%{q}%"
    cond = (" WHERE " + " AND ".join(where)) if where else ""
    with pool.connection() as conn:
        total = conn.execute(f"SELECT count(*) FROM suttas{cond}", params).fetchone()[0]
        rows = conn.execute(
            f"SELECT source_id, link, label, book FROM suttas{cond} "
            "ORDER BY source_id LIMIT %(limit)s OFFSET %(offset)s",
            params,
        ).fetchall()
    return {
        "total": total,
        "offset": offset,
        "limit": limit,
        "items": [SuttaMeta(source_id=r[0], link=r[1], label=r[2], book=r[3]) for r in rows],
    }


def _sutta_meta(conn, source_id: int) -> Optional[SuttaMeta]:
    row = conn.execute(
        "SELECT source_id, link, label, book FROM suttas WHERE source_id = %s", (source_id,)
    ).fetchone()
    if not row:
        return None
    return SuttaMeta(source_id=row[0], link=row[1], label=row[2], book=row[3])


@app.get("/api/suttas/{source_id}", response_model=SuttaDetail)
def sutta(source_id: int) -> SuttaDetail:
    with pool.connection() as conn:
        meta = _sutta_meta(conn, source_id)
        if not meta:
            raise HTTPException(404, f"no sutta with source_id {source_id}")
        block_rows = conn.execute(
            "SELECT seq, tag, class, lang, content FROM blocks "
            "WHERE sutta_id = (SELECT id FROM suttas WHERE source_id = %s) ORDER BY seq",
            (source_id,),
        ).fetchall()
    blocks = [
        Block(seq=r[0], tag=r[1], class_=r[2], lang=r[3], content=r[4]) for r in block_rows
    ]
    return SuttaDetail(
        source_id=meta.source_id, link=meta.link, label=meta.label, book=meta.book,
        url=f"https://tripitaka.online/sutta/{source_id}", blocks=blocks,
    )


@app.get("/api/suttas/{source_id}/neighbors")
def neighbors(source_id: int) -> dict:
    """Prev/next sutta within the same book (ordered by source_id)."""
    with pool.connection() as conn:
        book = conn.execute("SELECT book FROM suttas WHERE source_id = %s", (source_id,)).fetchone()
        if not book:
            raise HTTPException(404, f"no sutta with source_id {source_id}")
        book = book[0]
        prev_row = conn.execute(
            "SELECT source_id, link, label, book FROM suttas "
            "WHERE book = %s AND source_id < %s ORDER BY source_id DESC LIMIT 1",
            (book, source_id),
        ).fetchone()
        next_row = conn.execute(
            "SELECT source_id, link, label, book FROM suttas "
            "WHERE book = %s AND source_id > %s ORDER BY source_id ASC LIMIT 1",
            (book, source_id),
        ).fetchone()

    def to_meta(r) -> Optional[SuttaMeta]:
        return SuttaMeta(source_id=r[0], link=r[1], label=r[2], book=r[3]) if r else None

    return {"prev": to_meta(prev_row), "next": to_meta(next_row)}


def _escape_like(s: str) -> str:
    return s.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


@app.get("/api/search", response_model=SearchResult)
def search(
    q: str = Query(..., min_length=1, max_length=200),
    lang: Optional[str] = Query(None, pattern="^(pali|sinhala)$"),
    book: Optional[str] = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
) -> SearchResult:
    pat = f"%{_escape_like(q.strip())}%"
    where = ["b.content ILIKE %(pat)s ESCAPE '\\'"]
    params: dict = {"pat": pat, "limit": limit, "offset": offset}
    if lang:
        where.append("b.lang = %(lang)s")
        params["lang"] = lang
    if book:
        where.append("s.book = %(book)s")
        params["book"] = book
    cond = " AND ".join(where)
    with pool.connection() as conn:
        total = conn.execute(
            f"SELECT count(*) FROM blocks b JOIN suttas s ON s.id = b.sutta_id WHERE {cond}",
            params,
        ).fetchone()[0]
        rows = conn.execute(
            f"SELECT s.source_id, s.link, s.label, s.book, b.seq, b.lang, b.content "
            f"FROM blocks b JOIN suttas s ON s.id = b.sutta_id WHERE {cond} "
            "ORDER BY s.source_id, b.seq LIMIT %(limit)s OFFSET %(offset)s",
            params,
        ).fetchall()
    hits = [
        SearchHit(source_id=r[0], link=r[1], label=r[2], book=r[3], seq=r[4], lang=r[5], content=r[6])
        for r in rows
    ]
    return SearchResult(query=q, total=total, hits=hits)


# ---------------------------------------------------------------------------
# Dictionary lookups (unified sqlite built by scripts/dict_build.py)
# ---------------------------------------------------------------------------
class DictEntry(BaseModel):
    word_si: Optional[str] = None
    word_roman: Optional[str] = None
    pos: Optional[str] = None
    definition: str
    detail: Optional[str] = None
    root: Optional[str] = None
    sanskrit: Optional[str] = None
    examples: Optional[str] = None
    match: str = "exact"  # exact | prefix


class DictGroup(BaseModel):
    source: str
    label: str
    entries: list[DictEntry]


class DictResult(BaseModel):
    word: str
    roman: Optional[str]
    groups: list[DictGroup]


class SuttaRef(BaseModel):
    source_id: int
    link: Optional[str]
    label: str
    hits: int


class DictRefs(BaseModel):
    word: str
    total: int
    suttas: list[SuttaRef]


def _dict_conn():
    if not DICTS_SQLITE.exists():
        raise HTTPException(404, "dictionary database not built — run `python3 scripts/dict_build.py`")
    return sqlite3.connect(DICTS_SQLITE, check_same_thread=False)


def _lookup_entries(word: str, limit: int) -> list[tuple]:
    """Returns (source, word_si, word_roman, pos, definition, detail, root,
    sanskrit, examples, rank)."""
    si = clean_si_word(word) if re.search(r"[\u0d80-\u0dff]", word) else ""
    roman = si2roman(word) if si else word
    rk = roman_key(roman)
    rk2 = _nasal_fold(rk)

    conn = _dict_conn()
    rows = []
    try:
        # exact Sinhala headword or Sinhala inflection alias
        if si:
            rows += [
                (*r, 0)
                for r in conn.execute(
                    "SELECT DISTINCT e.source, e.word_si, e.word_roman, e.pos, e.definition, e.detail, e.root, e.sanskrit, e.examples "
                    "FROM entries e LEFT JOIN aliases a ON a.entry_id = e.id "
                    "WHERE e.word_si = ? OR a.alias_si = ?",
                    (si, si),
                ).fetchall()
            ]
        # exact Roman headword or Roman inflection alias
        for k in {rk, rk2}:
            rows += [
                (*r, 1)
                for r in conn.execute(
                    "SELECT DISTINCT e.source, e.word_si, e.word_roman, e.pos, e.definition, e.detail, e.root, e.sanskrit, e.examples "
                    "FROM entries e LEFT JOIN aliases a ON a.entry_id = e.id "
                    "WHERE e.word_roman_key = ? OR e.word_roman_key2 = ? OR a.alias_roman_key = ?",
                    (k, k, k),
                ).fetchall()
            ]
        if len(rk) >= 3:
            # word is a prefix of the entry (e.g. clicked 'mettā' -> 'mettāya')
            rows += [
                (*r, 2)
                for r in conn.execute(
                    "SELECT source, word_si, word_roman, pos, definition, detail, root, sanskrit, examples FROM entries "
                    "WHERE (word_roman_key LIKE ? || '%' OR word_roman_key2 LIKE ? || '%')",
                    (rk, rk),
                ).fetchall()
            ]
            # entry is a prefix of the word (e.g. clicked 'සුතං' -> stem 'suta')
            rows += [
                (*r, 3)
                for r in conn.execute(
                    "SELECT source, word_si, word_roman, pos, definition, detail, root, sanskrit, examples FROM entries "
                    "WHERE (? LIKE word_roman_key || '%' OR ? LIKE word_roman_key2 || '%') "
                    "AND length(word_roman_key) >= 3",
                    (rk, rk),
                ).fetchall()
            ]
    finally:
        conn.close()

    # dedupe (keep best rank), then cap per source
    best: dict[tuple, tuple] = {}
    for r in rows:
        key = (r[0], r[1], r[2], r[4])
        prev = best.get(key)
        if prev is None or r[9] < prev[9]:
            best[key] = r
    uniq = sorted(best.values(), key=lambda r: (r[9], r[0], r[2] or ""))
    return uniq[: limit * 4]


@app.get("/api/dict", response_model=DictResult)
def dict_lookup(
    word: str = Query(..., min_length=1, max_length=100),
    limit: int = Query(25, ge=1, le=100),
) -> DictResult:
    si = clean_si_word(word) if re.search(r"[\u0d80-\u0dff]", word) else word.strip().lower()
    if not si:
        raise HTTPException(422, "empty word")
    roman = si2roman(si) if re.search(r"[\u0d80-\u0dff]", si) else si
    groups: dict[str, list[DictEntry]] = {}
    for src, wsi, wrom, pos, definition, detail, root, sanskrit, examples, rank in _lookup_entries(si, limit):
        groups.setdefault(src, []).append(
            DictEntry(
                word_si=wsi, word_roman=wrom, pos=pos, definition=definition,
                detail=detail, root=root, sanskrit=sanskrit, examples=examples,
                match="exact" if rank < 2 else "prefix",
            )
        )
    for g in groups.values():
        g[:] = g[:limit]
    return DictResult(
        word=si,
        roman=roman,
        groups=[
            DictGroup(source=s, label=SOURCE_LABELS.get(s, s), entries=entries)
            for s, entries in groups.items()
        ],
    )


@app.get("/api/dict/refs", response_model=DictRefs)
def dict_refs(
    word: str = Query(..., min_length=2, max_length=100),
    lang: str = Query("pali", pattern="^(pali|sinhala)$"),
) -> DictRefs:
    """Where the word occurs in the corpus (per sutta, most hits first)."""
    pat = f"%{word.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')}%"
    with pool.connection() as conn:
        total = conn.execute(
            "SELECT count(*) FROM blocks b JOIN suttas s ON s.id = b.sutta_id "
            "WHERE b.lang = %s AND b.content ILIKE %s ESCAPE '\\'",
            (lang, pat),
        ).fetchone()[0]
        rows = conn.execute(
            "SELECT s.source_id, s.link, s.label, count(b.id) AS hits "
            "FROM blocks b JOIN suttas s ON s.id = b.sutta_id "
            "WHERE b.lang = %s AND b.content ILIKE %s ESCAPE '\\' "
            "GROUP BY s.source_id, s.link, s.label "
            "ORDER BY hits DESC, s.source_id LIMIT 100",
            (lang, pat),
        ).fetchall()
    return DictRefs(
        word=word,
        total=total,
        suttas=[SuttaRef(source_id=r[0], link=r[1], label=r[2], hits=r[3]) for r in rows],
    )


# ---------------------------------------------------------------------------
# SPA serving (built React app in web/dist)
# ---------------------------------------------------------------------------
@app.get("/{full_path:path}", include_in_schema=False)
def spa(full_path: str):
    if not DIST.is_dir():
        return JSONResponse(
            {"detail": "frontend not built — run `pnpm --dir web build` (see README)"},
            status_code=404,
        )
    candidate = (DIST / full_path).resolve()
    # Never escape the dist directory.
    if full_path and candidate.is_file() and DIST.resolve() in candidate.parents:
        return FileResponse(candidate)
    return FileResponse(DIST / "index.html")


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("api.main:app", host="0.0.0.0", port=int(os.environ.get("PORT", "8080")))
