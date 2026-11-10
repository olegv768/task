import { useMemo, useState } from 'react'
import { listRuns } from '../data/api'
import { useAsync, useNow } from '../hooks'
import { compareNumbers, formatAgo, formatCount, formatUsd, formatValue } from '../lib/format'
import { freshness } from '../lib/latest'
import type { RunListItem, RunStatus } from '../lib/types'

type SortKey = 'name' | 'status' | 'points' | 'last' | 'min' | 'cost' | 'logged'

interface ListState {
  q: string
  status: RunStatus | 'all'
  onlyIssues: boolean
  sort: SortKey
  dir: 1 | -1
}

// kept outside the component so the filter survives a trip to a run page and back
let saved: ListState = { q: '', status: 'all', onlyIssues: false, sort: 'logged', dir: -1 }

const COLUMNS: { key: SortKey; label: string; num?: boolean; hide?: boolean }[] = [
  { key: 'name', label: 'Run' },
  { key: 'status', label: 'Status' },
  { key: 'last', label: 'Loss now', num: true },
  { key: 'min', label: 'Min loss', num: true, hide: true },
  { key: 'points', label: 'Points', num: true, hide: true },
  { key: 'cost', label: 'Cost', num: true },
  { key: 'logged', label: 'Last logged', num: true, hide: true },
]

function sortValue(r: RunListItem, key: SortKey): number | null {
  switch (key) {
    case 'points':
      return r.summary ? r.summary.points : null
    case 'last':
      return r.summary && r.summary.points ? r.summary.loss.last : null
    case 'min':
      return r.summary ? r.summary.loss.min : null
    case 'cost':
      return r.meta.costUsd
    case 'logged':
      return r.meta.lastLoggedAt
    default:
      return null
  }
}

export function RunList() {
  const [state, reload] = useAsync('list', listRuns)
  const [s, setS] = useState<ListState>(saved)
  const now = useNow(15_000)
  const update = (patch: Partial<ListState>) => {
    saved = { ...s, ...patch }
    setS(saved)
  }

  const rows = useMemo(() => {
    if (state.status !== 'ready') return []
    const q = s.q.trim().toLowerCase()
    const out = state.data.filter(
      r =>
        (s.status === 'all' || r.meta.status === s.status) &&
        (!s.onlyIssues || r.issues.length > 0 || !r.summary) &&
        (!q || r.meta.name.toLowerCase().includes(q) || r.meta.id.includes(q)),
    )
    out.sort((a, b) => {
      if (s.sort === 'name') return a.meta.name.localeCompare(b.meta.name, 'en') * s.dir
      if (s.sort === 'status') return a.meta.status.localeCompare(b.meta.status, 'en') * s.dir
      return compareNumbers(sortValue(a, s.sort), sortValue(b, s.sort), s.dir) || a.meta.id.localeCompare(b.meta.id)
    })
    return out
  }, [state, s])

  return (
    <section aria-labelledby="runs-h">
      <div className="page-head">
        <h1 id="runs-h">Training runs</h1>
        {state.status === 'ready' && (
          <p className="muted" role="status">
            {rows.length} of {state.data.length} shown
          </p>
        )}
      </div>

      <form className="filters" onSubmit={e => e.preventDefault()}>
        <label>
          <span>Search</span>
          <input
            type="search"
            value={s.q}
            placeholder="name or id"
            onChange={e => update({ q: e.target.value })}
          />
        </label>
        <label>
          <span>Status</span>
          <select value={s.status} onChange={e => update({ status: e.target.value as ListState['status'] })}>
            <option value="all">all</option>
            <option value="running">running</option>
            <option value="finished">finished</option>
            <option value="stopped">stopped</option>
            <option value="failed">failed</option>
          </select>
        </label>
        <label className="check">
          <input type="checkbox" checked={s.onlyIssues} onChange={e => update({ onlyIssues: e.target.checked })} />
          <span>Only runs with data problems</span>
        </label>
      </form>

      {state.status === 'loading' && (
        <div className="state" role="status" aria-live="polite">
          <div className="skeleton-rows" aria-hidden="true">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} />
            ))}
          </div>
          <span className="sr">Loading runs…</span>
        </div>
      )}

      {state.status === 'error' && (
        <div className="state state-error" role="alert">
          <h2>The run list did not load</h2>
          <p>{state.error}</p>
          <button onClick={reload}>Try again</button>
        </div>
      )}

      {state.status === 'ready' && rows.length === 0 && (
        <div className="state">
          <h2>No runs match</h2>
          <p>Nothing fits the current search and filters.</p>
          <button onClick={() => update({ q: '', status: 'all', onlyIssues: false })}>Clear filters</button>
        </div>
      )}

      {state.status === 'ready' && rows.length > 0 && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {COLUMNS.map(c => (
                  <th
                    key={c.key}
                    scope="col"
                    className={(c.num ? 'num ' : '') + (c.hide ? 'hide-sm' : '')}
                    aria-sort={s.sort === c.key ? (s.dir === 1 ? 'ascending' : 'descending') : 'none'}
                  >
                    <button
                      className="sort"
                      onClick={() => update(s.sort === c.key ? { dir: s.dir === 1 ? -1 : 1 } : { sort: c.key, dir: 1 })}
                    >
                      {c.label}
                      <span aria-hidden="true">{s.sort === c.key ? (s.dir === 1 ? ' ↑' : ' ↓') : ''}</span>
                    </button>
                  </th>
                ))}
                <th scope="col">Data problems</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const sum = r.summary
                const f = freshness(now, now, r.meta.lastLoggedAt, r.meta.status)
                const lastBad = sum && sum.points > 0 && !Number.isFinite(sum.loss.last)
                return (
                  <tr key={r.meta.id}>
                    <th scope="row">
                      <a href={`#/run/${r.meta.id}`}>{r.meta.name}</a>
                      <span className="id">{r.meta.id}</span>
                    </th>
                    <td>
                      <span className={`status status-${r.meta.status}`}>{r.meta.status}</span>
                    </td>
                    <td className={'num' + (lastBad ? ' bad-text' : '')}>
                      {sum && sum.points > 0 ? formatValue(sum.loss.last) : '–'}
                    </td>
                    <td className="num hide-sm">{sum && sum.points > 0 ? formatValue(sum.loss.min) : '–'}</td>
                    <td className="num hide-sm">{sum ? formatCount(sum.points) : '–'}</td>
                    <td className="num">{formatUsd(r.meta.costUsd)}</td>
                    <td className="num hide-sm">
                      {/* a run with no rows has never logged: an age here would be made up */}
                      {sum && sum.points === 0 ? 'never' : formatAgo(now - r.meta.lastLoggedAt)}
                      {f.silent && <span className="tag tag-bad">silent</span>}
                    </td>
                    <td>
                      {!sum && <span className="tag tag-bad">metrics unreadable</span>}
                      {sum && sum.points === 0 && <span className="tag">no data yet</span>}
                      {r.issues.map(i => (
                        <span key={i.tag} className={`tag ${i.level === 'bad' ? 'tag-bad' : 'tag-warn'}`} title={i.text}>
                          {i.tag}
                        </span>
                      ))}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
