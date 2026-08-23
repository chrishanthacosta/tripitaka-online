// Case-insensitive highlighting of `query` inside `text`.
export default function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim()
  if (!q) return <>{text}</>
  const lower = text.toLowerCase()
  const needle = q.toLowerCase()
  const parts: { hit: boolean; s: string }[] = []
  let i = 0
  while (i < text.length) {
    const idx = lower.indexOf(needle, i)
    if (idx === -1) {
      parts.push({ hit: false, s: text.slice(i) })
      break
    }
    if (idx > i) parts.push({ hit: false, s: text.slice(i, idx) })
    parts.push({ hit: true, s: text.slice(idx, idx + q.length) })
    i = idx + q.length
  }
  return (
    <>
      {parts.map((p, k) =>
        p.hit ? <mark key={k}>{p.s}</mark> : <span key={k}>{p.s}</span>
      )}
    </>
  )
}
