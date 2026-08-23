"""Sinhala → Roman (IAST/Pali) transliteration and dictionary helpers.

The corpus on tripitaka.online is Pali written in Sinhala script, while DPD /
NCPED / PED use Roman-script Pali (with diacritics). To look a clicked
Sinhala word up in those dictionaries we transliterate it to Roman and match
on a diacritic-insensitive key.

NOTE: codepoint assignments below were verified against the real corpus
(site data) and `unicodedata.name()` — the Sinhala block layout differs from
some commonly-circulated charts (e.g. න=U+0DB1, ත=U+0DAD, ව=U+0DC0, ස=U+0DC3).
"""
from __future__ import annotations

import html
import re
import unicodedata

ZW = "\u200c\u200d"  # zero-width joiner / non-joiner

# ---------------------------------------------------------------------------
# Sinhala -> IAST/Pali Roman
# ---------------------------------------------------------------------------
INDEPENDENT_VOWELS = {
    "\u0d85": "a",   # අ
    "\u0d86": "ā",   # ආ
    "\u0d87": "æ",   # ඇ
    "\u0d88": "ǣ",   # ඈ
    "\u0d89": "i",   # ඉ
    "\u0d8a": "ī",   # ඊ
    "\u0d8b": "u",   # උ
    "\u0d8c": "ū",   # ඌ
    "\u0d8d": "ṛ",   # ඍ
    "\u0d8e": "ṝ",   # ඎ
    "\u0d8f": "ḷ",   # ඏ
    "\u0d90": "ḹ",   # ඐ
    "\u0d91": "e",   # එ
    "\u0d92": "ē",   # ඒ
    "\u0d93": "ai",  # ඓ
    "\u0d94": "o",   # ඔ
    "\u0d95": "ō",   # ඕ
    "\u0d96": "au",  # ඖ
}

VOWEL_SIGNS = {
    "\u0dca": "",    # ් virama -> bare consonant (handled before lookup)
    "\u0dcf": "ā",   # ා
    "\u0dd0": "æ",   # ැ
    "\u0dd1": "ǣ",   # ෑ
    "\u0dd2": "i",   # ි
    "\u0dd3": "ī",   # ී
    "\u0dd4": "u",   # ු
    "\u0dd5": "ū",   # ූ
    "\u0dd6": "ṛ",   # ෘ
    "\u0dd8": "ṝ",   # ෲ
    "\u0dd9": "e",   # ෙ
    "\u0dda": "ē",   # ේ
    "\u0ddb": "ai",  # ෛ
    "\u0ddc": "o",   # ො
    "\u0ddd": "ō",   # ෝ
    "\u0dde": "au",  # ෞ
    "\u0ddf": "ḹ",   # ෳ
}

CONSONANTS = {
    "\u0d9a": "k",   # ක
    "\u0d9b": "kh",  # ඛ
    "\u0d9c": "g",   # ග
    "\u0d9d": "gh",  # ඝ
    "\u0d9e": "ṅ",   # ඞ
    "\u0d9f": "ṅg",  # ඟ (sanyaka ga)
    "\u0da0": "c",   # ච
    "\u0da1": "ch",  # ඡ
    "\u0da2": "j",   # ජ
    "\u0da3": "jh",  # ඣ
    "\u0da4": "ñ",   # ඤ
    "\u0da5": "ñj",  # ඦ (taaluja sanyooga naaksikyaya)
    "\u0da6": "ñj",  # sanyaka ja (rare)
    "\u0da7": "ṭ",   # ට
    "\u0da8": "ṭh",  # ඨ
    "\u0da9": "ḍ",   # ඩ
    "\u0daa": "ḍh",  # ඪ
    "\u0dab": "ṇ",   # ණ
    "\u0dac": "ṇḍ",  # ඬ (sanyaka dda)
    "\u0dad": "t",   # ත
    "\u0dae": "th",  # ථ
    "\u0daf": "d",   # ද
    "\u0db0": "dh",  # ධ
    "\u0db1": "n",   # න
    "\u0db3": "nd",  # ඳ (sanyaka da)
    "\u0db4": "p",   # ප
    "\u0db5": "ph",  # ඵ
    "\u0db6": "b",   # බ
    "\u0db7": "bh",  # භ
    "\u0db8": "m",   # ම
    "\u0db9": "mb",  # ඹ (amba ba)
    "\u0dba": "y",   # ය
    "\u0dbb": "r",   # ර
    "\u0dbd": "l",   # ල
    "\u0dc0": "v",   # ව
    "\u0dc1": "ś",   # ශ
    "\u0dc2": "ṣ",   # ෂ
    "\u0dc3": "s",   # ස
    "\u0dc4": "h",   # හ
    "\u0dc5": "ḷ",   # ළ
    "\u0dc6": "f",   # ෆ
}

SPECIAL = {
    "\u0d82": "ṃ",  # ං anusvara
    "\u0d83": "ḥ",  # ඃ visarga
}


def strip_zw(s: str) -> str:
    return "".join(c for c in s if c not in ZW)


def si2roman(s: str) -> str:
    """Transliterate Sinhala-script Pali to Roman (IAST)."""
    s = strip_zw(s)
    out: list[str] = []
    i = 0
    n = len(s)
    while i < n:
        ch = s[i]
        if ch in CONSONANTS:
            out.append(CONSONANTS[ch])
            i += 1
            while i < n and s[i] in ZW:
                i += 1
            if i < n and s[i] == "\u0dca":  # virama -> bare consonant
                i += 1
                while i < n and s[i] in ZW:
                    i += 1
            elif i < n and s[i] in VOWEL_SIGNS:
                out.append(VOWEL_SIGNS[s[i]])
                i += 1
                while i < n and s[i] in ZW:
                    i += 1
            else:
                out.append("a")  # inherent vowel
        elif ch in INDEPENDENT_VOWELS:
            out.append(INDEPENDENT_VOWELS[ch])
            i += 1
        elif ch in SPECIAL:
            out.append(SPECIAL[ch])
            i += 1
        elif ch in VOWEL_SIGNS:
            v = VOWEL_SIGNS[ch]
            if v:
                out.append(v)
            i += 1
        elif ch in ZW:
            i += 1
        else:
            out.append(ch.lower())
            i += 1
    return "".join(out)


# ---------------------------------------------------------------------------
# Normalization
# ---------------------------------------------------------------------------
def roman_key(s: str) -> str:
    """Diacritic-insensitive, lowercased key for Roman Pali."""
    s = unicodedata.normalize("NFD", s.lower())
    return "".join(c for c in s if unicodedata.category(c) != "Mn")


def strip_html(s: str) -> str:
    s = re.sub(r"<[^>]+>", "", s)
    s = html.unescape(s)
    s = re.sub(r"[ \t]+", " ", s)
    return s.strip()


def clean_si_word(s: str) -> str:
    """Normalize a Sinhala headword for indexing (letters/spaces only)."""
    s = strip_zw(s)
    s = re.sub(r"[^\u0d80-\u0dff ]+", "", s)
    return re.sub(r"\s+", " ", s).strip().lower()
