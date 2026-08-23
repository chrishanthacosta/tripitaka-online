#!/usr/bin/env python3
"""Build a unified dictionary database (data/dicts/dicts.sqlite) from the
downloaded sources in data/dicts/raw/.

Sources -> unified `entries` table:

  DPD           dpd-txt/dpd.txt          Pali -> English (rich: POS, IPA, synonyms…)
  NCPED         ncped.json               Pali -> English (concise)
  PED           ptsped-sql/*.sql         Pali -> English (PTS, HTML defs)
  Buddhadatta   buddhadatta_dict.json    Pali -> Sinhala
  Sumangala     sumangala_dict.json      Pali -> Sinhala
  sin-eng-sin   sin-eng-sin/ (StarDict)  Sinhala <-> English (best effort)

Every entry gets a Sinhala-script key (word_si) when the headword is Sinhala
script, and Roman keys (word_roman, word_roman_key = diacritic-stripped,
word_roman_key2 = + nasal-fold ṃ>ṅ before velars) when it is Roman script.
The corpus is Sinhala script, so lookups transliterate the clicked word to
Roman and match on the keys.

Usage:
    python3 scripts/dict_build.py
"""
from __future__ import annotations

import json
import re
import sqlite3
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from dict_common import (  # noqa: E402
    clean_si_word,
    roman_key,
    si2roman,
    strip_html,
    strip_zw,
)

RAW = Path(__file__).resolve().parent.parent / "data" / "dicts" / "raw"
OUT = Path(__file__).resolve().parent.parent / "data" / "dicts" / "dicts.sqlite"

SCHEMA = """
CREATE TABLE IF NOT EXISTS entries (
    id              INTEGER PRIMARY KEY,
    source          TEXT NOT NULL,          -- dpd | ncped | ped | buddhadatta | sumangala | sin_eng_sin
    word_si         TEXT,                   -- Sinhala-script headword (normalized)
    word_roman      TEXT,                   -- Roman-script headword (display)
    word_roman_key  TEXT,                   -- diacritic-stripped lowercase
    word_roman_key2 TEXT,                   -- + nasal fold ṃ>ṅ before velars
    pos             TEXT,
    definition      TEXT NOT NULL,
    detail          TEXT,                   -- extra info (DPD grammar/synonyms…)
    root            TEXT,                   -- DPD: root + meaning, e.g. "√bhū: become"
    sanskrit        TEXT,                   -- DPD: Sanskrit equivalent
    examples        TEXT                    -- DPD: example sentences with sutta refs
);
CREATE INDEX IF NOT EXISTS idx_word_si        ON entries(word_si);
CREATE INDEX IF NOT EXISTS idx_word_roman_key ON entries(word_roman_key);
CREATE INDEX IF NOT EXISTS idx_word_roman_key2 ON entries(word_roman_key2);

-- Inflected-form aliases (mainly DPD Sinhala-script declensions) so clicked
-- corpus words match even when they are inflected forms of a headword.
CREATE TABLE IF NOT EXISTS aliases (
    alias_si        TEXT,
    alias_roman_key TEXT,
    entry_id        INTEGER NOT NULL REFERENCES entries(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_alias_si    ON aliases(alias_si);
CREATE INDEX IF NOT EXISTS idx_alias_roman ON aliases(alias_roman_key);
"""

_SI_RE = re.compile(r"[\u0d80-\u0dff]")


def has_sinhala(s: str) -> bool:
    return bool(_SI_RE.search(s))


def nasal_fold(key: str) -> str:
    """'saṃgha' -> 'sangha' (anusvara becomes velar nasal before velars)."""
    return re.sub(r"ṃ(?=[kg])", "ṅ", key)


def add_row(cur, source, word_si, word_roman, pos, definition, detail=None,
            root=None, sanskrit=None, examples=None) -> int:
    word_roman_norm = (word_roman or "").strip().lower()
    # drop DPD homograph numbers ("suta 1.1" -> "suta") for key matching
    key_src = re.sub(r"\s\d+(\.\d+)*$", "", word_roman_norm)
    cur.execute(
        "INSERT INTO entries (source, word_si, word_roman, word_roman_key, word_roman_key2, pos, definition, detail, root, sanskrit, examples) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            source,
            word_si or None,
            word_roman_norm or None,
            roman_key(key_src) if key_src else None,
            nasal_fold(roman_key(key_src)) if key_src else None,
            pos or None,
            definition,
            detail,
            root,
            sanskrit,
            examples,
        ),
    )
    return cur.lastrowid


def add_alias(cur, alias_si, alias_roman_key, entry_id):
    cur.execute(
        "INSERT INTO aliases (alias_si, alias_roman_key, entry_id) VALUES (?, ?, ?)",
        (alias_si or None, alias_roman_key or None, entry_id),
    )


# ---------------------------------------------------------------------------
# DPD — full database (dpd_headwords + dpd_roots), fallback to plain text
# ---------------------------------------------------------------------------
def _format_examples(src1, sut1, ex1, src2, sut2, ex2) -> str | None:
    parts = []
    for src, sut, ex in ((src1, sut1, ex1), (src2, sut2, ex2)):
        if ex:
            ex = strip_html(ex).strip()
            ref = f"{src} {sut}".strip()
            parts.append(f"{ref}: {ex}" if ref else ex)
    return "\n\n".join(parts) if parts else None


def parse_dpd_db(path: Path, cur) -> int:
    import json as _json

    conn = sqlite3.connect(f"file:{path}?mode=ro", uri=True)
    roots = {r[0]: r[1] for r in conn.execute("SELECT root, root_meaning FROM dpd_roots")}
    rows = conn.execute(
        """SELECT lemma_1, pos, grammar, meaning_1, meaning_lit, meaning_2, sanskrit,
                  root_key, derivative, suffix, construction, synonym, antonym,
                  source_1, sutta_1, example_1, source_2, sutta_2, example_2,
                  inflections, inflections_sinhala
           FROM dpd_headwords"""
    )
    n = 0
    for r in rows:
        (lemma, pos, grammar, m1, mlit, m2, sanskrit, root_key, derivative, suffix,
         construction, synonym, antonym, src1, sut1, ex1, src2, sut2, ex2,
         inflections, inf_si) = r
        if not lemma:
            continue
        defn = m1 or ""
        if mlit:
            defn += f" (lit. {mlit})"
        if m2 and m2.strip() and m2.strip() not in (m1 or ""):
            defn += f"; {m2}"
        root = None
        if root_key:
            root = root_key
            if root_key in roots and roots[root_key]:
                root += f": {roots[root_key]}"
        detail = None
        extras = []
        for k, v in (("grammar", grammar), ("derivative", derivative), ("suffix", suffix),
                     ("construction", construction), ("synonym", synonym), ("antonym", antonym)):
            if v:
                extras.append(f"{k}: {v}")
        if extras:
            detail = "\n".join(extras)
        entry_id = add_row(
            cur, "dpd", None, lemma, pos, defn or lemma, detail,
            root=root, sanskrit=sanskrit or None,
            examples=_format_examples(src1, sut1, ex1, src2, sut2, ex2),
        )
        # Sinhala-script inflected forms -> direct corpus matching
        for form in (inf_si or "").split(","):
            si = clean_si_word(form)
            if si:
                add_alias(cur, si, None, entry_id)
        # Roman inflected forms
        for form in (inflections or "").split(","):
            rk = roman_key(form.strip())
            if len(rk) >= 2:
                add_alias(cur, None, rk, entry_id)
        n += 1
    conn.close()
    return n


def parse_dpd(path: Path, cur) -> int:
    text = path.read_text(encoding="utf-8")
    blocks = re.split(r"\n\s*\n", text)
    n = 0
    for b in blocks:
        lines = [l for l in b.splitlines() if l.strip()]
        if not lines:
            continue
        first = lines[0]
        head, _, rest = first.partition(", ")
        word = head.strip()
        if not rest and " " in head:
            # "word homograph," without definition on same line
            word = head.split()[0]
            rest = ""
        # drop homograph number: "a 1.1" -> "a"
        parts = word.split()
        if len(parts) > 1 and re.fullmatch(r"\d+(\.\d+)?", parts[1]):
            word = parts[0]
        word = word.strip().rstrip(".")
        # strip the ✔/✘ marker from the definition
        rest = re.sub(r"[✔✘]$", "", rest).strip()
        # leading POS token: "adj. smooth; ..." / "cs. (gram) ..."
        pos = None
        m = re.match(r"^([a-z.]+\.)\s+(.*)$", rest, re.S)
        if m and "." in m.group(1):
            pos = m.group(1).rstrip(".")
            rest = m.group(2).strip()
        # detail = indented lines (IPA, Grammar, Synonym, …)
        detail_lines = []
        for l in lines[1:]:
            if l.startswith("  ") or l.startswith("\t"):
                detail_lines.append(l.strip())
        detail = "\n".join(detail_lines) if detail_lines else None
        if not word:
            continue
        add_row(cur, "dpd", None, word, pos, rest or word, detail)
        n += 1
    return n


def _to_text(v) -> str:
    if v is None:
        return ""
    if isinstance(v, (list, tuple)):
        return "; ".join(_to_text(x) for x in v)
    return str(v)


# ---------------------------------------------------------------------------
# NCPED (SuttaCentral JSON: list of {entry, grammar, definition})
# ---------------------------------------------------------------------------
def parse_ncped(path: Path, cur) -> int:
    data = json.loads(path.read_text(encoding="utf-8"))
    n = 0
    for e in data:
        word = _to_text(e.get("entry")).strip()
        if not word:
            continue
        add_row(cur, "ncped", None, word, _to_text(e.get("grammar")), _to_text(e.get("definition")))
        n += 1
    return n


# ---------------------------------------------------------------------------
# PED (SQL INSERT dump: VALUES ('word','<html>',id);)
# ---------------------------------------------------------------------------
def parse_ped(path: Path, cur) -> int:
    text = path.read_text(encoding="utf-8", errors="replace")
    pat = re.compile(r"INSERT INTO \"?dictionary\"? VALUES \('((?:[^']|'')*)','((?:[^']|'')*)'", re.S)
    n = 0
    for m in pat.finditer(text):
        word = m.group(1).replace("''", "'").strip()
        definition = strip_html(m.group(2).replace("''", "'"))
        if not word or not re.search(r"[A-Za-z]", word):
            continue
        add_row(cur, "ped", None, word, None, definition)
        n += 1
    return n


# ---------------------------------------------------------------------------
# Buddhadatta / Sumangala (JSON list of [word_si, def_html])
# ---------------------------------------------------------------------------
def parse_pali_si(path: Path, cur, source: str) -> int:
    data = json.loads(path.read_text(encoding="utf-8"))
    n = 0
    for e in data:
        if not isinstance(e, (list, tuple)) or len(e) < 2:
            continue
        word = clean_si_word(str(e[0]))
        definition = strip_html(str(e[1]))
        if not word or not definition:
            continue
        roman = si2roman(word)
        add_row(cur, source, word, roman, None, definition)
        n += 1
    return n


# ---------------------------------------------------------------------------
# sin-eng-sin (StarDict: .idx + .dict[.dz])
# ---------------------------------------------------------------------------
def parse_stardict(d: Path, cur, source: str) -> int:
    import gzip

    idx_path = next(d.glob("*.idx"))
    dict_path = next(d.glob("*.dict*"))
    raw_idx = idx_path.read_bytes()
    if dict_path.suffix == ".dz":
        with gzip.open(dict_path, "rb") as f:
            raw_dict = f.read()
    else:
        raw_dict = dict_path.read_bytes()

    n = 0
    pos = 0
    while pos < len(raw_idx):
        end = raw_idx.index(b"\x00", pos)
        word = raw_idx[pos:end].decode("utf-8", errors="replace").strip()
        off, size = struct.unpack(">II", raw_idx[end + 1 : end + 9])
        data = raw_dict[off : off + size].decode("utf-8", errors="replace")
        pos = end + 9
        # skip OCR garbage
        if not word or len(word) < 2 or not re.search(r"[\u0d80-\u0dffA-Za-z]", word):
            continue
        if re.match(r"^[\W\d_]+$", word):
            continue
        definition = strip_html(data)
        if not definition:
            continue
        if has_sinhala(word):
            si = clean_si_word(word)
            if not si:
                continue
            add_row(cur, source, si, si2roman(si), None, definition)
        else:
            add_row(cur, source, None, word, None, definition)
        n += 1
    return n


def main() -> int:
    OUT.parent.mkdir(parents=True, exist_ok=True)
    if OUT.exists():
        OUT.unlink()
    conn = sqlite3.connect(OUT)
    cur = conn.cursor()
    cur.executescript(SCHEMA)

    counts = {}
    dpd_db = RAW / "dpd.db"
    dpd_txt = RAW / "dpd-txt" / "dpd.txt"
    if dpd_db.exists():
        print("  DPD: indexing full database (dpd.db)…")
        counts["dpd"] = parse_dpd_db(dpd_db, cur)
    elif dpd_txt.exists():
        counts["dpd"] = parse_dpd(dpd_txt, cur)
    else:
        print("  DPD: no dpd.db or dpd.txt found — run scripts/dict_download.py")
    ncped = RAW / "ncped.json"
    if ncped.exists():
        counts["ncped"] = parse_ncped(ncped, cur)
    ped_files = list((RAW / "ptsped-sql").glob("*.sql")) if (RAW / "ptsped-sql").exists() else []
    if ped_files:
        counts["ped"] = parse_ped(ped_files[0], cur)
    for name, fname, src in (
        ("buddhadatta", "buddhadatta_dict.json", "buddhadatta"),
        ("sumangala", "sumangala_dict.json", "sumangala"),
    ):
        p = RAW / fname
        if p.exists():
            counts[src] = parse_pali_si(p, cur, src)
    sd = RAW / "sin-eng-sin"
    if sd.exists() and any(sd.glob("*.idx")):
        counts["sin_eng_sin"] = parse_stardict(sd, cur, "sin_eng_sin")

    conn.commit()
    total = sum(counts.values())
    print("entries per source:", counts)
    print(f"TOTAL: {total} entries -> {OUT} ({OUT.stat().st_size // 1024} KB)")
    conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
