import { Component, type ErrorInfo, type ReactNode } from 'react'

// Catches render-time errors in any screen so one bad component doesn't blank the whole
// app (production has no menu/devtools). Shows a recoverable panel + a way to open logs.

interface Props {
  /** remounts the boundary's children when this key changes (e.g. screen navigation) */
  resetKey?: string | number
  children: ReactNode
}

interface State {
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidUpdate(prev: Props): void {
    // Navigating to another screen clears a prior screen's error.
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null })
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // eslint-disable-next-line no-console
    console.error('Screen crashed:', error, info.componentStack)
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div style={{ padding: 32, maxWidth: 640, margin: '0 auto' }}>
        <div style={{ border: '1px solid #5a2530', background: 'rgba(255,90,110,.08)', borderRadius: 14, padding: 22 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 600, fontSize: 18, color: '#ff8a96', marginBottom: 8 }}>This screen hit an error</div>
          <div style={{ fontSize: 12.5, color: '#cdd2da', lineHeight: 1.5, marginBottom: 14 }}>The rest of the app is still running. Try reloading, or switch to another screen.</div>
          <div title={error.message} style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#8a909c', background: '#0e1116', border: '1px solid #1d2129', borderRadius: 8, padding: '8px 10px', marginBottom: 14, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 120, overflow: 'auto' }}>{error.message}</div>
          <div style={{ display: 'flex', gap: 9 }}>
            <button type="button" onClick={() => this.setState({ error: null })} style={{ border: '1px solid var(--accent)', background: 'var(--accent-soft)', color: 'var(--accent)', borderRadius: 9, padding: '8px 15px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Try again</button>
            <button type="button" onClick={() => window.location.reload()} style={{ border: '1px solid #262b34', background: '#15181f', color: '#c4cad3', borderRadius: 9, padding: '8px 15px', fontSize: 12, cursor: 'pointer' }}>Reload app</button>
            <button type="button" onClick={() => void window.api?.openLogs?.()} style={{ border: '1px solid #262b34', background: '#15181f', color: '#c4cad3', borderRadius: 9, padding: '8px 15px', fontSize: 12, cursor: 'pointer' }}>Open logs</button>
          </div>
        </div>
      </div>
    )
  }
}
