import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, NIKAYAS, nikayaOf, type SuttaMeta } from '../api'

const PAGE = 100

export default function Book() {
  const { book = '' } = useParams()
  const [q, setQ] = useState('')
  const [items, setItems] = useState<SuttaMeta[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setLoading(true)
    setItems([])
    setError(null)
    api
      .suttas({ book, q: q || undefined, limit: PAGE, offset: 0 })
      .then((r) => {
        if (!alive) return
        setItems(r.items)
        setTotal(r.total)
      })
      .catch((e) => alive && setError(String(e)))
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [book, q])

  const nikaya = nikayaOf(book)
  const title = book
    ? `${book.toUpperCase()} — ${NIKAYAS[nikaya]?.name ?? 'Unlinked'}`
    : 'Suttas'

  async function loadMore() {
    const r = await api.suttas({ book, q: q || undefined, limit: PAGE, offset: items.length })
    setItems((prev) => [...prev, ...r.items])
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-5">
        <Link to="/" className="text-sm" style={{ color: 'var(--muted)' }}>
          ← Home
        </Link>
        <h1 className="mt-1 text-2xl font-bold">{title}</h1>
        <p className="text-sm" style={{ color: 'var(--muted)' }}>
          {total.toLocaleString()} suttas
        </p>
      </div>

      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Filter by title or reference (e.g. dn1_1)…"
        className="mb-5 w-full rounded-lg border px-3 py-2 text-sm outline-none focus:ring-2"
        style={{ background: 'var(--panel)', borderColor: 'var(--line)' }}
      />

      {error && <p className="text-sm" style={{ color: '#b91c1c' }}>{error}</p>}
      {loading && <p style={{ color: 'var(--muted)' }}>Loading…</p>}

      <ul className="divide-y" style={{ borderColor: 'var(--line)' }}>
        {items.map((s) => (
          <li key={s.source_id}>
            <Link
              to={`/sutta/${s.source_id}`}
              className="flex items-baseline justify-between gap-3 py-2.5 transition hover:opacity-75"
            >
              <span className="font-tipitaka">{s.label || `Sutta ${s.source_id}`}</span>
              <span className="shrink-0 font-mono text-xs" style={{ color: 'var(--muted)' }}>
                {s.link ?? `#${s.source_id}`}
              </span>
            </Link>
          </li>
        ))}
      </ul>

      {items.length < total && (
        <button
          onClick={loadMore}
          className="mt-5 w-full rounded-lg border py-2 text-sm font-medium transition hover:opacity-80"
          style={{ borderColor: 'var(--line)' }}
        >
          Load more ({total - items.length} remaining)
        </button>
      )}
    </div>
  )
}
