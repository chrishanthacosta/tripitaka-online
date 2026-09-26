import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'

function useDarkMode() {
  const [dark, setDark] = useState<boolean>(() => {
    const saved = localStorage.getItem('tripitaka-dark')
    if (saved !== null) return saved === '1'
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  })
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    localStorage.setItem('tripitaka-dark', dark ? '1' : '0')
  }, [dark])
  return { dark, toggle: () => setDark((d) => !d) }
}

export default function Header() {
  const [q, setQ] = useState('')
  const navigate = useNavigate()
  const { dark, toggle } = useDarkMode()

  function submit(e: FormEvent) {
    e.preventDefault()
    const term = q.trim()
    if (term) navigate(`/search?q=${encodeURIComponent(term)}`)
  }

  return (
    <header className="sticky top-0 z-20 border-b backdrop-blur" style={{ background: 'var(--bg)', borderColor: 'var(--line)' }}>
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
        <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span
            className="flex h-8 w-8 items-center justify-center rounded-lg text-sm font-bold"
            style={{ background: 'var(--brand)', color: 'var(--brand-ink)' }}
          >
            ත්
          </span>
          <span className="hidden sm:inline">Tripitaka&nbsp;Local</span>
        </Link>

        <form onSubmit={submit} className="ml-auto flex min-w-0 flex-1 max-w-md items-center gap-2">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search Pali / Sinhala… (e.g. සුතං, බුද්ධ)"
            className="w-full rounded-lg border px-3 py-1.5 text-sm outline-none focus:ring-2"
            style={{ background: 'var(--panel)', borderColor: 'var(--line)' }}
            aria-label="Search"
          />
        </form>

        <Link
          to="/saved"
          className="rounded-lg border px-2.5 py-1.5 text-sm"
          style={{ borderColor: 'var(--line)' }}
          title="Saved AI chats and messages"
          aria-label="Saved AI chats and messages"
        >
          🔖
        </Link>

        <button
          onClick={toggle}
          className="rounded-lg border px-2.5 py-1.5 text-sm"
          style={{ borderColor: 'var(--line)' }}
          title="Toggle dark mode"
          aria-label="Toggle dark mode"
        >
          {dark ? '☀️' : '🌙'}
        </button>
      </div>
    </header>
  )
}
