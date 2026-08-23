import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api, type Neighbors, type SuttaDetail, type TranslationResult, type SuttaTranslations } from '../api'
import Reader from '../components/Reader'

export default function Sutta() {
  const { sourceId = '' } = useParams()
  const id = Number(sourceId)
  const [data, setData] = useState<SuttaDetail | null>(null)
  const [neighbors, setNeighbors] = useState<Neighbors | null>(null)
  const [translations, setTranslations] = useState<SuttaTranslations | null>(null)
  const [translation, setTranslation] = useState<TranslationResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!Number.isFinite(id)) {
      setError('Invalid sutta id')
      return
    }
    let alive = true
    setData(null)
    setTranslation(null)
    setTranslations(null)
    setError(null)
    api
      .sutta(id)
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(String(e)))
    api
      .neighbors(id)
      .then((n) => alive && setNeighbors(n))
      .catch(() => {})
    api
      .suttaTranslations(id)
      .then((t) => alive && setTranslations(t))
      .catch(() => {})
    return () => {
      alive = false
    }
  }, [id])

  async function selectTranslation(source: string) {
    if (source === 'mahamevnawa') {
      setTranslation(null)
      return
    }
    setTranslation(null)
    try {
      setTranslation(await api.suttaTranslation(id, source))
    } catch (e) {
      setError(String(e))
    }
  }

  if (error) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <p style={{ color: '#b91c1c' }}>{error}</p>
        <Link to="/" className="mt-3 inline-block text-sm" style={{ color: 'var(--muted)' }}>
          ← Home
        </Link>
      </div>
    )
  }
  if (!data) {
    return <div className="mx-auto max-w-3xl px-4 py-16" style={{ color: 'var(--muted)' }}>Loading…</div>
  }

  const hasAlt = translations && translations.available.length > 0

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6">
        <div className="flex items-center justify-between gap-3">
          <Link to="/" className="text-sm" style={{ color: 'var(--muted)' }}>
            ← Home
          </Link>
          <span className="font-mono text-xs" style={{ color: 'var(--muted)' }}>
            {data.link ?? `#${data.source_id}`}
          </span>
        </div>
        <h1 className="font-tipitaka mt-2 text-2xl font-bold md:text-3xl">
          {data.label}
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          {data.book && (
            <Link
              to={`/book/${data.book}`}
              className="rounded-full px-2.5 py-1 font-semibold"
              style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
            >
              {data.book}
            </Link>
          )}
          <a
            href={data.url}
            target="_blank"
            rel="noreferrer"
            className="rounded-full border px-2.5 py-1"
            style={{ borderColor: 'var(--line)' }}
          >
            Original ↗
          </a>
        </div>

        {hasAlt && (
          <div className="mt-4 flex flex-wrap items-center gap-1.5 text-sm">
            <span className="mr-1" style={{ color: 'var(--muted)' }}>
              Translation:
            </span>
            <button
              onClick={() => selectTranslation('mahamevnawa')}
              className="rounded-full border px-3 py-1 text-xs font-medium transition"
              style={
                !translation
                  ? { background: 'var(--brand)', color: 'var(--brand-ink)', borderColor: 'var(--brand)' }
                  : { borderColor: 'var(--line)' }
              }
            >
              Mahamevnawa
            </button>
            {translations!.available.map((t) => (
              <button
                key={t.source}
                onClick={() => selectTranslation(t.source)}
                title={t.label}
                className="rounded-full border px-3 py-1 text-xs font-medium transition"
                style={
                  translation?.source === t.source
                    ? { background: 'var(--brand)', color: 'var(--brand-ink)', borderColor: 'var(--brand)' }
                    : { borderColor: 'var(--line)' }
                }
              >
                {t.label.split(' ')[0]}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mb-6 flex items-center justify-between gap-2 text-sm">
        {neighbors?.prev ? (
          <Link to={`/sutta/${neighbors.prev.source_id}`} className="rounded-lg border px-3 py-1.5 transition hover:opacity-75" style={{ borderColor: 'var(--line)' }}>
            ← {neighbors.prev.label || 'Prev'}
          </Link>
        ) : (
          <span />
        )}
        {neighbors?.next ? (
          <Link to={`/sutta/${neighbors.next.source_id}`} className="rounded-lg border px-3 py-1.5 transition hover:opacity-75" style={{ borderColor: 'var(--line)' }}>
            {neighbors.next.label || 'Next'} →
          </Link>
        ) : (
          <span />
        )}
      </div>

      <Reader blocks={data.blocks} translation={translation} />
    </div>
  )
}
