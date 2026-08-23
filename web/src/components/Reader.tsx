import { useMemo, useState } from 'react'
import type { Block, TranslationResult } from '../api'
import DictPopup from './DictPopup'
import PaliWords, { type WordPick } from './PaliWords'

type Row =
  | { kind: 'heading'; tag: string; content: string }
  | { kind: 'pair'; pali: string; sinhala: string }
  | { kind: 'single'; lang: 'pali' | 'sinhala'; content: string }

// Group ordered blocks into rows: headings span the width; a Pali paragraph
// pairs with the Sinhala paragraph that immediately follows it (the site
// serves them alternating, block by block).
export function buildRows(blocks: Block[]): Row[] {
  const rows: Row[] = []
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i]
    if (b.tag === 'h1' || b.tag === 'h2' || b.tag === 'h3') {
      rows.push({ kind: 'heading', tag: b.tag, content: b.content })
    } else if (b.lang === 'pali') {
      const next = blocks[i + 1]
      if (next && next.lang === 'sinhala') {
        rows.push({ kind: 'pair', pali: b.content, sinhala: next.content })
        i++ // consume the Sinhala partner
      } else {
        rows.push({ kind: 'single', lang: 'pali', content: b.content })
      }
    } else if (b.lang === 'sinhala') {
      rows.push({ kind: 'single', lang: 'sinhala', content: b.content })
    } else {
      rows.push({ kind: 'heading', tag: b.tag, content: b.content })
    }
  }
  return rows
}

function LangBadge({ lang }: { lang: 'pali' | 'sinhala' }) {
  return (
    <span
      className="mb-1 inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide"
      style={
        lang === 'pali'
          ? { background: '#fef3c7', color: '#92400e' }
          : { background: '#dcfce7', color: '#166534' }
      }
    >
      {lang === 'pali' ? 'Pali' : 'Sinhala'}
    </span>
  )
}

const HEADING_SIZES: Record<string, string> = {
  h1: 'text-xl md:text-2xl',
  h2: 'text-lg md:text-xl',
  h3: 'text-base md:text-lg',
}

export default function Reader({
  blocks,
  translation = null,
}: {
  blocks: Block[]
  translation?: TranslationResult | null
}) {
  const [mode, setMode] = useState<'side' | 'interleaved'>('side')
  const [pick, setPick] = useState<WordPick | null>(null)
  const rows = useMemo(() => buildRows(blocks), [blocks])

  // Pali paragraphs render clickable words; Sinhala stays plain.
  const paliBody = (text: string) => <PaliWords text={text} onPick={setPick} />
  const sinhalaBody = (text: string) => <p className="font-tipitaka">{text}</p>

  if (translation) {
    // alternate translation view (e.g. Buddha Jayanthi): its own Pali and
    // Sinhala, aligned segment by segment
    const pali = translation.pali
    const sinhala = translation.sinhala
    const n = Math.max(pali.length, sinhala.length)
    return (
      <div>
        {pick && <DictPopup pick={pick} onClose={() => setPick(null)} />}
        <div className="mb-4 rounded-lg border p-3 text-sm" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
          <b>{translation.label}</b> — Pali and Sinhala from the same edition,
          aligned paragraph by paragraph. Click any Pāli word for dictionary lookups.
        </div>
        {Array.from({ length: n }, (_, i) => {
          const p = pali[i]
          const s = sinhala[i]
          const isHeading = (p?.tag ?? s?.tag) === 'heading'
          if (isHeading) {
            return (
              <div key={i} className="font-tipitaka mt-5 mb-3 text-center text-lg font-semibold">
                {(s?.content || p?.content || '').replace(/^\d+\.\s*/, '')}
              </div>
            )
          }
          return (
            <div key={i} className="mb-5 grid gap-5 md:grid-cols-2">
              <div className="rounded-lg p-3" style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}>
                <LangBadge lang="pali" />
                <div className="font-tipitaka">{p ? paliBody(p.content) : ''}</div>
              </div>
              <div className="rounded-lg p-3" style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}>
                <LangBadge lang="sinhala" />
                <div className="font-tipitaka">{s ? sinhalaBody(s.content) : ''}</div>
              </div>
            </div>
          )
        })}
      </div>
    )
  }

  return (
    <div>
      {pick && <DictPopup pick={pick} onClose={() => setPick(null)} />}
      <div className="mb-4 flex items-center gap-1 text-sm">
        <span className="mr-2" style={{ color: 'var(--muted)' }}>
          View:
        </span>
        {(['side', 'interleaved'] as const).map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className="rounded-full border px-3 py-1 text-xs font-medium transition"
            style={
              mode === m
                ? { background: 'var(--brand)', color: 'var(--brand-ink)', borderColor: 'var(--brand)' }
                : { borderColor: 'var(--line)' }
            }
          >
            {m === 'side' ? 'Side-by-side' : 'Interleaved'}
          </button>
        ))}
        <span className="ml-auto hidden text-xs sm:inline" style={{ color: 'var(--muted)' }}>
          💡 Click any Pāli word for dictionary lookups
        </span>
      </div>

      {rows.map((row, i) => {
        if (row.kind === 'heading') {
          return (
            <div
              key={i}
              className={`${HEADING_SIZES[row.tag] ?? 'text-base'} font-tipitaka mb-4 mt-6 text-center font-semibold`}
              style={{ color: 'var(--ink)' }}
            >
              {row.content}
            </div>
          )
        }
        if (row.kind === 'single') {
          return (
            <div key={i} className="font-tipitaka mb-5">
              <LangBadge lang={row.lang} />
              {row.lang === 'pali' ? paliBody(row.content) : sinhalaBody(row.content)}
            </div>
          )
        }
        // pair
        if (mode === 'side') {
          return (
            <div key={i} className="mb-5 grid gap-5 md:grid-cols-2">
              <div className="rounded-lg p-3" style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}>
                <LangBadge lang="pali" />
                <div className="font-tipitaka">{paliBody(row.pali)}</div>
              </div>
              <div className="rounded-lg p-3" style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}>
                <LangBadge lang="sinhala" />
                <div className="font-tipitaka">{sinhalaBody(row.sinhala)}</div>
              </div>
            </div>
          )
        }
        return (
          <div key={i} className="mb-5">
            <LangBadge lang="pali" />
            <div className="font-tipitaka">{paliBody(row.pali)}</div>
            <div className="my-2" style={{ borderTop: '1px dashed var(--line)' }} />
            <LangBadge lang="sinhala" />
            <div className="font-tipitaka">{sinhalaBody(row.sinhala)}</div>
          </div>
        )
      })}
    </div>
  )
}
