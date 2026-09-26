// Dictionary modal: shows all dictionary entries for a clicked Pali word
// (grouped by source) plus where the word occurs in the corpus.
// Centered on screen so it is always fully visible. The AI button swaps the
// content for a Pali-grammar chat about the word.
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type DictRefs, type DictResult } from '../api'
import type { WordInfo } from '../aiStore'
import type { WordPick } from './PaliWords'

const AiChat = lazy(() => import('./AiChat'))

// Keep the passage sent to the AI short: a window around the clicked word.
function passageAround(text: string | undefined, word: string, max = 1200): string | null {
  if (!text) return null
  const t = text.replace(/[\u200c\u200d]/g, '')
  if (t.length <= max) return t
  const at = Math.max(0, t.indexOf(word))
  const start = Math.max(0, Math.min(at - max / 2, t.length - max))
  return (start > 0 ? '…' : '') + t.slice(start, start + max) + (start + max < t.length ? '…' : '')
}

// Compact summary of the dictionary entries, given to the AI as grounding.
function dictHints(d: DictResult | null): string | null {
  if (!d) return null
  const lines: string[] = []
  for (const g of d.groups)
    for (const e of g.entries.filter((e) => e.match === 'exact').slice(0, 3))
      lines.push(
        `[${g.source}] ${e.word_roman ?? e.word_si ?? ''} ${e.pos ? `(${e.pos}) ` : ''}${e.definition.slice(0, 300)}${e.root ? ` · root ${e.root}` : ''}`,
      )
  return lines.length ? lines.join('\n').slice(0, 2800) : null
}

const SOURCE_COLORS: Record<string, { bg: string; fg: string }> = {
  dpd: { bg: '#fef3c7', fg: '#92400e' },
  ncped: { bg: '#e0e7ff', fg: '#3730a3' },
  ped: { bg: '#fce7f3', fg: '#9d174d' },
  buddhadatta: { bg: '#dcfce7', fg: '#166534' },
  sumangala: { bg: '#cffafe', fg: '#155e75' },
  sin_eng_sin: { bg: '#f3e8ff', fg: '#6b21a8' },
}

export default function DictPopup({
  pick,
  onClose,
}: {
  pick: WordPick
  onClose: () => void
}) {
  const [data, setData] = useState<DictResult | null>(null)
  const [refs, setRefs] = useState<DictRefs | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aiOpen, setAiOpen] = useState(false)

  useEffect(() => {
    let alive = true
    setData(null)
    setRefs(null)
    setError(null)
    setAiOpen(false)
    api.dict(pick.word).then((d) => alive && setData(d)).catch((e) => alive && setError(String(e)))
    api.dictRefs(pick.word).then((r) => alive && setRefs(r)).catch(() => {})
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => {
      alive = false
      window.removeEventListener('keydown', onKey)
    }
  }, [pick.word, onClose])

  const totalEntries = data?.groups.reduce((s, g) => s + g.entries.length, 0) ?? 0
  const aiInfo = useMemo<WordInfo>(
    () => ({
      word: pick.word,
      roman: data?.roman ?? null,
      context: passageAround(pick.context, pick.word),
      dictHints: dictHints(data),
    }),
    [pick.word, pick.context, data],
  )

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 md:p-6"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onMouseDown={(e) => {
        // close only when clicking the backdrop itself
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Dictionary: ${pick.word}`}
        className={`w-full rounded-xl p-4 shadow-2xl md:p-5 ${aiOpen ? 'max-w-5xl' : 'max-w-2xl max-h-[85vh] overflow-y-auto'}`}
        style={{
          background: 'var(--panel)',
          border: '1px solid var(--line)',
          color: 'var(--ink)',
        }}
      >
        {aiOpen ? (
          <Suspense fallback={<p className="text-sm" style={{ color: 'var(--muted)' }}>Loading AI chat…</p>}>
            <AiChat info={aiInfo} autoStart onBack={() => setAiOpen(false)} onClose={onClose} />
          </Suspense>
        ) : (
        <>
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <h3 className="font-tipitaka mr-auto text-xl font-bold">{pick.word}</h3>
          <button
            onClick={() => setAiOpen(true)}
            disabled={!data && !error}
            className="rounded px-2 py-0.5 text-sm font-semibold hover:opacity-80 disabled:opacity-40"
            style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
            title="Investigate this word's Pali grammar with AI"
          >
            ✦ AI
          </button>
          <button
            onClick={onClose}
            className="rounded border px-2 py-0.5 text-sm hover:opacity-60"
            style={{ borderColor: 'var(--line)' }}
            aria-label="Close"
          >
            ✕ Close
          </button>
        </div>
        {data?.roman && data.roman !== pick.word && (
          <p className="mb-3 text-sm" style={{ color: 'var(--muted)' }}>
            <span className="font-mono">{data.roman}</span>
            {data.groups.length > 0 && ` · ${data.groups.length} dictionaries`}
          </p>
        )}

        {error && <p className="text-sm" style={{ color: '#b91c1c' }}>{error}</p>}
        {!data && !error && <p className="text-sm" style={{ color: 'var(--muted)' }}>Looking up…</p>}
        {data && totalEntries === 0 && (
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            No dictionary entry found.
          </p>
        )}

        {data?.groups.map((g) => (
          <div key={g.source} className="mb-4">
            <div className="mb-1.5 flex items-center gap-1.5">
              <span
                className="rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide"
                style={(() => {
                  const c = SOURCE_COLORS[g.source] ?? { bg: '#eee', fg: '#333' }
                  return { background: c.bg, color: c.fg }
                })()}
              >
                {g.source}
              </span>
              <span className="text-[11px]" style={{ color: 'var(--muted)' }}>
                {g.label}
              </span>
            </div>
            <ul className="space-y-2">
              {g.entries.map((e, i) => (
                <li key={i} className="text-sm">
                  <div>
                    {e.pos && (
                      <em className="mr-1.5 text-xs" style={{ color: 'var(--muted)' }}>
                        {e.pos}
                      </em>
                    )}
                    {e.word_roman && e.word_roman !== pick.word && (
                      <span className="mr-1.5 font-mono text-xs" style={{ color: 'var(--muted)' }}>
                        {e.word_roman}
                      </span>
                    )}
                    <span className="font-tipitaka">{e.definition}</span>
                    {e.match === 'prefix' && (
                      <span className="ml-1 text-[10px] uppercase" style={{ color: 'var(--muted)' }}>
                        · related
                      </span>
                    )}
                  </div>
                  {(e.root || e.sanskrit) && (
                    <div className="mt-0.5 text-xs" style={{ color: 'var(--muted)' }}>
                      {e.root && (
                        <span className="mr-2">
                          <b>√</b> {e.root.replace(/^√/, '')}
                        </span>
                      )}
                      {e.sanskrit && <span>Skt: {e.sanskrit}</span>}
                    </div>
                  )}
                  {e.examples && (
                    <details className="mt-0.5">
                      <summary className="cursor-pointer text-[11px] uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
                        examples
                      </summary>
                      {e.examples.split('\n\n').map((ex, k) => (
                        <p key={k} className="font-tipitaka mt-1 whitespace-pre-line text-xs">
                          {ex}
                        </p>
                      ))}
                    </details>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}

        <div className="mt-3 border-t pt-2" style={{ borderColor: 'var(--line)' }}>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            In the corpus: <b>{refs ? refs.total.toLocaleString() : '…'}</b> occurrence
            {refs && refs.total !== 1 ? 's' : ''}
            {refs && refs.suttas.length > 0 && ' — top suttas:'}
          </p>
          {refs && refs.suttas.length > 0 && (
            <ul className="mt-1 space-y-0.5">
              {refs.suttas.slice(0, 6).map((s) => (
                <li key={s.source_id} className="text-xs">
                  <Link to={`/sutta/${s.source_id}`} onClick={onClose} className="hover:opacity-70">
                    <span className="font-tipitaka">{s.label || `Sutta ${s.source_id}`}</span>
                    <span className="ml-1.5 font-mono" style={{ color: 'var(--muted)' }}>
                      {s.link ?? `#${s.source_id}`} · {s.hits}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
        </>
        )}
      </div>
    </div>
  )
}
