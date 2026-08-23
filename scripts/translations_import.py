#!/usr/bin/env python3
"""Import the Buddha Jayanthi (BJT) Sinhala translation into PostgreSQL.

Source: tipitaka.lk (pathnirvana/tipitaka.lk) — Buddha Jayanthi Tripitaka of
Sri Lanka and its Sinhala translation, as SQLite databases.

    python3 scripts/translations_download.py   # fetch data.zip -> data/translations/
    python3 scripts/translations_import.py     # build mapping + insert into PG
    python3 scripts/translations_import.py --report   # measure mapping coverage only

Matching: our suttas' Pali blocks are anchored (transliterated to a
diacritic-insensitive Roman key) against the BJT Pali segments, scoped to the
right book file(s). The BJT and Mahamevnawa editions both translate the same
Pali paragraph-by-paragraph, so paragraph counts align 1:1.
"""
from __future__ import annotations

import argparse
import json
import re
import sqlite3
import sys
from pathlib import Path

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import DATABASE_URL  # noqa: E402
from dict_common import roman_key, si2roman, strip_zw  # noqa: E402

DATA_DIR = Path(__file__).resolve().parent.parent / "data" / "translations"
FTS_DB = DATA_DIR / "fts.db"
TREE_JSON = DATA_DIR / "tree.json"

# book (our scheme) -> candidate BJT files
BOOK_FILES = {
    "dn1": ["dn-1"], "dn2": ["dn-2"], "dn3": ["dn-3"],
    "mn1": [f"mn-1-{i}" for i in range(1, 6)],
    "mn2": [f"mn-2-{i}" for i in range(1, 6)],
    "mn3": [f"mn-3-{i}" for i in range(1, 6)],
    "sn1": ["sn-1", "sn-1-3", "sn-1-7"],
    "sn2": ["sn-2", "sn-2-1-5", "sn-2-2", "sn-2-5"],
    "sn3": ["sn-3", "sn-3-1-2", "sn-3-1-3", "sn-3-2", "sn-3-7"],
    "sn4": ["sn-4", "sn-4-1-12", "sn-4-2", "sn-4-8"],
    "sn5": ["sn-5", "sn-5-11", "sn-5-12", "sn-5-2", "sn-5-3", "sn-5-4", "sn-5-7"],
    "an1": ["an-1"], "an2": ["an-2"], "an3": ["an-3"], "an4": ["an-4"],
    "an5": ["an-5"], "an6": ["an-6"], "an7": ["an-7"], "an8": ["an-8"],
    "an9": ["an-9"], "an10": ["an-10"], "an11": ["an-11"],
}

KN_PREFIXES = ("kn-", "kn")
MISC_FILES = ("dn-", "mn-", "sn-", "an-", "kn-")


def _key(s: str) -> str:
    """Transliterate + diacritic-strip + normalize a Pali segment."""
    s = strip_zw(s)
    s = re.sub(r"^\s*\d+[.)]?\s*", "", s)
    s = re.sub(r"[\u0d82\u0d83.,;:!?()\"\u201c\u201d\u2018\u2019\-]+", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return roman_key(si2roman(s))


def _eind_key(e: str) -> tuple[int, int]:
    p, _, l = e.partition("-")
    return int(p), int(l)


def load_bjt() -> dict[str, list[dict]]:
    """file -> ordered segments [{eind, page, line, lang, type, text, key}]."""
    conn = sqlite3.connect(f"file:{FTS_DB}?mode=ro", uri=True)
    files: dict[str, list[dict]] = {}
    for fname, eind, lang, stype, text in conn.execute(
        "SELECT c0filename, c1eind, c2language, c3type, c5text FROM tipitaka_content"
    ):
        files.setdefault(fname, []).append({
            "eind": eind,
            "page": _eind_key(eind)[0],
            "line": _eind_key(eind)[1],
            "lang": lang,
            "type": stype,
            "text": text,
            "key": _key(text) if lang == "pali" else None,
        })
    conn.close()
    for segs in files.values():
        segs.sort(key=lambda s: (s["page"], s["line"]))
    return files


def build_anchor_index(segs: list[dict]) -> dict[str, list[int]]:
    """prefix15 -> segment indices (only pali paragraphs)."""
    idx: dict[str, list[int]] = {}
    for i, s in enumerate(segs):
        if s["lang"] == "pali" and s["key"]:
            k = s["key"][:15]
            if len(k) >= 10:
                idx.setdefault(k, []).append(i)
    return idx


def lcp(a: str, b: str) -> int:
    n = min(len(a), len(b))
    i = 0
    while i < n and a[i] == b[i]:
        i += 1
    return i


def lcp_match(segs: list[dict], idx: dict[str, list[int]], anchor: str, min_lcp: int, top_n: int = 8):
    """Top (idx, lcp_len) candidates whose key shares a long prefix with anchor."""
    cands = idx.get(anchor[:15], [])
    out = []
    for i in cands:
        k = segs[i]["key"] or ""
        c = lcp(anchor, k)
        if c >= min_lcp:
            out.append((i, c))
    out.sort(key=lambda x: (-x[1], x[0]))
    return out[:top_n]


# common opening formulas (roman keys) — skip these when choosing the anchor
FORMULAS = (
    "eva me suta", "tena kho pana samayena", "atha kho", "tatra suda",
    "evam vutte", "idam avoca", "evam eva kho", "ekam samayam",
    "suta maya", "evam me", "tena kho",
)


def is_formula(key: str) -> bool:
    k = key[:20]
    return any(k.startswith(f) for f in FORMULAS)


def pick_anchor(blocks_pali: list[str]) -> str | None:
    """First non-formula block's key (most distinctive anchor)."""
    for b in blocks_pali[:6]:
        k = _key(b)
        if len(k) >= 20 and not is_formula(k):
            return k[:80]
    return None


def build_word_index(files: dict[str, list[dict]]) -> dict[str, list[tuple[str, int]]]:
    """word -> [(file, segment_idx)] across all Pali segments."""
    idx: dict[str, list[tuple[str, int]]] = {}
    for fname, segs in files.items():
        for i, s in enumerate(segs):
            if s["lang"] != "pali" or not s["key"]:
                continue
            for w in set(s["key"].split()):
                if len(w) >= 4:
                    idx.setdefault(w, []).append((fname, i))
    return idx


def find_range(blocks_pali: list[str], files: dict[str, list[dict]], scope: list[str],
               word_idx: dict[str, list[tuple[str, int]]], min_start: int = -1) -> tuple[str | None, int, int]:
    """(file, start_idx, end_idx). start via rare-word anchor + opening walk-back
    bounded below by min_start; end via the last block's LCP match forward."""
    if not blocks_pali:
        return None, 0, 0
    k0 = _key(blocks_pali[0])[:80]
    klast = _key(blocks_pali[-1])[:80]
    words: list[str] = []
    for b in blocks_pali[:8]:
        words += [w for w in _key(b).split() if len(w) >= 5]
    ranked = sorted((len(word_idx.get(w, [])), w) for w in dict.fromkeys(words))
    for n, w in ranked:
        if n == 0 or n > 400:
            continue
        for fname, seg_idx in word_idx[w]:
            if fname not in scope:
                continue
            segs = files[fname]
            idxmap = build_anchor_index(segs)
            start = seg_idx
            for j in range(seg_idx, max(-1, seg_idx - 25), -1):
                if j <= min_start:
                    break
                k = segs[j]["key"] or ""
                if k and lcp(k0, k) >= 20:
                    start = j
                    break
            if start <= min_start:
                start = seg_idx
            # end: last block's LCP match within a generous window
            window = min(len(segs), start + max(60, len(blocks_pali) * 3 + 30))
            end_j, end_c = start, 0
            for j in range(start, window):
                if segs[j]["lang"] != "pali":
                    continue
                c = lcp(klast, segs[j]["key"] or "")
                if c > end_c:
                    end_c, end_j = c, j
            if end_c >= 15:
                end = end_j + 1
            else:
                end = min(window, start + max(20, len(blocks_pali) * 2 + 5))
            return fname, start, end
    # LCP fallback on the most distinctive early block
    for b in blocks_pali[:6]:
        anchor = _key(b)[:80]
        if len(anchor) < 12 or is_formula(anchor):
            continue
        best = None
        for fname in scope:
            segs = files.get(fname)
            if not segs:
                continue
            m = lcp_match(segs, build_anchor_index(segs), anchor, 18, 3)
            for idx, c in m:
                if idx > min_start and (best is None or c > best[1]):
                    best = (fname, idx, c)
        if best:
            fname, start, _ = best
            segs = files[fname]
            window = min(len(segs), start + max(60, len(blocks_pali) * 3 + 30))
            end_j, end_c = start, 0
            for j in range(start, window):
                if segs[j]["lang"] != "pali":
                    continue
                c = lcp(_key(blocks_pali[-1])[:80], segs[j]["key"] or "")
                if c > end_c:
                    end_c, end_j = c, j
            end = end_j + 1 if end_c >= 15 else min(window, start + max(20, len(blocks_pali) * 2 + 5))
            return fname, start, end
    return None, 0, 0


def candidates_for(blocks_pali: list[str], files: dict[str, list[dict]], scope: list[str],
                   word_idx: dict[str, list[tuple[str, int]]] | None = None) -> list[tuple[str, int, int]]:
    """All (file, k1_idx, lcp) candidates across scoped files, ranked."""
    if not blocks_pali:
        return []
    if word_idx is not None:
        fname, start = find_sutta_start(blocks_pali, files, scope, word_idx)
        if fname:
            return [(fname, start, 99)]
        return []
    k0 = _key(blocks_pali[0])[:80]
    anchor = pick_anchor(blocks_pali) or k0
    if len(anchor) < 12:
        return []
    out: list[tuple[str, int, int]] = []
    for fname in scope:
        segs = files.get(fname)
        if not segs:
            continue
        idxmap = build_anchor_index(segs)
        for i, c in lcp_match(segs, idxmap, anchor, min_lcp=18):
            out.append((fname, i, c))
    seen = set()
    uniq = []
    for f, i, c in sorted(out, key=lambda x: (-x[2], x[1])):
        if (f, i) not in seen:
            seen.add((f, i))
            uniq.append((f, i, c))
    return uniq


def match_sutta(blocks_pali: list[str], files: dict[str, list[dict]], scope: list[str]) -> tuple[str | None, int, int]:
    """Best single (file, start_idx, k1_idx) — used by --report's legacy path."""
    if not blocks_pali:
        return None, 0, 0
    k0 = _key(blocks_pali[0])[:80]
    if len(k0) < 10:
        return None, 0, 0
    best = None
    for fname, k1_idx, _ in candidates_for(blocks_pali, files, scope):
        segs = files[fname]
        idxmap = build_anchor_index(segs)
        start = k1_idx
        k0m = lcp_match(segs, idxmap, k0, 15, 1)
        if k0m and k0m[0][0] <= k1_idx and k1_idx - k0m[0][0] <= 8:
            start = k0m[0][0]
        if best is None or start < best[1]:
            best = (fname, start, k1_idx)
    return best if best else (None, 0, 0)


def fetch_our_suttas(cur) -> list[dict]:
    cur.execute(
        """SELECT s.source_id, s.book, s.link, s.label,
                  (SELECT array_agg(content ORDER BY seq) FROM (
                     SELECT content, seq FROM blocks b
                     WHERE b.sutta_id = s.id AND b.lang = 'pali' ORDER BY seq
                  ) x)
           FROM suttas s
           ORDER BY s.source_id"""
    )
    out = []
    for source_id, book, link, label, pali in cur.fetchall():
        out.append({"source_id": source_id, "book": book, "link": link,
                    "label": label, "pali": list(pali) if pali else []})
    return out


def scope_for(book: str | None, link: str | None, all_files: list[str]) -> list[str]:
    if book and book in BOOK_FILES:
        return BOOK_FILES[book]
    if book and book.startswith("kn"):
        return [f for f in all_files if f.startswith(KN_PREFIXES)]
    return [f for f in all_files if f.startswith(MISC_FILES)]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--report", action="store_true", help="only measure mapping coverage")
    ap.add_argument("--dsn", default=DATABASE_URL)
    ap.add_argument("--limit", type=int, help="only import first N suttas (for testing)")
    args = ap.parse_args()

    if not FTS_DB.exists():
        print(f"missing {FTS_DB} — run scripts/translations_download.py first")
        return 2

    print("loading BJT segments…")
    files = load_bjt()
    all_files = sorted(files.keys())
    print("building word index…")
    word_idx = build_word_index(files)

    with psycopg.connect(args.dsn) as conn:
        with conn.cursor() as cur:
            suttas = fetch_our_suttas(cur)
            if args.limit:
                suttas = suttas[: args.limit]

            # per-file: matched suttas -> (start, end); end = next matched start
            per_file: dict[str, list[tuple[int, int, int, str, str, str]]] = {}
            last_end: dict[str, int] = {}
            matched = unmatched = no_pali = 0
            for s in suttas:
                if not s["pali"]:
                    no_pali += 1
                    continue
                scope = scope_for(s["book"], s["link"], all_files)
                # try scoped files, respecting each file's last assigned start
                best = None
                for fname in scope:
                    if fname not in files:
                        continue
                    res = find_range(s["pali"], files, [fname], word_idx,
                                     last_end.get(fname, -1))
                    if res[0]:
                        if best is None or res[1] < best[1]:
                            best = res
                if best is None:
                    unmatched += 1
                    continue
                fname, start, end = best
                per_file.setdefault(fname, []).append(
                    (start, end, s["source_id"], s["link"] or "", s["label"] or "", s["book"] or "")
                )
                last_end[fname] = start
                matched += 1

            print(f"matched={matched} unmatched={unmatched} no_pali={no_pali}")

            if args.report:
                for fname in sorted(per_file):
                    per_file[fname].sort(key=lambda x: x[0])
                sample_miss = [s for s in suttas if s["pali"] and
                               not any(s["source_id"] in [m[1] for m in v] for v in per_file.values())]
                print("sample unmatched:", [(s["link"], s["label"][:30]) for s in sample_miss[:12]])
                return 0

            # assign end indices per file (next matched start or last segment)
            # create/alter the translations table (lang column distinguishes
            # the BJT Pali from the BJT Sinhala segments)
            conn.execute("""CREATE TABLE IF NOT EXISTS translations (
                id BIGSERIAL PRIMARY KEY,
                sutta_id BIGINT NOT NULL REFERENCES suttas(id) ON DELETE CASCADE,
                source TEXT NOT NULL,
                lang TEXT NOT NULL DEFAULT 'sinhala',
                seq INT NOT NULL,
                tag TEXT NOT NULL DEFAULT 'p',
                content TEXT NOT NULL,
                UNIQUE (sutta_id, source, lang, seq))""")
            conn.execute("ALTER TABLE translations ADD COLUMN IF NOT EXISTS lang TEXT NOT NULL DEFAULT 'sinhala'")
            conn.execute("DELETE FROM translations WHERE source = 'bjt'")

            total_rows = 0
            for fname, entries in per_file.items():
                segs = files[fname]
                for start_idx, end_idx, source_id, link, label, book in entries:
                    end_idx = max(end_idx, start_idx + 1)
                    row = cur.execute("SELECT id FROM suttas WHERE source_id = %s", (source_id,)).fetchone()
                    if not row:
                        continue
                    sutta_pk = row[0]
                    # store BOTH languages (BJT Pali + BJT Sinhala) so the reader
                    # can show them side by side, aligned segment by segment
                    for lang, langcode in (("pali", "pali"), ("sinh", "sinhala")):
                        seq = 0
                        for s in segs[start_idx:end_idx]:
                            if s["lang"] != lang:
                                continue
                            cur.execute(
                                "INSERT INTO translations (sutta_id, source, lang, seq, tag, content) "
                                "VALUES (%s, 'bjt', %s, %s, %s, %s)",
                                (sutta_pk, langcode, seq, s["type"], s["text"]),
                            )
                            seq += 1
                            total_rows += 1
            conn.commit()
            print(f"inserted {total_rows} BJT translation rows (pali + sinhala)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
