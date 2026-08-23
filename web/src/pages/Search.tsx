import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api, type SearchHit } from '../api'
import Highlight from '../components/Highlight'

const PAGE = 50

export default function Search() {
  const [params] = useSearchParams()
  const q = params.get('q') ?? ''
  const lang = params.get('lang') ?? ''
  const book = params.get('book') ?? ''

  const [hits, setHits] = useState<SearchHit[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!q.trim()) {
      setHits([])
      setTotal(0)
      setLoading(false)
      return
    }
    let alive = true
    setLoading(true)
    setHits([])
    setError(null)
    api
      .search({ q, lang: lang || undefined, book: book || undefined, limit: PAGE, offset: 0 })
      .then((r) => {
        if (!alive) return
        setHits(r.hits)
        setTotal(r.total)
      })
      .catch((e) => alive && setError(String(e)))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [q, lang, book])

  // Group block hits by sutta, keeping up to 3 snippets per sutta.
  const grouped = useMemo(() => {
    const map = new Map<number, { meta: SearchHit; snippets: SearchHit[] }>()
    for (const h of hits) {
      const g = map.get(h.source_id)
      if (g) {
        if (g.snippets.length < 3) g.snippets.push(h)
      } else {
        map.set(h.source_id, { meta: h, snippets: [h] })
      }
    }
    return [...map.values()]
  }, [hits])

  async function loadMore() {
    const r = await api.search({ q, lang: lang || undefined, book: book || undefined, limit: PAGE, offset: hits.length })
    setHits((prev) => [...prev, ...r.hits])
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <h1 className="text-2xl font-bold">Search</h1>
      <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
        {q.trim() ? (
          <>
            “<b>{q}</b>” — {total.toLocaleString()} matching block{total === 1 ? '' : 's'}
            {lang && <> · language: {lang}</>}
            {book && <> · book: {book}</>}
          </>
        ) : (
          'Type a query in the search box above.'
        )}
      </p>

      {error && <p className="mt-4 text-sm" style={{ color: '#b91c1c' }}>{error}</p>}
      {loading && <p className="mt-4" style={{ color: 'var(--muted)' }}>Searching…</p>}

      {!loading && q.trim() && grouped.length === 0 && !error && (
        <p className="mt-8" style={{ color: 'var(--muted)' }}>No matches.</p>
      )}

      <div className="mt-6 space-y-5">
        {grouped.map(({ meta, snippets }) => (
          <div key={meta.source_id} className="rounded-xl p-4" style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}>
            <div className="mb-2 flex flex-wrap items-baseline gap-2">
              <Link to={`/sutta/${meta.source_id}`} className="font-tipitaka font-semibold hover:opacity-75">
                {meta.label || `Sutta ${meta.source_id}`}
              </Link>
              <span className="font-mono text-xs" style={{ color: 'var(--muted)' }}>
                {meta.link ?? `#${meta.source_id}`}
              </span>
              {meta.book && (
                <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}>
                  {meta.book}
                </span>
              )}
            </div>
            {snippets.map((s) => (
              <p key={s.seq} className="font-tipitaka mb-1.5 text-sm last:mb-0" style={{ color: 'var(--ink)' }}>
                <span
                  className="mr-2 rounded px-1 text-[10px] font-semibold uppercase"
                  style={
                    s.lang === 'pali'
                      ? { background: '#fef3c7', color: '#92400e' }
                      : { background: '#dcfce7', color: '#166534' }
                  }
                >
                  {s.lang ?? '—'}
                </span>
                <Highlight text={s.content} query={q} />
              </p>
            ))}
          </div>
        ))}
      </div>

      {hits.length < total && (
        <button
          onClick={loadMore}
          className="mt-6 w-full rounded-lg border py-2 text-sm font-medium transition hover:opacity-80"
          style={{ borderColor: 'var(--line)' }}
        >
          Load more ({total - hits.length} remaining)
        </button>
      )}
    </div>
  )
}
