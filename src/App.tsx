import { useHashRoute } from './hooks'
import { RunList } from './components/RunList'
import { RunPage } from './components/RunPage'

export function App() {
  const route = useHashRoute()
  const m = route.match(/^\/run\/([^/?]+)/)

  return (
    <div className="app">
      {/* a button, not href="#main": the hash is used for routing */}
      <button className="skip" onClick={() => document.getElementById('main')?.focus()}>
        Skip to content
      </button>
      <header className="top">
        <a href="#/" className="brand">
          Run monitor
        </a>
        <span className="top-note">synthetic data · 20 runs</span>
      </header>
      <main id="main" tabIndex={-1}>
        {m ? <RunPage id={decodeURIComponent(m[1])} /> : <RunList />}
      </main>
    </div>
  )
}
