// AI chat panel for investigating the Pali grammar of one word (DeepSeek via
// the server proxy). Hosted inside the dictionary popup, or on its own via
// AiChatModal (Saved page). Chats and single messages can be saved locally.
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  chatToMarkdown,
  downloadText,
  getLangPref,
  isChatSaved,
  LANGUAGES,
  newId,
  saveChat,
  saveSnippet,
  setLangPref,
  streamChat,
  type ChatMsg,
  type SavedChat,
  type WordInfo,
} from '../aiStore'

const QUICK: { label: string; prompt: string }[] = [
  { label: 'Full analysis', prompt: 'Give a full grammatical analysis of this word as it is used in the passage.' },
  { label: 'Sandhi & compound', prompt: 'Break down any sandhi or compound (samāsa) in this word.' },
  { label: 'Root & derivation', prompt: 'What is its root (dhātu), and how is the word derived from it?' },
  { label: 'Paradigm', prompt: 'Show the declension or conjugation paradigm this form belongs to, marking this form.' },
  { label: 'Parse the passage', prompt: 'Translate the passage word by word, parsing each word briefly.' },
]

export default function AiChat({
  info,
  initial,
  autoStart = false,
  onBack,
  onClose,
}: {
  info: WordInfo
  initial?: SavedChat
  autoStart?: boolean
  onBack?: () => void
  onClose: () => void
}) {
  const [chatId] = useState(() => initial?.id ?? newId())
  const [created] = useState(() => initial?.created ?? Date.now())
  const [messages, setMessages] = useState<ChatMsg[]>(initial?.messages ?? [])
  const [lang, setLang] = useState(() => initial?.lang ?? getLangPref())
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(() => isChatSaved(chatId))
  const [flash, setFlash] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const started = useRef(false)

  const chat = useCallback(
    (msgs: ChatMsg[]): SavedChat => ({
      ...info,
      id: chatId,
      lang,
      messages: msgs,
      created,
      updated: Date.now(),
    }),
    [info, chatId, created, lang],
  )

  const notify = (text: string) => {
    setFlash(text)
    setTimeout(() => setFlash(null), 1800)
  }

  const send = useCallback(
    async (text: string) => {
      const q = text.trim()
      if (!q || busy) return
      const history: ChatMsg[] = [...messages, { role: 'user', content: q }]
      setMessages([...history, { role: 'assistant', content: '' }])
      setInput('')
      setError(null)
      setBusy(true)
      const ctrl = new AbortController()
      abortRef.current = ctrl
      let answer = ''
      try {
        await streamChat(
          info,
          history,
          lang,
          (d) => {
            answer += d
            setMessages([...history, { role: 'assistant', content: answer }])
          },
          ctrl.signal,
        )
      } catch (e) {
        if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(false)
        abortRef.current = null
        const final: ChatMsg[] = answer ? [...history, { role: 'assistant', content: answer }] : history
        setMessages(final)
        // once a chat is saved, keep the saved copy up to date
        if (isChatSaved(chatId)) saveChat(chat(final))
      }
    },
    [busy, messages, info, lang, chatId, chat],
  )

  useEffect(() => {
    if (autoStart && !started.current && messages.length === 0) {
      started.current = true
      send(QUICK[0].prompt)
    }
  }, [autoStart, messages.length, send])

  useEffect(() => () => abortRef.current?.abort(), [])

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  function submit(e: FormEvent) {
    e.preventDefault()
    send(input)
  }

  function onSaveChat() {
    if (!messages.length) return
    if (saveChat(chat(messages))) {
      setSaved(true)
      notify('Chat saved')
    } else notify('Could not save (browser storage unavailable)')
  }

  function onSaveMsg(i: number) {
    const m = messages[i]
    const question = m.role === 'assistant' ? messages[i - 1]?.content : undefined
    notify(
      saveSnippet({ word: info.word, roman: info.roman, role: m.role, content: m.content, question })
        ? 'Message saved'
        : 'Could not save (browser storage unavailable)',
    )
  }

  const title = info.roman && info.roman !== info.word ? `${info.word} · ${info.roman}` : info.word
  const btn = 'rounded border px-2 py-0.5 text-xs hover:opacity-60 disabled:opacity-40'

  return (
    <div className="flex h-[80vh] flex-col">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {onBack && (
          <button onClick={onBack} className={btn} style={{ borderColor: 'var(--line)' }}>
            ← Dictionary
          </button>
        )}
        <h3 className="font-tipitaka mr-auto text-lg font-bold">
          <span className="mr-1.5 rounded px-1.5 py-0.5 align-middle text-[10px] font-bold uppercase tracking-wide" style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}>
            AI
          </span>
          {title}
        </h3>
        <label className="flex items-center gap-1 text-xs" style={{ color: 'var(--muted)' }} title="Language the AI answers in">
          Answer in
          <select
            value={lang}
            onChange={(e) => {
              setLang(e.target.value)
              setLangPref(e.target.value)
            }}
            disabled={busy}
            className="rounded border px-1 py-0.5 text-xs"
            style={{ background: 'var(--panel)', borderColor: 'var(--line)', color: 'var(--ink)' }}
          >
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
        </label>
        <button onClick={onSaveChat} disabled={!messages.length || busy} className={btn} style={{ borderColor: 'var(--line)' }} title="Save this conversation in this browser">
          {saved ? '✓ Saved' : '🔖 Save chat'}
        </button>
        <button
          onClick={() => downloadText(`pali-ai-${info.roman || 'chat'}.md`, chatToMarkdown(chat(messages)))}
          disabled={!messages.length}
          className={btn}
          style={{ borderColor: 'var(--line)' }}
          title="Download as Markdown"
        >
          ⬇ .md
        </button>
        <button onClick={onClose} className={btn} style={{ borderColor: 'var(--line)' }} aria-label="Close">
          ✕
        </button>
      </div>

      {info.context && (
        <details className="mb-2 text-xs" style={{ color: 'var(--muted)' }}>
          <summary className="cursor-pointer">Passage sent as context</summary>
          <p className="font-tipitaka mt-1">{info.context}</p>
        </details>
      )}

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
        {messages.length === 0 && !busy && (
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            Ask about the grammar of this word — pick a question below or type your own. The assistant
            only answers questions about the Pāli language.
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'flex justify-end' : ''}>
            <div
              className={`group rounded-lg px-3 py-2 text-sm ${m.role === 'user' ? 'max-w-[85%]' : 'w-full'}`}
              style={
                m.role === 'user'
                  ? { background: 'var(--brand)', color: 'var(--brand-ink)' }
                  : { background: 'var(--bg)', border: '1px solid var(--line)' }
              }
            >
              {m.role === 'user' ? (
                <p className="whitespace-pre-wrap">{m.content}</p>
              ) : m.content ? (
                <div className="ai-md font-tipitaka">
                  <Markdown remarkPlugins={[remarkGfm]}>{m.content}</Markdown>
                </div>
              ) : (
                <p style={{ color: 'var(--muted)' }}>Thinking…</p>
              )}
              {m.content && !(busy && i === messages.length - 1) && (
                <div className="mt-1 flex justify-end gap-3 text-[11px] opacity-70">
                  <button onClick={() => onSaveMsg(i)} className="hover:underline" title="Save this message">
                    🔖 Save
                  </button>
                  <button
                    onClick={() => navigator.clipboard?.writeText(m.content).then(() => notify('Copied'))}
                    className="hover:underline"
                  >
                    Copy
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
        {error && (
          <p className="text-sm" style={{ color: '#b91c1c' }}>
            {error}
          </p>
        )}
      </div>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {QUICK.map((q) => (
          <button
            key={q.label}
            onClick={() => send(q.prompt)}
            disabled={busy}
            className="font-tipitaka rounded-full border px-2.5 py-0.5 text-xs hover:opacity-60 disabled:opacity-40"
            style={{ borderColor: 'var(--line)' }}
          >
            {q.label}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="mt-2 flex gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send(input)
            }
          }}
          rows={2}
          maxLength={4000}
          placeholder="Ask about this word's grammar… (Enter to send, Shift+Enter for newline)"
          className="font-tipitaka min-w-0 flex-1 resize-none rounded-lg border px-3 py-1.5 text-sm outline-none focus:ring-2"
          style={{ background: 'var(--panel)', borderColor: 'var(--line)', lineHeight: 1.5 }}
        />
        {busy ? (
          <button type="button" onClick={() => abortRef.current?.abort()} className="rounded-lg border px-3 text-sm" style={{ borderColor: 'var(--line)' }}>
            Stop
          </button>
        ) : (
          <button type="submit" disabled={!input.trim()} className="rounded-lg px-3 text-sm font-semibold disabled:opacity-40" style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}>
            Send
          </button>
        )}
      </form>
      <p className="mt-1 h-4 text-[11px]" style={{ color: 'var(--muted)' }}>
        {flash ?? 'AI answers can be wrong — check against the dictionaries. Saved items stay in this browser.'}
      </p>
    </div>
  )
}

// Standalone modal host (used to reopen saved chats).
export function AiChatModal({ chat, onClose }: { chat: SavedChat; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 md:p-6"
      style={{ background: 'rgba(0,0,0,0.45)' }}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="w-full max-w-5xl rounded-xl p-4 shadow-2xl md:p-5"
        style={{ background: 'var(--panel)', border: '1px solid var(--line)', color: 'var(--ink)' }}
      >
        <AiChat info={chat} initial={chat} onClose={onClose} />
      </div>
    </div>
  )
}
