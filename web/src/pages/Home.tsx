import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, NIKAYAS, nikayaOf, type Book, type Stats } from '../api'

function useStats() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    api.stats().then(setStats).catch((e) => setError(String(e)))
  }, [])
  return { stats, error }
}

export default function Home() {
  const { stats, error } = useStats()
  const [books, setBooks] = useState<Book[]>([])
  useEffect(() => {
    api.books().then(setBooks).catch(() => {})
  }, [])

  const grouped = new Map<string, Book[]>()
  for (const b of books) {
    const nk = nikayaOf(b.book)
    if (!grouped.has(nk)) grouped.set(nk, [])
    grouped.get(nk)!.push(b)
  }
  const misc = grouped.get('misc') ?? []
  grouped.delete('misc')

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-8 rounded-2xl p-6 md:p-10" style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}>
        <h1 className="text-2xl font-bold md:text-3xl">Local Tripitaka Mirror</h1>
        <p className="mt-2 max-w-2xl" style={{ color: 'var(--muted)' }}>
          Every sutta of tripitaka.online (Mahamevnawa) — Pali text and Sinhala
          translation — mirrored from the site&apos;s own API into PostgreSQL.
        </p>
        {error && <p className="mt-3 text-sm" style={{ color: '#b91c1c' }}>API error: {error}</p>}
        {stats && (
          <div className="mt-5 flex flex-wrap gap-3 text-sm">
            {[
              [stats.suttas.toLocaleString(), 'suttas'],
              [stats.blocks.toLocaleString(), 'text blocks'],
              [stats.pali_blocks.toLocaleString(), 'Pali'],
              [stats.sinhala_blocks.toLocaleString(), 'Sinhala'],
              [String(stats.books), 'book groups'],
            ].map(([n, label]) => (
              <span key={label} className="rounded-full px-3 py-1" style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}>
                <b>{n}</b> {label}
              </span>
            ))}
          </div>
        )}
      </div>

      <h2 className="mb-4 text-lg font-semibold">Browse by Nikāya</h2>
      <div className="grid gap-4 md:grid-cols-2">
        {[...grouped.entries()].map(([nk, list]) => (
          <div key={nk} className="rounded-xl p-4" style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}>
            <div className="mb-2 flex items-baseline justify-between">
              <h3 className="font-semibold">
                {NIKAYAS[nk]?.name ?? nk}
                <span className="ml-2 text-xs" style={{ color: 'var(--muted)' }}>
                  {NIKAYAS[nk]?.short ?? ''}
                </span>
              </h3>
              <span className="text-xs" style={{ color: 'var(--muted)' }}>
                {list.reduce((s, b) => s + b.count, 0).toLocaleString()} suttas
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {list.map((b) => (
                <Link
                  key={b.book}
                  to={`/book/${b.book}`}
                  className="rounded-lg border px-2.5 py-1 text-sm transition hover:opacity-80"
                  style={{ borderColor: 'var(--line)' }}
                >
                  <b>{b.book}</b> <span className="text-xs" style={{ color: 'var(--muted)' }}>{b.count}</span>
                </Link>
              ))}
            </div>
          </div>
        ))}
        {misc.length > 0 && (
          <div className="rounded-xl p-4" style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}>
            <h3 className="mb-2 font-semibold">Unlinked (misc)</h3>
            <div className="flex flex-wrap gap-2">
              {misc.map((b) => (
                <Link key={b.book} to={`/book/${b.book}`} className="rounded-lg border px-2.5 py-1 text-sm" style={{ borderColor: 'var(--line)' }}>
                  <b>{b.book}</b> <span className="text-xs" style={{ color: 'var(--muted)' }}>{b.count}</span>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
