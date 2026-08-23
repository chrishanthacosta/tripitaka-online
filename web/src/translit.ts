// Sinhala → Roman (IAST) transliteration — port of scripts/dict_common.py
// (codepoint layout verified against the real corpus + unicodedata).

const INDEPENDENT_VOWELS: Record<string, string> = {
  '\u0d85': 'a', '\u0d86': 'ā', '\u0d87': 'æ', '\u0d88': 'ǣ',
  '\u0d89': 'i', '\u0d8a': 'ī', '\u0d8b': 'u', '\u0d8c': 'ū',
  '\u0d8d': 'ṛ', '\u0d8e': 'ṝ', '\u0d8f': 'ḷ', '\u0d90': 'ḹ',
  '\u0d91': 'e', '\u0d92': 'ē', '\u0d93': 'ai', '\u0d94': 'o',
  '\u0d95': 'ō', '\u0d96': 'au',
}

const VOWEL_SIGNS: Record<string, string> = {
  '\u0dca': '', '\u0dcf': 'ā', '\u0dd0': 'æ', '\u0dd1': 'ǣ',
  '\u0dd2': 'i', '\u0dd3': 'ī', '\u0dd4': 'u', '\u0dd5': 'ū',
  '\u0dd6': 'ṛ', '\u0dd8': 'ṝ', '\u0dd9': 'e', '\u0dda': 'ē',
  '\u0ddb': 'ai', '\u0ddc': 'o', '\u0ddd': 'ō', '\u0dde': 'au',
  '\u0ddf': 'ḹ',
}

const CONSONANTS: Record<string, string> = {
  '\u0d9a': 'k', '\u0d9b': 'kh', '\u0d9c': 'g', '\u0d9d': 'gh',
  '\u0d9e': 'ṅ', '\u0d9f': 'ṅg', '\u0da0': 'c', '\u0da1': 'ch',
  '\u0da2': 'j', '\u0da3': 'jh', '\u0da4': 'ñ', '\u0da5': 'ñj',
  '\u0da6': 'ñj', '\u0da7': 'ṭ', '\u0da8': 'ṭh', '\u0da9': 'ḍ',
  '\u0daa': 'ḍh', '\u0dab': 'ṇ', '\u0dac': 'ṇḍ', '\u0dad': 't',
  '\u0dae': 'th', '\u0daf': 'd', '\u0db0': 'dh', '\u0db1': 'n',
  '\u0db3': 'nd', '\u0db4': 'p', '\u0db5': 'ph', '\u0db6': 'b',
  '\u0db7': 'bh', '\u0db8': 'm', '\u0db9': 'mb', '\u0dba': 'y',
  '\u0dbb': 'r', '\u0dbd': 'l', '\u0dc0': 'v', '\u0dc1': 'ś',
  '\u0dc2': 'ṣ', '\u0dc3': 's', '\u0dc4': 'h', '\u0dc5': 'ḷ',
  '\u0dc6': 'f',
}

const SPECIAL: Record<string, string> = {
  '\u0d82': 'ṃ', '\u0d83': 'ḥ',
}

const ZW = '\u200c\u200d'

export function stripZw(s: string): string {
  let out = ''
  for (const c of s) if (!ZW.includes(c)) out += c
  return out
}

export function si2roman(s: string): string {
  s = stripZw(s)
  const out: string[] = []
  let i = 0
  while (i < s.length) {
    const ch = s[i]
    if (CONSONANTS[ch]) {
      out.push(CONSONANTS[ch])
      i++
      while (i < s.length && ZW.includes(s[i])) i++
      if (s[i] === '\u0dca') {
        i++
        while (i < s.length && ZW.includes(s[i])) i++
      } else if (VOWEL_SIGNS[s[i]]) {
        out.push(VOWEL_SIGNS[s[i]])
        i++
        while (i < s.length && ZW.includes(s[i])) i++
      } else {
        out.push('a')
      }
    } else if (INDEPENDENT_VOWELS[ch]) {
      out.push(INDEPENDENT_VOWELS[ch])
      i++
    } else if (SPECIAL[ch]) {
      out.push(SPECIAL[ch])
      i++
    } else if (VOWEL_SIGNS[ch]) {
      const v = VOWEL_SIGNS[ch]
      if (v) out.push(v)
      i++
    } else if (ZW.includes(ch)) {
      i++
    } else {
      out.push(ch.toLowerCase())
      i++
    }
  }
  return out.join('')
}

// diacritic-insensitive, lowercased key for Roman Pali
export function romanKey(s: string): string {
  return s
    .normalize('NFD')
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, '')
}

export function hasSinhala(s: string): boolean {
  for (const c of s) {
    const code = c.codePointAt(0)!
    if (code >= 0xd80 && code <= 0xdff) return true
  }
  return false
}
