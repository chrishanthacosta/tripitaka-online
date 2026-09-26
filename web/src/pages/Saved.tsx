// Saved AI chats and saved AI messages (stored in this browser).
import { lazy, Suspense, useEffect, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  chatToMarkdown,
  deleteChat,
  deleteSnippet,
  downloadText,
  listChats,
  listSnippets,
  snippetsToMarkdown,
  type SavedChat,
} from '../aiStore'

const AiChatModal = lazy(() => import('../components/AiChat').then((m) => ({ default: m.AiChatModal })))

export default function Saved() {
  const [chats, setChats] = useState(listChats)
  const [snippets, setSnippets] = useState(listSnippets)
  const [open, setOpen] = useState<SavedChat | null>(null)
  const [tab, setTab] = useState<'chats' | 'messages'>('chats')

  useEffect(() => {
    const refresh = () => {
      setChats(listChats())
      setSnippets(listSnippets())
    }
    window.addEventListener('tripitaka-ai-saved', refresh)
    window.addEventListener('storage', refresh)
    return () => {
      window.removeEventListener('tripitaka-ai-saved', refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [])

  const btn = 'rounded border px-2 py-0.5 text-xs hover:opacity-60'
  const tabBtn = (t: typeof tab, label: string) => (
    <button
      onClick={() => setTab(t)}
      className="rounded-lg px-3 py-1 text-sm"
      style={tab === t ? { background: 'var(--brand)', color: 'var(--brand-ink)' } : { border: '1px solid var(--line)' }}
    >
      {label}
    </button>
  )

  return (
    <div className="mx-auto max-w-4xl px-4 py-6">
      <h1 className="mb-1 text-2xl font-semibold">Saved AI notes</h1>
      <p className="mb-4 text-sm" style={{ color: 'var(--muted)' }}>
        Pāli grammar chats and messages you saved. They are stored in this browser only — download them
        to keep a copy.
      </p>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {tabBtn('chats', `Chats (${chats.length})`)}
        {tabBtn('messages', `Messages (${snippets.length})`)}
        {tab === 'messages' && snippets.length > 0 && (
          <button
            onClick={() => downloadText('pali-ai-notes.md', snippetsToMarkdown(snippets))}
            className={`${btn} ml-auto`}
            style={{ borderColor: 'var(--line)' }}
          >
            ⬇ Download all (.md)
          </button>
        )}
      </div>

      {tab === 'chats' &&
        (chats.length === 0 ? (
          <Empty />
        ) : (
          <ul className="space-y-2">
            {chats.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-2 rounded-lg border p-3" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
                <button onClick={() => setOpen(c)} className="mr-auto min-w-0 text-left hover:opacity-70">
                  <span className="font-tipitaka font-semibold">{c.word}</span>
                  {c.roman && <span className="ml-2 font-mono text-xs" style={{ color: 'var(--muted)' }}>{c.roman}</span>}
                  <span className="block truncate text-xs" style={{ color: 'var(--muted)' }}>
                    {c.messages.length} messages · {new Date(c.updated).toLocaleString()} ·{' '}
                    {c.messages.find((m) => m.role === 'user')?.content}
                  </span>
                </button>
                <button onClick={() => setOpen(c)} className={btn} style={{ borderColor: 'var(--line)' }}>
                  Open
                </button>
                <button onClick={() => downloadText(`pali-ai-${c.roman || 'chat'}.md`, chatToMarkdown(c))} className={btn} style={{ borderColor: 'var(--line)' }}>
                  ⬇ .md
                </button>
                <button
                  onClick={() => confirm('Delete this saved chat?') && deleteChat(c.id)}
                  className={btn}
                  style={{ borderColor: 'var(--line)', color: '#b91c1c' }}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        ))}

      {tab === 'messages' &&
        (snippets.length === 0 ? (
          <Empty />
        ) : (
          <ul className="space-y-3">
            {snippets.map((s) => (
              <li key={s.id} className="rounded-lg border p-3" style={{ borderColor: 'var(--line)', background: 'var(--panel)' }}>
                <div className="mb-1 flex flex-wrap items-center gap-2 text-xs" style={{ color: 'var(--muted)' }}>
                  <span className="font-tipitaka text-sm font-semibold" style={{ color: 'var(--ink)' }}>{s.word}</span>
                  {s.roman && <span className="font-mono">{s.roman}</span>}
                  <span>· {s.role === 'user' ? 'question' : 'answer'} · {new Date(s.saved).toLocaleString()}</span>
                  <button
                    onClick={() => navigator.clipboard?.writeText(s.content)}
                    className={`${btn} ml-auto`}
                    style={{ borderColor: 'var(--line)' }}
                  >
                    Copy
                  </button>
                  <button
                    onClick={() => confirm('Delete this saved message?') && deleteSnippet(s.id)}
                    className={btn}
                    style={{ borderColor: 'var(--line)', color: '#b91c1c' }}
                  >
                    Delete
                  </button>
                </div>
                {s.question && (
                  <p className="mb-1 border-l-2 pl-2 text-xs italic" style={{ borderColor: 'var(--brand)', color: 'var(--muted)' }}>
                    {s.question}
                  </p>
                )}
                <div className="ai-md font-tipitaka text-sm">
                  <Markdown remarkPlugins={[remarkGfm]}>{s.content}</Markdown>
                </div>
              </li>
            ))}
          </ul>
        ))}

      {open && (
        <Suspense fallback={null}>
          <AiChatModal key={open.id} chat={open} onClose={() => setOpen(null)} />
        </Suspense>
      )}
    </div>
  )
}

function Empty() {
  return (
    <p className="text-sm" style={{ color: 'var(--muted)' }}>
      Nothing saved yet. Click a Pāli word in a sutta, press <b>✦ AI</b>, and use <b>🔖 Save</b>.
    </p>
  )
}
