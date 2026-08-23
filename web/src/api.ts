// Minimal typed client for the FastAPI backend.
// In dev, Vite proxies /api -> http://127.0.0.1:8080 (see vite.config.ts).
// In prod, FastAPI serves this app and the API on the same origin.
// With VITE_STATIC=1 the same `api` object reads ./data/… files instead.
import { hasSinhala, romanKey, si2roman, stripZw } from './translit'

export interface Book {
  book: string
  count: number
}

export interface SuttaMeta {
  source_id: number
  link: string | null
  label: string
  book: string | null
}

export interface Block {
  seq: number
  tag: string
  class_: string
  lang: 'pali' | 'sinhala' | null
  content: string
}

export interface SuttaDetail extends SuttaMeta {
  url: string
  blocks: Block[]
  prev: SuttaMeta | null
  next: SuttaMeta | null
}

export interface SuttaList {
  total: number
  offset: number
  limit: number
  items: SuttaMeta[]
}

export interface SearchHit {
  source_id: number
  link: string | null
  label: string
  book: string | null
  seq: number
  lang: 'pali' | 'sinhala' | null
  content: string
}

export interface SearchResult {
  query: string
  total: number
  hits: SearchHit[]
}

export interface Stats {
  suttas: number
  blocks: number
  books: number
  pali_blocks: number
  sinhala_blocks: number
}

export interface Neighbors {
  prev: SuttaMeta | null
  next: SuttaMeta | null
}

export interface DictEntry {
  word_si: string | null
  word_roman: string | null
  pos: string | null
  definition: string
  detail: string | null
  root: string | null
  sanskrit: string | null
  examples: string | null
  match: 'exact' | 'prefix'
}

export interface DictGroup {
  source: string
  label: string
  entries: DictEntry[]
}

export interface DictResult {
  word: string
  roman: string | null
  groups: DictGroup[]
}

export interface SuttaRef {
  source_id: number
  link: string | null
  label: string
  hits: number
}

export interface DictRefs {
  word: string
  total: number
  suttas: SuttaRef[]
}

export interface TranslationSegment {
  seq: number
  tag: string
  content: string
}

export interface TranslationResult {
  source: string
  label: string
  pali: TranslationSegment[]
  sinhala: TranslationSegment[]
}

export interface SuttaTranslations {
  default: string
  available: { source: string; label: string }[]
}

function qs(params: Record<string, string | number | undefined>): string {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') sp.set(k, String(v))
  }
  const s = sp.toString()
  return s ? `?${s}` : ''
}

async function j<T>(path: string): Promise<T> {
  const r = await fetch(path)
  if (!r.ok) {
    let detail = r.statusText
    try {
      const body = await r.json()
      if (body?.detail) detail = String(body.detail)
    } catch {
      /* ignore */
    }
    throw new Error(detail)
  }
  return r.json() as Promise<T>
}

export interface ApiClient {
  stats: () => Promise<Stats>
  books: () => Promise<Book[]>
  suttas: (p: { book?: string; q?: string; limit?: number; offset?: number }) => Promise<SuttaList>
  sutta: (sourceId: number) => Promise<SuttaDetail>
  neighbors: (sourceId: number) => Promise<Neighbors>
  search: (p: { q: string; lang?: string; book?: string; limit?: number; offset?: number }) => Promise<SearchResult>
  dict: (word: string) => Promise<DictResult>
  dictRefs: (word: string) => Promise<DictRefs>
  suttaTranslations: (sourceId: number) => Promise<SuttaTranslations>
  suttaTranslation: (sourceId: number, source: string) => Promise<TranslationResult>
}

const liveApi: ApiClient = {
  stats: () => j<Stats>('/api/stats'),
  books: () => j<Book[]>('/api/books'),
  suttas: (p: { book?: string; q?: string; limit?: number; offset?: number }) =>
    j<SuttaList>(`/api/suttas${qs(p)}`),
  sutta: (sourceId: number) => j<SuttaDetail>(`/api/suttas/${sourceId}`),
  neighbors: (sourceId: number) =>
    j<Neighbors>(`/api/suttas/${sourceId}/neighbors`),
  search: (p: { q: string; lang?: string; book?: string; limit?: number; offset?: number }) =>
    j<SearchResult>(`/api/search${qs(p)}`),
  dict: (word: string) => j<DictResult>(`/api/dict?word=${encodeURIComponent(word)}`),
  dictRefs: (word: string) => j<DictRefs>(`/api/dict/refs?word=${encodeURIComponent(word)}`),
  suttaTranslations: (sourceId: number) =>
    j<SuttaTranslations>(`/api/suttas/${sourceId}/translations`),
  suttaTranslation: (sourceId: number, source: string) =>
    j<TranslationResult>(`/api/suttas/${sourceId}/translation?source=${encodeURIComponent(source)}`),
}

// ---------------------------------------------------------------------------
// Static mode (VITE_STATIC=1): the whole app reads ./data/… files instead of
// the FastAPI backend — used for the GitHub Pages build.
// ---------------------------------------------------------------------------
const STATIC = import.meta.env.VITE_STATIC === '1'

interface StaticSutta {
  source_id: number
  link: string | null
  label: string
  book: string | null
  url: string
  prev: SuttaMeta | null
  next: SuttaMeta | null
  blocks: Block[]
  bjt: { pali: TranslationSegment[]; sinhala: TranslationSegment[] } | null
}

interface StaticDictEntry {
  s: string
  p?: string
  d: string
  w?: string
  r?: string
  k?: string
}

const SOURCE_LABELS: Record<string, string> = {
  dpd: 'Digital Pāḷi Dictionary (Pali→English)',
  ncped: 'NCPED — New Concise Pali-English (Buddhadatta)',
  ped: 'PTS Pāli-English Dictionary (PED)',
  buddhadatta: 'Pali-Sinhala Dictionary (Buddhadatta)',
  sumangala: 'Pali-Sinhala Dictionary (Sumangala)',
  sin_eng_sin: 'Sinhala↔English Dictionary',
}

let _list: SuttaMeta[] | null = null
let _dictIdx: Record<string, StaticDictEntry[]> | null = null
let _searchIdx: Record<string, number[]> | null = null

async function sj<T>(path: string): Promise<T> {
  const r = await fetch(`./data/${path}`)
  if (!r.ok) throw new Error(`missing static data: ${path}`)
  return r.json() as Promise<T>
}

async function suttaList(): Promise<SuttaMeta[]> {
  if (!_list) _list = await sj<SuttaMeta[]>('suttas/list.json')
  return _list
}

async function suttaJson(id: number): Promise<StaticSutta> {
  return sj<StaticSutta>(`suttas/${id}.json`)
}

async function dictIdx(): Promise<Record<string, StaticDictEntry[]>> {
  if (!_dictIdx) _dictIdx = await sj<Record<string, StaticDictEntry[]>>('dicts.json')
  return _dictIdx
}

function cleanSiWord(w: string): string {
  return stripZw(w)
    .replace(/[^\u0d80-\u0dff ]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

export const staticApi: ApiClient = {
  stats: () => sj<Stats>('stats.json'),
  books: () => sj<Book[]>('books.json'),
  suttas: async (p) => {
    const list = await suttaList()
    let items = list
    if (p.book) items = items.filter((s) => s.book === p.book)
    if (p.q) {
      const q = p.q.toLowerCase()
      items = items.filter(
        (s) => s.label.toLowerCase().includes(q) || (s.link ?? '').includes(q),
      )
    }
    const offset = p.offset ?? 0
    const limit = p.limit ?? 100
    return { total: items.length, offset, limit, items: items.slice(offset, offset + limit) }
  },
  sutta: (id) => suttaJson(id).then((s) => ({ ...s }) as SuttaDetail),
  neighbors: (id) =>
    suttaJson(id).then((s) => ({ prev: s.prev, next: s.next })),
  search: async (p) => {
    if (!_searchIdx) _searchIdx = await sj<Record<string, number[]>>('search.json')
    const searchIdx = _searchIdx
    const list = await suttaList()
    const byId = new Map(list.map((s) => [s.source_id, s]))
    const terms = p.q
      .split(/\s+/)
      .filter(Boolean)
      .map((t) =>
        hasSinhala(t) ? romanKey(si2roman(cleanSiWord(t))) : romanKey(t.toLowerCase()),
      )
    let sids: number[] | null = null
    for (const t of terms) {
      const ids = searchIdx[t] ?? []
      sids = sids === null ? ids : ids.filter((x) => sids!.includes(x))
    }
    const hits: SearchHit[] = (sids ?? [])
      .filter((sid) => !p.book || byId.get(sid)?.book === p.book)
      .map((sid) => {
        const s = byId.get(sid)!
        return { source_id: sid, link: s.link, label: s.label, book: s.book, seq: 0, lang: 'pali', content: s.label }
      })
    const offset = p.offset ?? 0
    const limit = p.limit ?? 50
    return { query: p.q, total: hits.length, hits: hits.slice(offset, offset + limit) }
  },
  dict: async (word) => {
    const idx = await dictIdx()
    const si = hasSinhala(word) ? cleanSiWord(word) : ''
    const roman = si ? si2roman(si) : word.toLowerCase()
    const rk = romanKey(roman)
    // exact + anusvara-trimmed key (සුතං -> suta)
    const keys = [si || rk, rk]
    if (rk.length > 3 && rk.endsWith('m')) keys.push(rk.slice(0, -1))
    const groups: Record<string, DictEntry[]> = {}
    for (const k of keys) {
      for (const e of idx[k] ?? []) {
        const entry: DictEntry = {
          word_si: si || null,
          word_roman: e.w ?? (hasSinhala(word) ? roman : word.toLowerCase()) ?? null,
          pos: e.p ?? null,
          definition: e.d,
          detail: null,
          root: e.r ?? null,
          sanskrit: e.k ?? null,
          examples: null,
          match: 'exact',
        }
        groups[e.s] = groups[e.s] ?? []
        if (!groups[e.s].some((x) => x.definition === e.d)) groups[e.s].push(entry)
      }
    }
    return {
      word: si || word,
      roman: hasSinhala(word) ? roman : null,
      groups: Object.entries(groups).map(([source, entries]) => ({
        source,
        label: SOURCE_LABELS[source] ?? source,
        entries,
      })),
    }
  },
  dictRefs: async (word) => {
    if (!_searchIdx) _searchIdx = await sj<Record<string, number[]>>('search.json')
    const searchIdx = _searchIdx
    const list = await suttaList()
    const byId = new Map(list.map((s) => [s.source_id, s]))
    const key = hasSinhala(word) ? romanKey(si2roman(cleanSiWord(word))) : romanKey(word.toLowerCase())
    const sids = searchIdx[key] ?? []
    return {
      word,
      total: sids.length,
      suttas: sids.slice(0, 100).map((sid) => {
        const s = byId.get(sid)!
        return { source_id: sid, link: s.link, label: s.label, hits: 1 }
      }),
    }
  },
  suttaTranslations: async (id) => {
    const s = await suttaJson(id)
    return {
      default: 'mahamevnawa',
      available: s.bjt ? [{ source: 'bjt', label: 'Buddha Jayanthi Tripitaka (1957)' }] : [],
    }
  },
  suttaTranslation: async (id, source) => {
    const s = await suttaJson(id)
    if (!s.bjt) throw new Error(`no '${source}' translation for sutta ${id}`)
    return { source, label: 'Buddha Jayanthi Tripitaka (1957)', pali: s.bjt.pali, sinhala: s.bjt.sinhala }
  },
}

// In static builds the exported `api` is the file-based one; in dev/live it is
// the FastAPI client above.
export const api: ApiClient = STATIC ? staticApi : liveApi

// Human-readable nikāya names for book prefixes.
export const NIKAYAS: Record<string, { name: string; short: string }> = {
  dn: { name: 'Dīgha Nikāya', short: 'DN' },
  mn: { name: 'Majjhima Nikāya', short: 'MN' },
  sn: { name: 'Saṃyutta Nikāya', short: 'SN' },
  an: { name: 'Aṅguttara Nikāya', short: 'AN' },
  kn: { name: 'Khuddaka Nikāya', short: 'KN' },
}

export function nikayaOf(book: string | null): string {
  if (!book) return 'misc'
  const m = book.match(/^([a-z]+)/)
  return m ? m[1] : 'misc'
}
