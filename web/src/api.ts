// Minimal typed client for the FastAPI backend.
// In dev, Vite proxies /api -> http://127.0.0.1:8080 (see vite.config.ts).
// In prod, FastAPI serves this app and the API on the same origin.

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
  segments: TranslationSegment[]
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

export const api = {
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
