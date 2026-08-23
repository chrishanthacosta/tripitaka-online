import { Route, Routes } from 'react-router-dom'
import ErrorBoundary from './components/ErrorBoundary'
import Header from './components/Header'
import Home from './pages/Home'
import Book from './pages/Book'
import Sutta from './pages/Sutta'
import Search from './pages/Search'

export default function App() {
  return (
    <ErrorBoundary>
      <div className="flex min-h-screen flex-col">
        <Header />
        <main className="flex-1">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/book/:book" element={<Book />} />
            <Route path="/sutta/:sourceId" element={<Sutta />} />
            <Route path="/search" element={<Search />} />
            <Route path="*" element={<Home />} />
          </Routes>
        </main>
        <footer
          className="border-t py-4 text-center text-xs"
          style={{ borderColor: 'var(--line)', color: 'var(--muted)' }}
        >
          Local mirror of tripitaka.online · Pali &amp; Sinhala Tipiṭaka ·
          © 1999–2026 Mahamevnawa Buddhist Monastery
        </footer>
      </div>
    </ErrorBoundary>
  )
}
