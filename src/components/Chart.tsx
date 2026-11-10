import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { describeBucket, type BucketInfo } from '../lib/downsample'
import { formatCount, formatStep, formatValue } from '../lib/format'
import { buildModel, panDomain, zoomDomain } from '../lib/model'
import { ema } from '../lib/series'
import type { Gap, Metric } from '../lib/types'
import { paintNaive, type NaivePoint } from './naive'
import { CHART_H, MARGIN, paint, PLOT_H } from './paint'

interface Props {
  metric: Metric
  title: string
  color: string
  steps: Float64Array | null
  values: Float64Array | null
  naive: NaivePoint[] | null
  smooth: number
  gapThreshold: number
  gaps: Gap[]
  domain: [number, number]
  full: [number, number]
  onDomain: (d: [number, number] | null) => void
  cursor: number | null
  onCursor: (step: number | null) => void
}

function readout(info: BucketInfo, log: boolean): string {
  if (info.kind === 'empty') return 'no logged step under the cursor'
  const where =
    info.rows === 1
      ? `step ${formatStep(info.stepFrom)}`
      : `steps ${formatStep(info.stepFrom)}–${formatStep(info.stepTo)} (${formatCount(info.rows)} points in this pixel)`
  const parts: string[] = []
  if (info.finite === 1) parts.push(formatValue(info.min))
  else if (info.finite > 1) parts.push(`min ${formatValue(info.min)}, max ${formatValue(info.max)}`)
  if (info.nan) parts.push(`${formatCount(info.nan)} × NaN`)
  if (info.posInf) parts.push(`${formatCount(info.posInf)} × +Inf`)
  if (info.negInf) parts.push(`${formatCount(info.negInf)} × -Inf`)
  if (log && info.clipped) parts.push(`${formatCount(info.clipped)} value(s) ≤ 0 not drawable on log axis`)
  return `${where}: ${parts.join(' · ')}`
}

export function Chart(p: Props) {
  const wrap = useRef<HTMLDivElement>(null)
  const base = useRef<HTMLCanvasElement>(null)
  const over = useRef<HTMLCanvasElement>(null)
  const [width, setWidth] = useState(0)
  const [log, setLog] = useState(false)
  const [brush, setBrush] = useState<{ a: number; b: number } | null>(null)
  const [naiveText, setNaiveText] = useState('')
  const hintId = useId()

  useLayoutEffect(() => {
    const el = wrap.current!
    const ro = new ResizeObserver(() => setWidth(Math.floor(el.clientWidth)))
    ro.observe(el)
    setWidth(Math.floor(el.clientWidth))
    return () => ro.disconnect()
  }, [])

  const plotW = Math.max(0, width - MARGIN.l - MARGIN.r)
  const [x0, x1] = p.domain
  const span = x1 - x0 || 1

  const smoothed = useMemo(
    () => (p.values && p.smooth > 0 ? ema(p.values, p.smooth) : null),
    [p.values, p.smooth],
  )

  const model = useMemo(() => {
    if (!p.steps || !p.values || plotW < 10) return null
    return buildModel({
      steps: p.steps,
      values: p.values,
      smoothed,
      x0,
      x1,
      plotW,
      plotH: PLOT_H,
      log,
      gapThreshold: p.gapThreshold,
    })
  }, [p.steps, p.values, smoothed, x0, x1, plotW, log, p.gapThreshold])

  const cursorCol =
    p.cursor !== null && plotW > 0 && p.cursor >= x0 && p.cursor <= x1
      ? Math.min(plotW - 1, Math.floor(((p.cursor - x0) / span) * plotW))
      : null

  const sizeCanvas = (c: HTMLCanvasElement) => {
    const dpr = window.devicePixelRatio || 1
    if (c.width !== Math.round(width * dpr) || c.height !== Math.round(CHART_H * dpr)) {
      c.width = Math.round(width * dpr)
      c.height = Math.round(CHART_H * dpr)
    }
    const ctx = c.getContext('2d')!
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    return ctx
  }

  // the series itself: redrawn only when data, zoom, size or scale change
  useEffect(() => {
    if (!model || !base.current) return
    paint(sizeCanvas(base.current), model, width, p.color, p.gaps)
    performance.mark(`chart-drawn:${p.metric}`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model, width, p.color, p.gaps, p.metric])

  // comparison baseline: redraws everything, including on every cursor move
  useEffect(() => {
    if (!p.naive || !base.current || plotW < 10) return
    setNaiveText(paintNaive(sizeCanvas(base.current), p.naive, p.metric, x0, x1, width, p.color, p.cursor))
    performance.mark(`chart-drawn:${p.metric}`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.naive, p.metric, x0, x1, width, p.color, p.cursor])

  // crosshair and selection live on their own canvas: moving the mouse never
  // touches the series
  useEffect(() => {
    if (!over.current || width === 0) return
    const ctx = sizeCanvas(over.current)
    ctx.clearRect(0, 0, width, CHART_H)
    if (brush) {
      const a = Math.min(brush.a, brush.b)
      const b = Math.max(brush.a, brush.b)
      ctx.fillStyle = 'rgba(28,28,26,0.12)'
      ctx.fillRect(MARGIN.l + a, MARGIN.t, b - a, PLOT_H)
    }
    if (cursorCol !== null && !p.naive) {
      ctx.strokeStyle = '#1c1c1a'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(MARGIN.l + cursorCol + 0.5, MARGIN.t)
      ctx.lineTo(MARGIN.l + cursorCol + 0.5, MARGIN.t + PLOT_H)
      ctx.stroke()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursorCol, brush, width, p.naive])

  const colAt = (clientX: number) => {
    const r = over.current!.getBoundingClientRect()
    return Math.min(plotW - 1, Math.max(0, Math.floor(clientX - r.left - MARGIN.l)))
  }
  const stepAt = (col: number) => x0 + ((col + 0.5) / plotW) * span

  // wheel needs a non-passive listener to be able to stop the page zoom
  const live = useRef({ p, colAt, stepAt })
  live.current = { p, colAt, stepAt }
  useEffect(() => {
    const el = over.current!
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const { p, colAt, stepAt } = live.current
      p.onDomain(zoomDomain(p.domain, p.full, stepAt(colAt(e.clientX)), e.deltaY < 0 ? 0.5 : 2))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const onKey = (e: React.KeyboardEvent) => {
    if (plotW <= 0) return
    const col = cursorCol ?? Math.floor(plotW / 2)
    const center = stepAt(col)
    let handled = true
    if (e.key === 'ArrowLeft') p.onCursor(stepAt(Math.max(0, col - (e.shiftKey ? 10 : 1))))
    else if (e.key === 'ArrowRight') p.onCursor(stepAt(Math.min(plotW - 1, col + (e.shiftKey ? 10 : 1))))
    else if (e.key === 'Home') p.onCursor(stepAt(0))
    else if (e.key === 'End') p.onCursor(stepAt(plotW - 1))
    else if (e.key === '+' || e.key === '=') p.onDomain(zoomDomain(p.domain, p.full, center, 0.5))
    else if (e.key === '-' || e.key === '_') p.onDomain(zoomDomain(p.domain, p.full, center, 2))
    else if (e.key === '0' || e.key === 'Escape') p.onDomain(null)
    else if (e.key === 'PageUp') p.onDomain(panDomain(p.domain, p.full, -0.5))
    else if (e.key === 'PageDown') p.onDomain(panDomain(p.domain, p.full, 0.5))
    else handled = false
    if (handled) e.preventDefault()
  }

  let text = p.naive ? naiveText : 'Move the pointer or use the arrow keys to read values.'
  if (!p.naive && model && cursorCol !== null && p.steps && p.values) {
    text = readout(describeBucket(model.buckets, cursorCol, p.steps, p.values), log)
  }
  const nothingToDraw = model?.empty

  return (
    <section className="chart" aria-label={`${p.title} chart`}>
      <div className="chart-head">
        <h3>{p.title}</h3>
        <label className="check">
          <input type="checkbox" checked={log} disabled={!!p.naive} onChange={e => setLog(e.target.checked)} />
          <span>log scale</span>
        </label>
      </div>
      <div
        ref={wrap}
        className="chart-canvas"
        tabIndex={0}
        role="group"
        aria-label={`${p.title} over steps ${formatStep(x0)} to ${formatStep(x1)}. Interactive.`}
        aria-describedby={hintId}
        onKeyDown={onKey}
        style={{ height: CHART_H }}
      >
        <canvas ref={base} style={{ width, height: CHART_H }} aria-hidden="true" />
        <canvas
          ref={over}
          className="chart-over"
          style={{ width, height: CHART_H }}
          aria-hidden="true"
          onPointerMove={e => {
            const c = colAt(e.clientX)
            p.onCursor(stepAt(c))
            if (brush) setBrush({ a: brush.a, b: c })
          }}
          onPointerLeave={() => {
            p.onCursor(null)
          }}
          onPointerDown={e => {
            if (e.button !== 0) return
            e.currentTarget.setPointerCapture(e.pointerId)
            const c = colAt(e.clientX)
            setBrush({ a: c, b: c })
          }}
          onPointerUp={() => {
            if (brush && Math.abs(brush.b - brush.a) >= 4) {
              const a = stepAt(Math.min(brush.a, brush.b))
              const b = stepAt(Math.max(brush.a, brush.b))
              p.onDomain(b - a >= 1 ? [a, b] : null)
            }
            setBrush(null)
          }}
          onPointerCancel={() => setBrush(null)}
          onDoubleClick={() => p.onDomain(null)}
        />
        {nothingToDraw && (
          <p className="chart-empty">
            No finite {log ? 'positive ' : ''}values in this range. Red marks at the top are NaN or Inf.
          </p>
        )}
      </div>
      <p className="readout" aria-live="polite">
        {text}
      </p>
      <p id={hintId} className="sr">
        Left and right arrows move the cursor one pixel column, with Shift ten. Plus and minus zoom, Page Up and Page
        Down pan, zero resets the zoom.
      </p>
    </section>
  )
}
