// AI chat client + local persistence for saved chats and saved messages.
// Chats go through the server-side proxy (api/ai.py), which holds the
// DeepSeek key; saved items live in this browser's localStorage.

export interface ChatMsg {
  role: 'user' | 'assistant'
  content: string
}

export interface WordInfo {
  word: string
  roman?: string | null
  context?: string | null
  dictHints?: string | null
}

export interface SavedChat extends WordInfo {
  id: string
  lang?: string
  messages: ChatMsg[]
  created: number
  updated: number
}

export interface SavedSnippet {
  id: string
  word: string
  roman?: string | null
  role: ChatMsg['role']
  content: string
  question?: string // the user prompt an assistant reply answered
  saved: number
}

// Answer languages (codes must match LANGUAGES in api/ai.py).
export const LANGUAGES: { code: string; label: string }[] = [
  { code: 'en', label: 'English' },
  { code: 'si', label: 'සිංහල' },
  { code: 'hi', label: 'हिन्दी' },
  { code: 'ta', label: 'தமிழ்' },
  { code: 'th', label: 'ไทย' },
  { code: 'my', label: 'မြန်မာ' },
  { code: 'zh', label: '中文' },
  { code: 'ja', label: '日本語' },
  { code: 'de', label: 'Deutsch' },
  { code: 'fr', label: 'Français' },
  { code: 'es', label: 'Español' },
]

const LANG_KEY = 'tripitaka-ai-lang'

export function getLangPref(): string {
  try {
    const v = localStorage.getItem(LANG_KEY)
    if (v && LANGUAGES.some((l) => l.code === v)) return v
  } catch {
    /* storage unavailable */
  }
  return 'en'
}

export function setLangPref(code: string) {
  try {
    localStorage.setItem(LANG_KEY, code)
  } catch {
    /* storage unavailable */
  }
}

const AI_URL: string = import.meta.env.VITE_AI_URL || '/api/ai/chat'
const CHATS_KEY = 'tripitaka-ai-chats'
const SNIPPETS_KEY = 'tripitaka-ai-snippets'

// ---------------------------------------------------------------------------
// streaming chat
// ---------------------------------------------------------------------------
export async function streamChat(
  info: WordInfo,
  messages: ChatMsg[],
  lang: string,
  onDelta: (text: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(AI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      word: info.word,
      roman: info.roman || null,
      context: info.context || null,
      dict_hints: info.dictHints || null,
      lang,
      messages,
    }),
    signal,
  })
  if (!res.ok || !res.body) {
    let detail = `${res.status} ${res.statusText}`
    try {
      const j = await res.json()
      if (j?.detail) detail = typeof j.detail === 'string' ? j.detail : JSON.stringify(j.detail)
    } catch {
      /* not JSON */
    }
    if (res.status === 404 || res.status === 405) detail = 'AI chat is not available on this host'
    throw new Error(detail)
  }
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let nl: number
    while ((nl = buf.indexOf('\n\n')) >= 0) {
      const event = buf.slice(0, nl)
      buf = buf.slice(nl + 2)
      for (const line of event.split('\n')) {
        if (!line.startsWith('data:')) continue
        const data = line.slice(5).trim()
        if (data === '[DONE]') return
        const obj = JSON.parse(data) as { delta?: string; error?: string }
        if (obj.error) throw new Error(obj.error)
        if (obj.delta) onDelta(obj.delta)
      }
    }
  }
}

// ---------------------------------------------------------------------------
// localStorage persistence (fails soft: private mode / quota just no-ops)
// ---------------------------------------------------------------------------
function load<T>(key: string): T[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) || '[]')
    return Array.isArray(v) ? v : []
  } catch {
    return []
  }
}

function store<T>(key: string, items: T[]): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(items))
    window.dispatchEvent(new Event('tripitaka-ai-saved'))
    return true
  } catch {
    return false
  }
}

export const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8)

export const listChats = () => load<SavedChat>(CHATS_KEY).sort((a, b) => b.updated - a.updated)
export const listSnippets = () => load<SavedSnippet>(SNIPPETS_KEY).sort((a, b) => b.saved - a.saved)

export function saveChat(chat: SavedChat): boolean {
  const rest = load<SavedChat>(CHATS_KEY).filter((c) => c.id !== chat.id)
  return store(CHATS_KEY, [{ ...chat, updated: Date.now() }, ...rest])
}

export function isChatSaved(id: string): boolean {
  return load<SavedChat>(CHATS_KEY).some((c) => c.id === id)
}

export function deleteChat(id: string) {
  store(CHATS_KEY, load<SavedChat>(CHATS_KEY).filter((c) => c.id !== id))
}

export function saveSnippet(s: Omit<SavedSnippet, 'id' | 'saved'>): boolean {
  return store(SNIPPETS_KEY, [{ ...s, id: newId(), saved: Date.now() }, ...load<SavedSnippet>(SNIPPETS_KEY)])
}

export function deleteSnippet(id: string) {
  store(SNIPPETS_KEY, load<SavedSnippet>(SNIPPETS_KEY).filter((s) => s.id !== id))
}

// ---------------------------------------------------------------------------
// export as Markdown
// ---------------------------------------------------------------------------
const wordTitle = (w: { word: string; roman?: string | null }) =>
  w.roman && w.roman !== w.word ? `${w.word} (${w.roman})` : w.word

export function chatToMarkdown(c: SavedChat): string {
  const parts = [`# Pāli grammar chat — ${wordTitle(c)}`, `_${new Date(c.updated).toLocaleString()}_`]
  if (c.context) parts.push(`> ${c.context.replace(/\n/g, '\n> ')}`)
  for (const m of c.messages) parts.push(`## ${m.role === 'user' ? 'You' : 'AI'}\n\n${m.content}`)
  return parts.join('\n\n') + '\n'
}

export function snippetsToMarkdown(items: SavedSnippet[]): string {
  return (
    '# Saved Pāli AI notes\n\n' +
    items
      .map((s) => {
        const head = `## ${wordTitle(s)} — ${s.role === 'user' ? 'question' : 'answer'}`
        const q = s.question ? `> ${s.question.replace(/\n/g, '\n> ')}\n\n` : ''
        return `${head}\n\n_${new Date(s.saved).toLocaleString()}_\n\n${q}${s.content}`
      })
      .join('\n\n---\n\n') +
    '\n'
  )
}

export function downloadText(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
