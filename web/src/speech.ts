// Read-aloud for Sinhala and Pāli text via the browser's Web Speech API.
// Sinhala voices ship with Microsoft Edge ("Thilini" / "Sameera" online
// voices); most other browsers have none unless the OS provides one. There is
// no Pāli voice anywhere, but the Pāli here is in Sinhala script, which the
// Sinhala voices read well. A single module-level player plays a queue of
// paragraphs, one utterance per sentence-sized chunk, and React subscribes
// via useSpeech().
import { useSyncExternalStore } from 'react'

export type ReadLang = 'sinhala' | 'pali' | 'both'

// One readable paragraph; `key` matches the element's data-tts attribute.
export interface SpeechItem {
  key: string
  lang: 'pali' | 'sinhala'
  text: string
}

export interface SpeechSettings {
  voiceURI: string | null // Sinhala text
  paliVoiceURI: string | null // Pāli text (null = same as Sinhala)
  rate: number
  paliRate: number
  readLang: ReadLang
  pitch: number
  volume: number
  showAllVoices: boolean
  follow: boolean // scroll the paragraph being read into view
}

export interface SpeechState {
  supported: boolean
  voices: SpeechSynthesisVoice[]
  settings: SpeechSettings
  status: 'idle' | 'playing' | 'paused'
  queueId: string | null // which reader owns the queue
  current: number | null // queue index being read
  currentKey: string | null // its SpeechItem.key
  total: number
}

const SETTINGS_KEY = 'tripitaka-tts'
const DEFAULTS: SpeechSettings = {
  voiceURI: null,
  paliVoiceURI: null,
  rate: 1,
  paliRate: 0.85,
  readLang: 'sinhala',
  pitch: 1,
  volume: 1,
  showAllVoices: false,
  follow: true,
}

const synth: SpeechSynthesis | null =
  typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null

export const isSinhalaVoice = (v: SpeechSynthesisVoice) => /^si([-_]|$)/i.test(v.lang)
export const isEdge = () => typeof navigator !== 'undefined' && /\bEdg\//.test(navigator.userAgent)

function loadSettings(): SpeechSettings {
  try {
    const v = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')
    return { ...DEFAULTS, ...(v && typeof v === 'object' ? v : {}) }
  } catch {
    return { ...DEFAULTS }
  }
}

// Split a paragraph into chunks at sentence ends (then commas/spaces) so no
// single utterance is too long — some engines stall or cut off long input.
const MAX_CHUNK = 220
export function chunkText(text: string): string[] {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (!clean) return []
  const sentences = clean.match(/[^.!?।॥෴]+[.!?।॥෴]*\s*/g) ?? [clean]
  const out: string[] = []
  for (let s of sentences) {
    s = s.trim()
    while (s.length > MAX_CHUNK) {
      let cut = s.lastIndexOf(',', MAX_CHUNK)
      if (cut < MAX_CHUNK / 3) cut = s.lastIndexOf(' ', MAX_CHUNK)
      if (cut < MAX_CHUNK / 3) cut = MAX_CHUNK
      out.push(s.slice(0, cut + 1).trim())
      s = s.slice(cut + 1).trim()
    }
    if (s) out.push(s)
  }
  return out
}

let state: SpeechState = {
  supported: !!synth,
  voices: [],
  settings: loadSettings(),
  status: 'idle',
  queueId: null,
  current: null,
  currentKey: null,
  total: 0,
}
const listeners = new Set<() => void>()

function set(patch: Partial<SpeechState>) {
  state = { ...state, ...patch }
  listeners.forEach((l) => l())
}

// playback internals
let queue: SpeechItem[] = []
let chunks: string[] = []
let chunkIdx = 0
let gen = 0 // bumps on every restart so stale utterance callbacks are ignored

function refreshVoices() {
  if (!synth) return
  const voices = synth.getVoices()
  set({ voices })
}

if (synth) {
  refreshVoices()
  synth.addEventListener?.('voiceschanged', refreshVoices)
  // stop talking when the page goes away
  window.addEventListener('pagehide', () => synth.cancel())
}

// The voice to use: the saved one if still installed, else the first
// Sinhala voice (natural/online ones preferred). Pāli falls back to the
// Sinhala choice.
export function activeVoice(s: SpeechState = state, lang: 'pali' | 'sinhala' = 'sinhala'): SpeechSynthesisVoice | null {
  const { voices, settings } = s
  const find = (uri: string | null) => (uri && voices.find((v) => v.voiceURI === uri)) || null
  const saved = (lang === 'pali' && find(settings.paliVoiceURI)) || find(settings.voiceURI)
  if (saved) return saved
  const si = voices.filter(isSinhalaVoice)
  return si.find((v) => /natural|online/i.test(v.name)) ?? si[0] ?? null
}

function speakChunk() {
  if (!synth) return
  const myGen = gen
  const p = state.current
  if (p === null) return
  if (chunkIdx >= chunks.length) {
    // paragraph finished: advance (skip empty paragraphs)
    let next = p + 1
    while (next < queue.length && chunkText(queue[next].text).length === 0) next++
    if (next >= queue.length) {
      set({ status: 'idle', current: null, currentKey: null })
      return
    }
    chunks = chunkText(queue[next].text)
    chunkIdx = 0
    set({ current: next, currentKey: queue[next].key })
  }
  const item = queue[state.current!]
  const u = new SpeechSynthesisUtterance(chunks[chunkIdx])
  const voice = activeVoice(state, item.lang)
  if (voice) {
    u.voice = voice
    u.lang = voice.lang
  } else {
    u.lang = 'si-LK'
  }
  u.rate = item.lang === 'pali' ? state.settings.paliRate : state.settings.rate
  u.pitch = state.settings.pitch
  u.volume = state.settings.volume
  u.onend = () => {
    if (myGen !== gen) return
    chunkIdx++
    speakChunk()
  }
  u.onerror = (e) => {
    if (myGen !== gen) return
    if (e.error === 'interrupted' || e.error === 'canceled') return
    console.warn('speech error', e.error)
    chunkIdx++
    speakChunk()
  }
  synth.speak(u)
}

// Cancel whatever is speaking and continue from the current position.
function restart() {
  if (!synth) return
  gen++
  synth.cancel()
  if (synth.paused) synth.resume()
  set({ status: 'playing' })
  speakChunk()
}

const SAMPLES = {
  sinhala: 'මා විසින් මෙසේ අසන ලදී. එක් සමයෙක භාග්‍යවතුන් වහන්සේ සැවැත් නුවර වැඩ වසන සේක.',
  pali: 'නමෝ තස්ස භගවතෝ අරහතෝ සම්මා සම්බුද්ධස්ස. ඒවං මේ සුතං.',
}

// Which paragraphs to read for the chosen language ("both" keeps the
// Pāli/Sinhala alternation of the page).
export const filterItems = (items: SpeechItem[], lang: ReadLang) =>
  lang === 'both' ? items : items.filter((it) => it.lang === lang)

export const speech = {
  owner: () => state.queueId,
  // Read `items` from the one keyed `startKey` (or the beginning).
  play(queueId: string, items: SpeechItem[], startKey?: string) {
    if (!synth) return
    queue = items
    let i = Math.max(0, startKey ? items.findIndex((it) => it.key === startKey) : 0)
    while (i < items.length && chunkText(items[i].text).length === 0) i++
    if (i >= items.length) return
    chunks = chunkText(items[i].text)
    chunkIdx = 0
    set({ queueId, current: i, currentKey: items[i].key, total: items.length })
    restart()
  },
  pause() {
    if (!synth || state.status !== 'playing') return
    synth.pause()
    set({ status: 'paused' })
  },
  resume() {
    if (!synth || state.status !== 'paused') return
    // Some engines lose their place across pause(); resume() is enough on
    // Edge, but restarting the current chunk is a safe fallback.
    synth.resume()
    set({ status: 'playing' })
    setTimeout(() => {
      if (state.status === 'playing' && !synth.speaking) restart()
    }, 250)
  },
  stop() {
    gen++
    synth?.cancel()
    queue = []
    chunks = []
    set({ status: 'idle', current: null, currentKey: null, total: 0, queueId: null })
  },
  // jump a paragraph forward/back (back = start of the current one if we're
  // into it, like a music player)
  skip(delta: 1 | -1) {
    if (state.current === null) return
    let i = state.current
    if (delta < 0 && chunkIdx > 0) {
      // restart current paragraph
    } else {
      i += delta
      while (i >= 0 && i < queue.length && chunkText(queue[i].text).length === 0) i += delta
    }
    if (i < 0 || i >= queue.length) return
    chunks = chunkText(queue[i].text)
    chunkIdx = 0
    set({ current: i, currentKey: queue[i].key })
    restart()
  },
  updateSettings(patch: Partial<SpeechSettings>) {
    const settings = { ...state.settings, ...patch }
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
    } catch {
      /* storage unavailable */
    }
    set({ settings })
    // apply voice/rate/pitch/volume changes immediately (from the current chunk)
    const audible = ['voiceURI', 'paliVoiceURI', 'rate', 'paliRate', 'pitch', 'volume'].some((k) => k in patch)
    if (audible && state.status === 'playing') restart()
  },
  // speak a one-off sample with the current settings
  test(lang: 'pali' | 'sinhala' = 'sinhala') {
    if (!synth) return
    if (state.status !== 'idle') speech.stop()
    gen++
    synth.cancel()
    const u = new SpeechSynthesisUtterance(SAMPLES[lang])
    const voice = activeVoice(state, lang)
    if (voice) u.voice = voice
    u.lang = voice?.lang ?? 'si-LK'
    u.rate = lang === 'pali' ? state.settings.paliRate : state.settings.rate
    u.pitch = state.settings.pitch
    u.volume = state.settings.volume
    synth.speak(u)
  },
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useSpeech(): SpeechState {
  return useSyncExternalStore(subscribe, () => state)
}
