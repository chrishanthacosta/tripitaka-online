import { useMemo, useState, type CSSProperties } from 'react'
import type { Block, TranslationResult } from '../api'
import DictPopup from './DictPopup'
import PaliWords, { type WordPick } from './PaliWords'
import SpeechBar, { SpeakButton, useReadingKey } from './SpeechBar'
import type { SpeechItem } from '../speech'

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

// Read-aloud keys: `p<row>` / `s<row>` for a row's Pāli / Sinhala paragraph
// (matched against data-tts on the rendered element).
const ttsKey = (lang: 'pali' | 'sinhala', i: number) => `${lang === 'pali' ? 'p' : 's'}${i}`

// Every paragraph in reading order (Pāli before its Sinhala).
function rowItems(rows: Row[]): SpeechItem[] {
  const out: SpeechItem[] = []
  rows.forEach((r, i) => {
    if (r.kind === 'pair') {
      out.push({ key: ttsKey('pali', i), lang: 'pali', text: r.pali })
      out.push({ key: ttsKey('sinhala', i), lang: 'sinhala', text: r.sinhala })
    } else if (r.kind === 'single') {
      out.push({ key: ttsKey(r.lang, i), lang: r.lang, text: r.content })
    }
  })
  return out
}

function translationItems(t: TranslationResult): SpeechItem[] {
  const out: SpeechItem[] = []
  const strip = (x: string) => x.replace(/^\d+\.\s*/, '')
  for (let i = 0; i < Math.max(t.pali.length, t.sinhala.length); i++) {
    const p = t.pali[i]
    const s = t.sinhala[i]
    // headings show one line (Sinhala preferred), so only that one is read
    if ((p?.tag ?? s?.tag) === 'heading') {
      if (s?.content) out.push({ key: ttsKey('sinhala', i), lang: 'sinhala', text: strip(s.content) })
      else if (p?.content) out.push({ key: ttsKey('pali', i), lang: 'pali', text: strip(p.content) })
      continue
    }
    if (p) out.push({ key: ttsKey('pali', i), lang: 'pali', text: p.content })
    if (s) out.push({ key: ttsKey('sinhala', i), lang: 'sinhala', text: s.content })
  }
  return out
}

// highlight for the paragraph currently being read aloud
const readingStyle = { outline: '2px solid var(--brand)', outlineOffset: '2px', borderRadius: '0.5rem' }

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
  speechId = 'reader',
}: {
  blocks: Block[]
  translation?: TranslationResult | null
  speechId?: string // identifies this text for read-aloud (e.g. the sutta id)
}) {
  const [mode, setMode] = useState<'side' | 'interleaved'>('side')
  const [pick, setPick] = useState<WordPick | null>(null)
  const rows = useMemo(() => buildRows(blocks), [blocks])
  const queueId = translation ? `${speechId}:${translation.source}` : speechId
  const items = useMemo(() => (translation ? translationItems(translation) : rowItems(rows)), [translation, rows])
  const reading = useReadingKey(queueId)
  // props for a read-aloud paragraph: its data-tts key + highlight while read
  const tts = (lang: 'pali' | 'sinhala', i: number, style?: CSSProperties) => {
    const key = ttsKey(lang, i)
    return { 'data-tts': key, style: reading === key ? { ...style, ...readingStyle } : style }
  }
  const speak = (lang: 'pali' | 'sinhala', i: number) => (
    <SpeakButton queueId={queueId} items={items} itemKey={ttsKey(lang, i)} />
  )
  const card = { background: 'var(--panel)', border: '1px solid var(--line)' }

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
        <SpeechBar queueId={queueId} items={items} />
        {Array.from({ length: n }, (_, i) => {
          const p = pali[i]
          const s = sinhala[i]
          const isHeading = (p?.tag ?? s?.tag) === 'heading'
          if (isHeading) {
            return (
              <div
                key={i}
                className="font-tipitaka mt-5 mb-3 text-center text-lg font-semibold"
                {...tts(s?.content ? 'sinhala' : 'pali', i)}
              >
                {(s?.content || p?.content || '').replace(/^\d+\.\s*/, '')}
              </div>
            )
          }
          return (
            <div key={i} className="mb-5 grid gap-5 md:grid-cols-2">
              <div className="rounded-lg p-3" {...tts('pali', i, card)}>
                <LangBadge lang="pali" />
                {p && speak('pali', i)}
                <div className="font-tipitaka">{p ? paliBody(p.content) : ''}</div>
              </div>
              <div className="rounded-lg p-3" {...tts('sinhala', i, card)}>
                <LangBadge lang="sinhala" />
                {s && speak('sinhala', i)}
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
      <SpeechBar queueId={queueId} items={items} />

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
            <div key={i} className="font-tipitaka mb-5" {...tts(row.lang, i)}>
              <LangBadge lang={row.lang} />
              {speak(row.lang, i)}
              {row.lang === 'pali' ? paliBody(row.content) : sinhalaBody(row.content)}
            </div>
          )
        }
        // pair
        if (mode === 'side') {
          return (
            <div key={i} className="mb-5 grid gap-5 md:grid-cols-2">
              <div className="rounded-lg p-3" {...tts('pali', i, card)}>
                <LangBadge lang="pali" />
                {speak('pali', i)}
                <div className="font-tipitaka">{paliBody(row.pali)}</div>
              </div>
              <div className="rounded-lg p-3" {...tts('sinhala', i, card)}>
                <LangBadge lang="sinhala" />
                {speak('sinhala', i)}
                <div className="font-tipitaka">{sinhalaBody(row.sinhala)}</div>
              </div>
            </div>
          )
        }
        return (
          <div key={i} className="mb-5">
            <div {...tts('pali', i)}>
              <LangBadge lang="pali" />
              {speak('pali', i)}
              <div className="font-tipitaka">{paliBody(row.pali)}</div>
            </div>
            <div className="my-2" style={{ borderTop: '1px dashed var(--line)' }} />
            <div {...tts('sinhala', i)}>
              <LangBadge lang="sinhala" />
              {speak('sinhala', i)}
              <div className="font-tipitaka">{sinhalaBody(row.sinhala)}</div>
            </div>
          </div>
        )
      })}
    </div>
  )
}
