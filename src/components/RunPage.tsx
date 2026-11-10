import { useCallback, useState } from 'react'
import { fetchRun } from '../data/api'
import { useAsync, useNow } from '../hooks'
import { formatAgo, formatCount, formatStep, formatUsd, formatUtc, formatValue } from '../lib/format'
import { buildIssues } from '../lib/issues'
import { freshness } from '../lib/latest'
import { normalize, summarize } from '../lib/series'
import type { Issue, NormalizedRun, NormalizeReport, RunMeta, Summary } from '../lib/types'
import { Chart } from './Chart'
import { toNaivePoints, type NaivePoint } from './naive'

const NAIVE = new URLSearchParams(location.search).has('naive')

interface Loaded {
  meta: RunMeta
  summary: Summary
  report: NormalizeReport
  issues: Issue[]
  run: NormalizedRun | null
  naive: NaivePoint[] | null
  fetchedAt: number
}

async function loadRun(id: string, signal: AbortSignal): Promise<Loaded> {
  const { meta, raw } = await fetchRun(id, signal)
  const run = normalize(raw)
  const summary = summarize(run)
  return {
    meta,
    summary,
    report: run.report,
    issues: buildIssues(summary, run.report),
    run: NAIVE ? null : run,
    naive: NAIVE ? toNaivePoints(run) : null,
    fetchedAt: Date.now(),
  }
}

export function RunPage({ id }: { id: string }) {
  const [state, reload] = useAsync(`run:${id}`, signal => loadRun(id, signal))

  return (
    <article>
      <p className="crumb">
        <a href="#/">← All runs</a>
      </p>

      {state.status === 'loading' && (
        <div className="state" role="status" aria-live="polite">
          <h1 className="mono">{id}</h1>
          <div className="skeleton-cards" aria-hidden="true">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} />
            ))}
          </div>
          <div className="skeleton-chart" aria-hidden="true" />
          <span className="sr">Loading {id}…</span>
        </div>
      )}

      {state.status === 'error' && (
        <div className="state state-error" role="alert">
          <h1 className="mono">{id}</h1>
          <h2>This run could not be loaded</h2>
          <p>{state.error}</p>
          <p className="muted">Nothing is shown rather than showing an older copy.</p>
          <button onClick={reload}>Try again</button>
        </div>
      )}

      {state.status === 'ready' && <RunView key={id + state.data.fetchedAt} data={state.data} reload={reload} />}
    </article>
  )
}

function Card({ label, value, sub, bad }: { label: string; value: string; sub?: string; bad?: boolean }) {
  return (
    <div className={'card' + (bad ? ' card-bad' : '')}>
      <dt>{label}</dt>
      <dd>
        <span className="card-value">{value}</span>
        {sub && <span className="card-sub">{sub}</span>}
      </dd>
    </div>
  )
}

function RunView({ data, reload }: { data: Loaded; reload: () => void }) {
  const { meta, summary: s, report, issues, run, naive } = data
  const now = useNow(5_000)
  const fresh = freshness(now, data.fetchedAt, meta.lastLoggedAt, meta.status)

  const hasData = s.points > 0
  const full: [number, number] =
    s.firstStep === s.lastStep ? [s.firstStep - 1, s.lastStep + 1] : [s.firstStep, s.lastStep]
  const [domain, setDomain] = useState<[number, number] | null>(null)
  const [cursor, setCursor] = useState<number | null>(null)
  const [smooth, setSmooth] = useState(0)
  const onDomain = useCallback((d: [number, number] | null) => setDomain(d), [])
  const view = domain ?? full

  const l = s.loss
  const nonFinite = l.nan + l.posInf + l.negInf
  const lossNowBad = hasData && !Number.isFinite(l.last)

  const charts = [
    { metric: 'loss' as const, title: 'loss', color: '#0b5cad' },
    { metric: 'lr' as const, title: 'learning rate', color: '#7a4b00' },
    { metric: 'grad_norm' as const, title: 'grad_norm', color: '#5b2a86' },
  ]

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{meta.name}</h1>
          <p className="muted">
            <span className="mono">{meta.id}</span> · <span className={`status status-${meta.status}`}>{meta.status}</span>{' '}
            · spent {formatUsd(meta.costUsd)} · started {formatUtc(meta.startedAt)}
          </p>
          <p className="muted">{meta.note}</p>
        </div>
        <div className="fresh">
          <p>
            Data fetched {formatAgo(fresh.fetchedAgoMs)}
            <br />
            <span className="muted">{formatUtc(data.fetchedAt)}</span>
          </p>
          <button onClick={reload}>Refresh</button>
        </div>
      </div>

      {(fresh.stale || fresh.silent || issues.length > 0) && (
        <ul className="issues" aria-label="Data problems in this run">
          {fresh.silent && (
            <li className="issue issue-bad">
              <strong>No new steps.</strong> Status is “running” but the last step was logged{' '}
              {formatAgo(now - meta.lastLoggedAt)} ({formatUtc(meta.lastLoggedAt)}). The charts may show a job that is
              no longer training.
            </li>
          )}
          {fresh.stale && (
            <li className="issue issue-warn">
              <strong>This copy may be out of date.</strong> The run is still going and this page was loaded{' '}
              {formatAgo(fresh.fetchedAgoMs)}. Refresh before deciding anything.
            </li>
          )}
          {issues.map(i => (
            <li key={i.tag} className={`issue ${i.level === 'bad' ? 'issue-bad' : 'issue-warn'}`}>
              {i.text}
            </li>
          ))}
        </ul>
      )}

      {!hasData && (
        <div className="state">
          <h2>No steps logged yet</h2>
          <p>
            This run has not written a single row. If it has been “running” for a while, the logger may not be attached.
          </p>
          <button onClick={reload}>Check again</button>
        </div>
      )}

      {hasData && (
        <>
          <dl className="cards">
            <Card
              label="Loss now"
              value={formatValue(l.last)}
              sub={
                lossNowBad
                  ? Number.isFinite(l.lastFinite)
                    ? `last finite ${formatValue(l.lastFinite)} @ ${formatStep(l.lastFiniteStep)}`
                    : 'never finite'
                  : `step ${formatStep(s.lastStep)}`
              }
              bad={lossNowBad}
            />
            <Card label="Min loss" value={formatValue(l.min)} sub={`step ${formatStep(l.minStep)}`} />
            <Card label="Max loss" value={formatValue(l.max)} sub={`step ${formatStep(l.maxStep)}`} />
            <Card
              label="Non-finite loss"
              value={formatCount(nonFinite)}
              sub={nonFinite ? `first @ ${formatStep(l.firstNonFiniteStep)}` : 'none'}
              bad={nonFinite > 0}
            />
            <Card
              label="Points"
              value={formatCount(s.points)}
              sub={`steps ${formatStep(s.firstStep)}–${formatStep(s.lastStep)}`}
            />
            <Card
              label="Rows fixed up"
              value={formatCount(report.duplicates + report.outOfOrder)}
              sub={`${formatCount(report.duplicates)} dup · ${formatCount(report.outOfOrder)} unsorted · ${formatCount(
                report.gaps.length,
              )} gaps`}
            />
            <Card label="Max grad_norm" value={formatValue(s.grad_norm.max)} sub={`step ${formatStep(s.grad_norm.maxStep)}`} />
            <Card label="Learning rate now" value={formatValue(s.lr.last)} sub={`peak ${formatValue(s.lr.max)}`} />
          </dl>

          <div className="toolbar">
            <label className="range">
              <span>Smoothing {smooth === 0 ? 'off' : smooth.toFixed(2)}</span>
              <input
                type="range"
                min={0}
                max={0.99}
                step={0.01}
                value={smooth}
                disabled={!!naive}
                onChange={e => setSmooth(Number(e.target.value))}
              />
            </label>
            <p className="muted zoom-info">
              Showing steps {formatStep(view[0])}–{formatStep(view[1])}
              {domain ? ' (zoomed)' : ' (everything)'}
            </p>
            <button onClick={() => setDomain(null)} disabled={!domain}>
              Reset zoom
            </button>
          </div>
          <p className="muted hint">
            Drag across a chart to zoom, double-click to reset, Ctrl + wheel to zoom at the pointer. With a chart
            focused: ← → move the cursor, + − zoom, PgUp PgDn pan, 0 resets.
            {smooth > 0 && ' The coloured line is the raw data, the black line is the smoothed one; the y axis always follows raw.'}
          </p>

          {charts.map(c => (
            <Chart
              key={c.metric}
              metric={c.metric}
              title={c.title}
              color={c.color}
              steps={run ? run.steps : null}
              values={run ? run[c.metric] : null}
              naive={naive}
              smooth={smooth}
              gapThreshold={report.gapThreshold}
              gaps={report.gaps}
              domain={view}
              full={full}
              onDomain={onDomain}
              cursor={cursor}
              onCursor={setCursor}
            />
          ))}

          <p className="muted legend">
            <span className="key key-bad" /> NaN / Inf at that position (never drawn as a value)
            <span className="key key-clip" /> value ≤ 0 on a log axis
            <span className="key key-gap" /> steps that were never logged
          </p>
        </>
      )}
    </>
  )
}
