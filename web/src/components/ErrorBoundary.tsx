import { Component, type ReactNode } from 'react'

interface State {
  error: Error | null
}

// Catches render errors anywhere in the app so a crash shows a message
// instead of a blank page.
export default class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="mx-auto max-w-2xl px-4 py-16 text-center">
          <h1 className="text-xl font-bold">Something went wrong</h1>
          <pre className="mt-4 overflow-auto rounded-lg p-4 text-left text-xs" style={{ background: 'var(--panel)', border: '1px solid var(--line)' }}>
            {String(this.state.error)}
          </pre>
          <button
            className="mt-4 rounded-lg border px-4 py-2 text-sm"
            style={{ borderColor: 'var(--line)' }}
            onClick={() => window.location.reload()}
          >
            Reload
          </button>
        </div>
      )
    }
    return this.props.children
  }
}
