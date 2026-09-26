// Renders a Pali paragraph with clickable words. Clicking a word opens the
// dictionary popup (state lifted to the parent via onPick).
import { memo, type KeyboardEvent } from 'react'

export interface WordPick {
  word: string
  x: number
  y: number
  context?: string // the paragraph the word was clicked in
}

// Word = run of Sinhala/Latin letters incl. combining marks and ZWJ/ZWNJ.
const WORD_RE = /([\u0d80-\u0dff\u200c\u200dA-Za-z][\u0d80-\u0dff\u200c\u200dA-Za-z]*)/g
const LETTER_RE = /[\u0d80-\u0dffA-Za-z]/

function cleanWord(w: string): string {
  // strip zero-width chars so the lookup key matches dictionary headwords
  return w.replace(/[\u200c\u200d]/g, '')
}

function PaliWords({ text, onPick }: { text: string; onPick: (p: WordPick) => void }) {
  const parts: { isWord: boolean; s: string }[] = []
  let last = 0
  let m: RegExpExecArray | null
  WORD_RE.lastIndex = 0
  while ((m = WORD_RE.exec(text)) !== null) {
    if (m.index > last) parts.push({ isWord: false, s: text.slice(last, m.index) })
    parts.push({ isWord: true, s: m[0] })
    last = m.index + m[0].length
  }
  if (last < text.length) parts.push({ isWord: false, s: text.slice(last) })

  return (
    <>
      {parts.map((p, i) => {
        if (!p.isWord || !LETTER_RE.test(p.s)) return <span key={i}>{p.s}</span>
        const word = cleanWord(p.s)
        return (
          <span
            key={i}
            role="button"
            tabIndex={0}
            title={word ? 'Look up in dictionaries' : undefined}
            aria-label={word ? `Look up ${word}` : undefined}
            className="cursor-pointer rounded px-0.5 transition hover:bg-amber-200/60 hover:text-amber-900 dark:hover:bg-amber-900/40 dark:hover:text-amber-200"
            onClick={(e) => {
              if (!word) return
              e.preventDefault()
              e.stopPropagation()
              const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
              onPick({ word, x: r.left + r.width / 2, y: r.bottom + 6, context: text })
            }}
            onKeyDown={(e: KeyboardEvent) => {
              if (!word) return
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                e.stopPropagation()
                const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
                onPick({ word, x: r.left + r.width / 2, y: r.bottom + 6, context: text })
              }
            }}
          >
            {p.s}
          </span>
        )
      })}
    </>
  )
}

export default memo(PaliWords)
