import { downsample, type Buckets } from './downsample'
import { formatStep, formatTick } from './format'

export interface Tick {
  v: number
  label: string
  /** pixels from the left (x) or from the top (y) of the plot area */
  pos: number
}

export interface PathOp {
  move: boolean
  x: number
  y: number
}

export interface DrawList {
  ops: PathOp[]
  /** single points with nothing to connect to: drawn as dots so they don't vanish */
  dots: { x: number; y: number }[]
  badCols: number[]
  clippedCols: number[]
}

export interface ChartModel {
  buckets: Buckets
  smoothBuckets: Buckets | null
  empty: boolean
  yLo: number
  yHi: number
  log: boolean
  yTicks: Tick[]
  xTicks: Tick[]
  raw: DrawList
  smoothed: DrawList | null
  y: (v: number) => number
}

export function niceTicks(lo: number, hi: number, target: number, integer = false): { ticks: number[]; step: number } {
  const span = hi - lo
  if (!(span > 0)) return { ticks: [lo], step: 1 }
  const rough = span / Math.max(1, target)
  const pow = Math.pow(10, Math.floor(Math.log10(rough)))
  const f = rough / pow
  let step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow
  if (integer && step < 1) step = 1
  const ticks: number[] = []
  const firstK = Math.ceil(lo / step - 1e-9)
  const lastK = Math.floor(hi / step + 1e-9)
  for (let k = firstK; k <= lastK; k++) {
    const v = k * step + 0 // + 0 turns -0 into 0, which would print as "-0"
    if (v >= lo && v <= hi) ticks.push(v)
  }
  return { ticks, step }
}

/**
 * Ticks for a log axis. Across three or more decades: powers of ten. Across
 * less: 1-2-5 steps inside each decade, so a range like 0.3 .. 4 is labelled
 * over its whole height (0.5, 1, 2) and not only in the top half. Returns []
 * when the range is too narrow for either; the caller then uses linear ticks.
 */
export function logTicks(lo: number, hi: number): { v: number; unit: number }[] {
  const e0 = Math.floor(Math.log10(lo) + 1e-9)
  const e1 = Math.ceil(Math.log10(hi) - 1e-9)
  const pick = (mult: number[]) => {
    const out: { v: number; unit: number }[] = []
    for (let e = e0; e <= e1; e++) {
      const unit = Math.pow(10, e)
      for (const k of mult) {
        const v = k * unit
        if (v >= lo && v <= hi) out.push({ v, unit })
      }
    }
    return out
  }
  const decades = pick([1])
  if (decades.length >= 3) return decades
  const fine = pick([1, 2, 5])
  return fine.length >= 2 ? fine : []
}

export function paddedDomain(yMin: number, yMax: number, log: boolean): [number, number] {
  if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) return log ? [0.1, 1] : [0, 1]
  if (log) {
    const a = Math.log10(yMin)
    const b = Math.log10(yMax)
    const pad = b > a ? (b - a) * 0.06 : 0.3
    return [Math.pow(10, a - pad), Math.pow(10, b + pad)]
  }
  const pad = yMax > yMin ? (yMax - yMin) * 0.06 : Math.abs(yMax) * 0.05 || 1
  return [yMin - pad, yMax + pad]
}

export function makeY(lo: number, hi: number, height: number, log: boolean): (v: number) => number {
  if (log) {
    const a = Math.log10(lo)
    const k = height / (Math.log10(hi) - a)
    return v => height - (Math.log10(v) - a) * k
  }
  const k = height / (hi - lo)
  return v => height - (v - lo) * k
}

export function buildDrawList(b: Buckets, y: (v: number) => number): DrawList {
  const ops: PathOp[] = []
  const dots: { x: number; y: number }[] = []
  const badCols: number[] = []
  const clippedCols: number[] = []

  let open = false
  let cols = 0
  let flat = true
  let sx = 0
  let sy = 0
  const close = () => {
    if (open && cols === 1 && flat) dots.push({ x: sx, y: sy })
    open = false
  }

  for (let c = 0; c < b.width; c++) {
    if (b.bad[c]) badCols.push(c)
    if (b.clipped[c]) clippedCols.push(c)
    if (!b.count[c]) continue
    const x = c + 0.5
    const yFirst = y(b.first[c])
    if (!open || b.breakBefore[c]) {
      close()
      ops.push({ move: true, x, y: yFirst })
      open = true
      cols = 0
      flat = true
      sx = x
      sy = yFirst
    } else {
      ops.push({ move: false, x, y: yFirst })
    }
    if (b.min[c] !== b.max[c]) {
      ops.push({ move: false, x, y: y(b.min[c]) })
      ops.push({ move: false, x, y: y(b.max[c]) })
      ops.push({ move: false, x, y: y(b.last[c]) })
      flat = false
    }
    cols++
  }
  close()
  return { ops, dots, badCols, clippedCols }
}

export interface ModelInput {
  steps: Float64Array
  values: Float64Array
  smoothed: Float64Array | null
  x0: number
  x1: number
  plotW: number
  plotH: number
  log: boolean
  gapThreshold: number
}

/**
 * Everything the chart draws, as plain numbers. The canvas code only replays
 * this, so tests can check the picture without a browser.
 */
export function buildModel(a: ModelInput): ChartModel {
  const buckets = downsample(a.steps, a.values, a.x0, a.x1, a.plotW, a.log, a.gapThreshold)
  const smoothBuckets = a.smoothed
    ? downsample(a.steps, a.smoothed, a.x0, a.x1, a.plotW, a.log, a.gapThreshold)
    : null

  // The y range always comes from the raw values, never from the smoothed ones:
  // turning smoothing on must not push a spike or a divergence off the chart.
  const empty = !Number.isFinite(buckets.yMin)
  const [yLo, yHi] = paddedDomain(buckets.yMin, buckets.yMax, a.log)
  const y = makeY(yLo, yHi, a.plotH, a.log)

  let yTicks: Tick[] = []
  if (!empty) {
    if (a.log) {
      yTicks = logTicks(yLo, yHi).map(t => ({ v: t.v, label: formatTick(t.v, t.unit), pos: y(t.v) }))
    }
    if (yTicks.length === 0) {
      const { ticks, step } = niceTicks(yLo, yHi, 5)
      yTicks = ticks.map(v => ({ v, label: formatTick(v, step), pos: y(v) }))
    }
  }

  const xSpan = a.x1 - a.x0 || 1
  const xt = niceTicks(a.x0, a.x1, Math.max(2, Math.floor(a.plotW / 110)), true)
  const xTicks = xt.ticks.map(v => ({ v, label: formatStep(v), pos: ((v - a.x0) / xSpan) * a.plotW }))

  return {
    buckets,
    smoothBuckets,
    empty,
    yLo,
    yHi,
    log: a.log,
    yTicks,
    xTicks,
    raw: buildDrawList(buckets, y),
    smoothed: smoothBuckets ? buildDrawList(smoothBuckets, y) : null,
    y,
  }
}

/** Zoom around `center` by `factor` (<1 zooms in). Returns null for "show everything". */
export function zoomDomain(
  domain: [number, number],
  full: [number, number],
  center: number,
  factor: number,
  minSpan = 4,
): [number, number] | null {
  const span = domain[1] - domain[0]
  const fullSpan = full[1] - full[0]
  const next = Math.max(Math.min(minSpan, fullSpan), span * factor)
  if (next >= fullSpan) return null
  const t = span > 0 ? (center - domain[0]) / span : 0.5
  let a = center - t * next
  if (a < full[0]) a = full[0]
  if (a + next > full[1]) a = full[1] - next
  return [a, a + next]
}

export function panDomain(domain: [number, number], full: [number, number], fraction: number): [number, number] {
  const span = domain[1] - domain[0]
  let a = domain[0] + span * fraction
  if (a < full[0]) a = full[0]
  if (a + span > full[1]) a = full[1] - span
  return [a, a + span]
}
