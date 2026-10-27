// Read-aloud controls (Sinhala, Pāli or both): an inline toolbar (Listen +
// voice settings), a floating mini player while reading, and a per-paragraph
// speak button.
// Playback itself lives in ../speech.ts.
import { useEffect, useState } from 'react'
import {
  activeVoice,
  filterItems,
  isEdge,
  isSinhalaVoice,
  speech,
  useSpeech,
  type ReadLang,
  type SpeechItem,
} from '../speech'

const pill = 'rounded-full border px-3 py-1 text-xs font-medium transition hover:opacity-80'
const iconBtn = 'flex h-8 w-8 items-center justify-center rounded-full border text-sm transition hover:opacity-80'

function NoVoiceNotice() {
  return (
    <div className="rounded-lg border p-2.5 text-xs" style={{ borderColor: '#f59e0b', background: 'rgba(245,158,11,0.08)' }}>
      No Sinhala voice was found in this browser.{' '}
      {isEdge()
        ? 'Edge loads its online voices ("Thilini", "Sameera") when connected to the internet — check your connection and reload.'
        : 'Open this page in Microsoft Edge, which includes Sinhala voices ("Thilini", "Sameera"), or install a Sinhala voice in your operating system.'}
    </div>
  )
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  fmt,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step: number
  fmt: (v: number) => string
  onChange: (v: number) => void
}) {
  return (
    <label className="flex items-center gap-2 text-xs">
      <span className="w-14 shrink-0" style={{ color: 'var(--muted)' }}>
        {label}
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="min-w-0 flex-1"
        style={{ accentColor: 'var(--brand)' }}
      />
      <span className="w-10 shrink-0 text-right font-mono">{fmt(value)}</span>
    </label>
  )
}

const SPEEDS = [0.75, 1, 1.25, 1.5]
const LANG_LABELS: Record<ReadLang, string> = { sinhala: 'සිංහල', pali: 'Pāli', both: 'Both' }

function VoiceSelect({
  label,
  value,
  sameAs,
  onChange,
}: {
  label: string
  value: SpeechSynthesisVoice | null
  sameAs?: string // offer "Same as <sameAs>" as the empty choice
  onChange: (uri: string | null) => void
}) {
  const s = useSpeech()
  const sinhala = s.voices.filter(isSinhalaVoice)
  const listed = s.settings.showAllVoices
    ? [...sinhala, ...s.voices.filter((v) => !isSinhalaVoice(v))]
    : sinhala
  return (
    <label className="flex items-center gap-2 text-xs">
      <span className="w-14 shrink-0" style={{ color: 'var(--muted)' }}>
        {label}
      </span>
      <select
        value={value?.voiceURI ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        className="min-w-0 flex-1 rounded border px-2 py-1"
        style={{ borderColor: 'var(--line)', background: 'var(--panel)', color: 'var(--ink)' }}
      >
        {sameAs ? <option value="">Same as {sameAs}</option> : !value && <option value="">(browser default)</option>}
        {listed.map((v) => (
          <option key={v.voiceURI} value={v.voiceURI}>
            {v.name} — {v.lang}
            {v.localService ? '' : ' (online)'}
          </option>
        ))}
      </select>
    </label>
  )
}

function SpeedControl({ label, value, onChange }: { label: string; value: number; onChange: (r: number) => void }) {
  return (
    <div className="space-y-1">
      <Slider label={label} value={value} min={0.5} max={2} step={0.05} fmt={(v) => `${v.toFixed(2)}×`} onChange={onChange} />
      <div className="flex flex-wrap gap-1 pl-16">
        {SPEEDS.map((r) => (
          <button
            key={r}
            onClick={() => onChange(r)}
            className="rounded border px-1.5 py-0.5 text-[11px]"
            style={
              Math.abs(value - r) < 0.001
                ? { background: 'var(--brand)', color: 'var(--brand-ink)', borderColor: 'var(--brand)' }
                : { borderColor: 'var(--line)' }
            }
          >
            {r}×
          </button>
        ))}
      </div>
    </div>
  )
}

export function SpeechSettingsPanel() {
  const s = useSpeech()
  const { settings } = s
  const hasSinhala = s.voices.some(isSinhalaVoice)
  const paliVoice = settings.paliVoiceURI ? activeVoice(s, 'pali') : null

  return (
    <div className="space-y-2.5">
      {!hasSinhala && <NoVoiceNotice />}
      <VoiceSelect label="Sinhala" value={activeVoice(s)} onChange={(voiceURI) => speech.updateSettings({ voiceURI })} />
      <VoiceSelect
        label="Pāli"
        value={paliVoice}
        sameAs="Sinhala"
        onChange={(paliVoiceURI) => speech.updateSettings({ paliVoiceURI })}
      />
      <SpeedControl label="Speed" value={settings.rate} onChange={(rate) => speech.updateSettings({ rate })} />
      <SpeedControl label="Pāli speed" value={settings.paliRate} onChange={(paliRate) => speech.updateSettings({ paliRate })} />
      <p className="pl-16 text-[11px]" style={{ color: 'var(--muted)' }}>
        There is no Pāli voice; the Pāli (in Sinhala script) is read with a Sinhala voice.
      </p>
      <Slider
        label="Pitch"
        value={settings.pitch}
        min={0.5}
        max={2}
        step={0.05}
        fmt={(v) => v.toFixed(2)}
        onChange={(pitch) => speech.updateSettings({ pitch })}
      />
      <Slider
        label="Volume"
        value={settings.volume}
        min={0}
        max={1}
        step={0.05}
        fmt={(v) => `${Math.round(v * 100)}%`}
        onChange={(volume) => speech.updateSettings({ volume })}
      />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={settings.follow}
            onChange={(e) => speech.updateSettings({ follow: e.target.checked })}
            style={{ accentColor: 'var(--brand)' }}
          />
          Follow along (auto-scroll)
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="checkbox"
            checked={settings.showAllVoices}
            onChange={(e) => speech.updateSettings({ showAllVoices: e.target.checked })}
            style={{ accentColor: 'var(--brand)' }}
          />
          Show non-Sinhala voices
        </label>
        <button onClick={() => speech.test('sinhala')} className={pill} style={{ borderColor: 'var(--line)' }}>
          Test Sinhala
        </button>
        <button onClick={() => speech.test('pali')} className={pill} style={{ borderColor: 'var(--line)' }}>
          Test Pāli
        </button>
        <button
          onClick={() => speech.updateSettings({ rate: 1, paliRate: 0.85, pitch: 1, volume: 1 })}
          className={pill}
          style={{ borderColor: 'var(--line)' }}
        >
          Reset
        </button>
      </div>
    </div>
  )
}

// Inline toolbar above the text + floating player while this reader's queue
// is playing. `queueId` identifies the reader (e.g. sutta + translation) so a
// stale queue from another page is never shown as "ours".
export default function SpeechBar({ queueId, items }: { queueId: string; items: SpeechItem[] }) {
  const s = useSpeech()
  const [open, setOpen] = useState(false)
  const ours = s.queueId === queueId && s.status !== 'idle'
  const readLang = s.settings.readLang

  // stop reading when leaving the sutta or switching translation
  useEffect(
    () => () => {
      if (speech.owner() === queueId) speech.stop()
    },
    [queueId],
  )

  if (!s.supported) return null
  const has = (l: 'pali' | 'sinhala') => items.some((it) => it.lang === l && it.text.trim())
  if (!has('pali') && !has('sinhala')) return null
  const langs = (['sinhala', 'pali', 'both'] as const).filter((l) => l === 'both' ? has('pali') && has('sinhala') : has(l))

  // switch language; if reading, carry on from the same spot in the text
  function chooseLang(lang: ReadLang) {
    speech.updateSettings({ readLang: lang })
    if (!ours) return
    const at = Math.max(0, items.findIndex((it) => it.key === s.currentKey))
    const next = items.slice(at).find((it) => lang === 'both' || it.lang === lang)
    if (next) speech.play(queueId, filterItems(items, lang), next.key)
    else speech.stop()
  }

  return (
    <div className="mb-4">
      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        <span className="mr-1" style={{ color: 'var(--muted)' }}>
          Listen:
        </span>
        {langs.length > 1 && (
          <div className="mr-1 inline-flex overflow-hidden rounded-full border text-xs" style={{ borderColor: 'var(--line)' }}>
            {langs.map((l) => (
              <button
                key={l}
                onClick={() => chooseLang(l)}
                className="px-2.5 py-1 font-medium transition"
                style={readLang === l ? { background: 'var(--brand)', color: 'var(--brand-ink)' } : undefined}
              >
                {LANG_LABELS[l]}
              </button>
            ))}
          </div>
        )}
        {!ours ? (
          <button
            onClick={() => {
              const lang = langs.includes(readLang) ? readLang : langs[0]
              speech.play(queueId, filterItems(items, lang))
            }}
            className={pill}
            style={{ background: 'var(--brand)', color: 'var(--brand-ink)', borderColor: 'var(--brand)' }}
          >
            ▶ Read aloud
          </button>
        ) : (
          <>
            {s.status === 'playing' ? (
              <button onClick={speech.pause} className={pill} style={{ borderColor: 'var(--line)' }}>
                ⏸ Pause
              </button>
            ) : (
              <button onClick={speech.resume} className={pill} style={{ borderColor: 'var(--line)' }}>
                ▶ Resume
              </button>
            )}
            <button onClick={speech.stop} className={pill} style={{ borderColor: 'var(--line)' }}>
              ⏹ Stop
            </button>
          </>
        )}
        <button
          onClick={() => setOpen((o) => !o)}
          className={pill}
          style={open ? { borderColor: 'var(--brand)', color: 'var(--brand)' } : { borderColor: 'var(--line)' }}
          aria-expanded={open}
        >
          ⚙ Voice & speed
        </button>
        <span className="ml-1 text-xs" style={{ color: 'var(--muted)' }}>
          {activeVoice(s)?.name.replace(/^Microsoft\s+/, '').replace(/\s+-\s+.*$/, '') ?? ''}
          {readLang !== 'pali' && s.settings.rate !== 1 ? ` · ${s.settings.rate.toFixed(2)}×` : ''}
          {readLang !== 'sinhala' && has('pali') ? ` · Pāli ${s.settings.paliRate.toFixed(2)}×` : ''}
        </span>
      </div>
      {open && (
        <div className="mt-2 max-w-xl rounded-lg border p-3" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
          <SpeechSettingsPanel />
        </div>
      )}
      {ours && <MiniPlayer />}
    </div>
  )
}

function MiniPlayer() {
  const s = useSpeech()
  const [open, setOpen] = useState(false)
  const pali = s.currentKey?.startsWith('p') ?? false
  const rate = pali ? s.settings.paliRate : s.settings.rate
  return (
    <div
      className="fixed inset-x-0 bottom-3 z-30 mx-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border p-2 shadow-lg"
      style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}
    >
      {open && (
        <div className="mb-2 border-b p-1 pb-3" style={{ borderColor: 'var(--line)' }}>
          <SpeechSettingsPanel />
        </div>
      )}
      <div className="flex items-center gap-1.5">
        <button onClick={() => speech.skip(-1)} className={iconBtn} style={{ borderColor: 'var(--line)' }} title="Previous paragraph">
          ⏮
        </button>
        {s.status === 'playing' ? (
          <button
            onClick={speech.pause}
            className={iconBtn}
            style={{ background: 'var(--brand)', color: 'var(--brand-ink)', borderColor: 'var(--brand)' }}
            title="Pause"
          >
            ⏸
          </button>
        ) : (
          <button
            onClick={speech.resume}
            className={iconBtn}
            style={{ background: 'var(--brand)', color: 'var(--brand-ink)', borderColor: 'var(--brand)' }}
            title="Resume"
          >
            ▶
          </button>
        )}
        <button onClick={() => speech.skip(1)} className={iconBtn} style={{ borderColor: 'var(--line)' }} title="Next paragraph">
          ⏭
        </button>
        <button onClick={speech.stop} className={iconBtn} style={{ borderColor: 'var(--line)' }} title="Stop">
          ⏹
        </button>
        <span className="ml-1 min-w-0 flex-1 truncate text-xs" style={{ color: 'var(--muted)' }}>
          {pali ? 'Pāli' : 'සිංහල'} · ¶ {(s.current ?? 0) + 1} / {s.total}
        </span>
        <select
          value={String(rate)}
          onChange={(e) => speech.updateSettings(pali ? { paliRate: Number(e.target.value) } : { rate: Number(e.target.value) })}
          className="rounded border px-1 py-1 text-xs"
          style={{ borderColor: 'var(--line)', background: 'var(--panel)', color: 'var(--ink)' }}
          title={pali ? 'Pāli speed' : 'Sinhala speed'}
        >
          {[...new Set([0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, rate])]
            .sort((a, b) => a - b)
            .map((r) => (
              <option key={r} value={String(r)}>
                {Number(r.toFixed(2))}×
              </option>
            ))}
        </select>
        <button
          onClick={() => setOpen((o) => !o)}
          className={iconBtn}
          style={open ? { borderColor: 'var(--brand)', color: 'var(--brand)' } : { borderColor: 'var(--line)' }}
          title="Voice settings"
        >
          ⚙
        </button>
      </div>
    </div>
  )
}

// Small 🔊 button on a paragraph: start reading from here (switching the
// read-aloud language to this paragraph's if it isn't being read).
export function SpeakButton({ queueId, items, itemKey }: { queueId: string; items: SpeechItem[]; itemKey: string }) {
  const s = useSpeech()
  if (!s.supported) return null
  const active = s.queueId === queueId && s.currentKey === itemKey && s.status !== 'idle'
  function start() {
    const item = items.find((it) => it.key === itemKey)
    let lang = s.settings.readLang
    if (item && lang !== 'both' && lang !== item.lang) {
      lang = item.lang
      speech.updateSettings({ readLang: lang })
    }
    speech.play(queueId, filterItems(items, lang), itemKey)
  }
  return (
    <button
      onClick={() => (active ? speech.stop() : start())}
      className="ml-1.5 inline-flex h-5 w-5 items-center justify-center rounded align-middle text-[11px] transition hover:opacity-100"
      style={{ opacity: active ? 1 : 0.55, color: active ? 'var(--brand)' : 'var(--muted)' }}
      title={active ? 'Stop reading' : 'Read aloud from here'}
      aria-label={active ? 'Stop reading' : 'Read aloud from here'}
    >
      {active ? '⏹' : '🔊'}
    </button>
  )
}

// Key of this queue's paragraph being read (for highlighting), auto-scrolling
// it into view when "follow along" is on.
export function useReadingKey(queueId: string): string | null {
  const s = useSpeech()
  const current = s.queueId === queueId && s.status !== 'idle' ? s.currentKey : null
  useEffect(() => {
    if (current === null || !s.settings.follow) return
    const el = document.querySelector<HTMLElement>(`[data-tts="${current}"]`)
    if (!el) return
    const r = el.getBoundingClientRect()
    if (r.top < 70 || r.bottom > window.innerHeight - 90) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [current, s.settings.follow])
  return current
}
