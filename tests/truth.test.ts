import { beforeAll, describe, expect, it } from 'vitest'
import { generate, mulberry32, SPECS, SPIKE_VALUE } from '../src/data/generate'
import { describeBucket, downsample } from '../src/lib/downsample'
import { formatStep, formatTick, formatValue } from '../src/lib/format'
import { buildModel, niceTicks } from '../src/lib/model'
import { ema, normalize, summarize } from '../src/lib/series'
import type { NormalizedRun, RawRun } from '../src/lib/types'

const spec = (id: string) => SPECS.find(s => s.id === id)!
const load = (id: string) => normalize(generate(spec(id)))
const f64 = (a: number[]) => Float64Array.from(a)

const PLOT_H = 186
const model = (run: NormalizedRun, x0: number, x1: number, w: number, o: { log?: boolean; smooth?: number } = {}) =>
  buildModel({
    steps: run.steps,
    values: run.loss,
    smoothed: o.smooth ? ema(run.loss, o.smooth) : null,
    x0,
    x1,
    plotW: w,
    plotH: PLOT_H,
    log: !!o.log,
    gapThreshold: run.report.gapThreshold,
  })

/** Independent, deliberately dumb reference: plain objects, Map, Array.sort. */
function reference(raw: RawRun) {
  const byStep = new Map<number, { step: number; loss: number }>()
  for (let i = 0; i < raw.steps.length; i++) {
    if (Number.isFinite(raw.steps[i])) byStep.set(raw.steps[i], { step: raw.steps[i], loss: raw.loss[i] })
  }
  return [...byStep.values()].sort((a, b) => a.step - b.step)
}

describe('1. the spike is visible at every zoom level', () => {
  let big: NormalizedRun
  const spikeStep = 500_000
  beforeAll(() => {
    big = load('run-08')
  })

  it('the generated run really has 1,000,000 points and one spike', () => {
    expect(big.steps.length).toBe(1_000_000)
    expect(big.loss[spikeStep]).toBe(SPIKE_VALUE)
    let above = 0
    for (let i = 0; i < big.loss.length; i++) if (big.loss[i] > 10) above++
    expect(above).toBe(1)
  })

  it('reaches the exact spike value on screen for 5 widths x 7 zoom spans x 5 positions', () => {
    let checked = 0
    for (const w of [40, 320, 777, 1280, 2560]) {
      for (const span of [999_999, 300_000, 50_000, 5_000, 400, 37, 4]) {
        for (const where of [0.02, 0.25, 0.5, 0.75, 0.98]) {
          let x0 = spikeStep - span * where
          x0 = Math.max(0, Math.min(999_999 - span, x0))
          const m = model(big, x0, x0 + span, w)
          const col = Math.min(w - 1, Math.floor(((spikeStep - x0) / span) * w))
          // the bucket keeps the exact value, not an average
          expect(m.buckets.max[col]).toBe(SPIKE_VALUE)
          expect(m.buckets.yMax).toBe(SPIKE_VALUE)
          // the y axis includes it
          expect(m.yHi).toBeGreaterThan(SPIKE_VALUE)
          // and the path that is stroked actually goes to that pixel
          const yPx = m.y(SPIKE_VALUE)
          expect(yPx).toBeGreaterThanOrEqual(0)
          expect(yPx).toBeLessThan(PLOT_H)
          const highest = Math.min(...m.raw.ops.map(o => o.y))
          expect(highest).toBeCloseTo(yPx, 9)
          expect(m.raw.ops.some(o => o.x === col + 0.5 && Math.abs(o.y - yPx) < 1e-9)).toBe(true)
          checked++
        }
      }
    }
    expect(checked).toBe(175)
  })

  it('still reaches it with smoothing on and on a log axis', () => {
    for (const o of [{ smooth: 0.99 }, { log: true }, { log: true, smooth: 0.9 }]) {
      const m = model(big, 0, 999_999, 900, o)
      expect(m.buckets.yMax).toBe(SPIKE_VALUE)
      expect(Math.min(...m.raw.ops.map(p => p.y))).toBeCloseTo(m.y(SPIKE_VALUE), 9)
      if (m.smoothed) {
        // the smoothed line alone would have hidden it: this is why raw stays on screen
        const smoothTop = Math.min(...m.smoothed.ops.map(p => p.y))
        expect(smoothTop).toBeGreaterThan(m.y(SPIKE_VALUE) + 50)
      }
    }
  })

  it('control: the usual "take every Nth point" decimation loses the spike', () => {
    const stride = Math.ceil(big.steps.length / 900)
    let max = -Infinity
    for (let i = 0; i < big.loss.length; i += stride) max = Math.max(max, big.loss[i])
    expect(max).toBeLessThan(10)
  })

  it('control: averaging per pixel shrinks the spike to almost nothing', () => {
    const per = Math.ceil(big.steps.length / 900)
    const from = Math.floor(spikeStep / per) * per
    let sum = 0
    for (let i = from; i < from + per; i++) sum += big.loss[i]
    expect(sum / per).toBeLessThan(1)
  })
})

describe('2. NaN and Infinity are never drawn as a number and never bridged', () => {
  it('a NaN in the middle splits the line and takes no y position', () => {
    const steps = f64([0, 1, 2, 3, 4])
    const values = f64([1, 1, NaN, 1, 1])
    const m = buildModel({ steps, values, smoothed: null, x0: 0, x1: 4, plotW: 5, plotH: 100, log: false, gapThreshold: Infinity })
    expect(m.raw.badCols).toEqual([2])
    expect(m.buckets.count[2]).toBe(0)
    expect(m.raw.ops.filter(o => o.move).map(o => o.x)).toEqual([0.5, 3.5])
    expect(m.raw.ops.some(o => o.x === 2.5)).toBe(false)
    // y range comes from the real values only: 0 is not in it
    expect(m.buckets.yMin).toBe(1)
    expect(m.buckets.yMax).toBe(1)
    expect(m.yLo).toBeGreaterThan(0)
  })

  it('+Infinity and -Infinity are handled the same way and do not blow up the axis', () => {
    for (const badValue of [Infinity, -Infinity]) {
      const steps = f64([0, 1, 2, 3, 4])
      const values = f64([2, 3, badValue, 3, 2])
      const m = buildModel({ steps, values, smoothed: null, x0: 0, x1: 4, plotW: 5, plotH: 100, log: false, gapThreshold: Infinity })
      expect(m.raw.badCols).toEqual([2])
      expect(Number.isFinite(m.yLo) && Number.isFinite(m.yHi)).toBe(true)
      expect(m.raw.ops.every(o => Number.isFinite(o.y))).toBe(true)
      expect(m.raw.ops.filter(o => o.move).length).toBe(2)
    }
  })

  it('a lone finite point between NaNs is still drawn (as a dot)', () => {
    const steps = f64([0, 1, 2, 3, 4])
    const values = f64([NaN, NaN, 7, NaN, NaN])
    const m = buildModel({ steps, values, smoothed: null, x0: 0, x1: 4, plotW: 5, plotH: 100, log: false, gapThreshold: Infinity })
    expect(m.raw.dots).toEqual([{ x: 2.5, y: m.y(7) }])
  })

  it('NaN inside a crowded pixel column is still flagged when zoomed all the way out', () => {
    const run = load('run-06')
    const nanSteps: number[] = []
    for (let i = 0; i < run.loss.length; i++) if (Number.isNaN(run.loss[i])) nanSteps.push(run.steps[i])
    expect(nanSteps.length).toBeGreaterThan(5)
    for (const w of [30, 200, 1000]) {
      const m = model(run, run.steps[0], run.steps[run.steps.length - 1], w)
      const flagged = m.buckets.bad.reduce((a, b) => a + b, 0)
      expect(flagged).toBe(nanSteps.length)
      for (const s of nanSteps) {
        const col = Math.min(w - 1, Math.floor(((s - m.buckets.x0) / (m.buckets.x1 - m.buckets.x0)) * w))
        expect(m.raw.badCols).toContain(col)
      }
    }
  })

  it('smoothing does not paper over NaN: the smoothed series is NaN at exactly the same rows', () => {
    const run = load('run-06')
    const s = ema(run.loss, 0.95)
    for (let i = 0; i < run.loss.length; i++) {
      expect(Number.isFinite(s[i])).toBe(Number.isFinite(run.loss[i]))
    }
  })

  it('a run that ends in NaN reports NaN as its current loss, not the last good number', () => {
    const run = load('run-05')
    const sum = summarize(run)
    expect(sum.loss.last).toBeNaN()
    expect(sum.loss.trailingNonFinite).toBe(6000 - Math.floor(6000 * 0.62))
    expect(sum.loss.lastFiniteStep).toBe(Math.floor(6000 * 0.62) - 1)
    expect(formatValue(sum.loss.last)).toBe('NaN')
    // the right part of the chart has no line at all
    const m = model(run, 0, 5999, 600)
    const lastDrawn = Math.max(...m.raw.ops.map(o => o.x))
    expect(lastDrawn).toBeLessThan(600 * 0.63)
    expect(m.raw.badCols.length).toBeGreaterThan(600 * 0.36)
  })
})

describe('3. duplicates and unsorted steps do not distort the line', () => {
  it('shuffled rows give exactly the same picture as sorted rows', () => {
    const sorted = generate(spec('run-01'))
    const rnd = mulberry32(42)
    const order = Array.from(sorted.steps.keys())
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1))
      ;[order[i], order[j]] = [order[j], order[i]]
    }
    const shuffled: RawRun = {
      steps: f64(order.map(i => sorted.steps[i])),
      loss: f64(order.map(i => sorted.loss[i])),
      lr: f64(order.map(i => sorted.lr[i])),
      grad_norm: f64(order.map(i => sorted.grad_norm[i])),
    }
    const a = normalize(sorted)
    const b = normalize(shuffled)
    expect(b.report.outOfOrder).toBeGreaterThan(1000)
    expect(Array.from(b.steps)).toEqual(Array.from(a.steps))
    expect(Array.from(b.loss)).toEqual(Array.from(a.loss))
    const ma = model(a, 0, 4999, 500)
    const mb = model(b, 0, 4999, 500)
    expect(mb.raw.ops).toEqual(ma.raw.ops)
  })

  it('the line never goes backwards: steps are strictly increasing after normalize, for all 20 runs', () => {
    for (const s of SPECS) {
      const run = normalize(generate(s))
      for (let i = 1; i < run.steps.length; i++) {
        if (!(run.steps[i] > run.steps[i - 1])) throw new Error(`${s.id}: step ${run.steps[i]} after ${run.steps[i - 1]}`)
      }
    }
  })

  it('for a duplicated step the last written row wins, and the report says how many were replaced', () => {
    const raw = generate(spec('run-10'))
    const run = normalize(raw)
    expect(raw.steps.length).toBe(11_000)
    expect(run.steps.length).toBe(10_000)
    expect(run.report.duplicates).toBe(1000)
    expect(run.report.conflictingDuplicates).toBe(1000)
    expect(run.report.outOfOrder).toBe(1)
    const ref = reference(raw)
    expect(ref.length).toBe(run.steps.length)
    for (let i = 0; i < ref.length; i++) {
      expect(run.steps[i]).toBe(ref[i].step)
      expect(run.loss[i]).toBe(ref[i].loss)
    }
  })

  it('the block-shuffled run matches the dumb reference too', () => {
    const raw = generate(spec('run-11'))
    const run = normalize(raw)
    expect(run.report.outOfOrder).toBeGreaterThan(0)
    expect(run.report.duplicates).toBe(0)
    const ref = reference(raw)
    expect(Array.from(run.steps)).toEqual(ref.map(r => r.step))
    expect(Array.from(run.loss)).toEqual(ref.map(r => r.loss))
  })

  it('a gap breaks the line instead of drawing a straight segment across missing steps', () => {
    const run = load('run-12')
    expect(run.report.gaps.length).toBe(2)
    const m = model(run, 0, 8999, 900)
    const g = run.report.gaps[0]
    const colFrom = Math.floor((g.from / 8999) * 900)
    const colTo = Math.floor((g.to / 8999) * 900)
    expect(colTo - colFrom).toBeGreaterThan(50)
    for (const o of m.raw.ops) expect(o.x > colFrom + 1 && o.x < colTo).toBe(false)
    const firstAfter = m.raw.ops.find(o => o.x >= colTo)!
    expect(firstAfter.move).toBe(true)
  })
})

describe('4. numbers and axis labels match the data', () => {
  it('every bucket min/max equals a brute-force scan, and no row is lost (200 random windows)', () => {
    const run = load('run-09')
    const n = run.steps.length
    const rnd = mulberry32(7)
    for (let t = 0; t < 200; t++) {
      const w = 20 + Math.floor(rnd() * 1500)
      const a = Math.floor(rnd() * (n - 10))
      const b = Math.min(n - 1, a + 4 + Math.floor(rnd() * rnd() * (n - a)))
      const bk = downsample(run.steps, run.loss, a, b, w)
      let total = 0
      for (let c = 0; c < w; c++) total += bk.count[c] + bk.bad[c] + bk.clipped[c]
      expect(total).toBe(b - a + 1)

      const c = Math.floor(rnd() * w)
      const info = describeBucket(bk, c, run.steps, run.loss)
      let min = Infinity
      let max = -Infinity
      let rows = 0
      for (let i = a; i <= b; i++) {
        const col = Math.min(w - 1, Math.floor(((run.steps[i] - a) * w) / (b - a)))
        if (col !== c) continue
        rows++
        min = Math.min(min, run.loss[i])
        max = Math.max(max, run.loss[i])
      }
      if (rows === 0) {
        expect(info.kind).toBe('empty')
      } else if (info.kind === 'data') {
        expect(info.rows).toBe(rows)
        expect(info.min).toBe(min)
        expect(info.max).toBe(max)
        expect(bk.min[c]).toBe(min)
        expect(bk.max[c]).toBe(max)
      } else {
        throw new Error('bucket reported empty but has rows')
      }
    }
  })

  it('summary cards equal an independent calculation, for all 20 runs', () => {
    for (const s of SPECS) {
      const raw = generate(s)
      const sum = summarize(normalize(raw))
      const ref = reference(raw)
      const finite = ref.filter(r => Number.isFinite(r.loss))
      expect(sum.points).toBe(ref.length)
      expect(sum.loss.nan).toBe(ref.filter(r => Number.isNaN(r.loss)).length)
      expect(sum.loss.posInf).toBe(ref.filter(r => r.loss === Infinity).length)
      expect(sum.loss.negInf).toBe(ref.filter(r => r.loss === -Infinity).length)
      if (ref.length) {
        expect(Object.is(sum.loss.last, ref[ref.length - 1].loss)).toBe(true)
        expect(sum.lastStep).toBe(ref[ref.length - 1].step)
      }
      if (finite.length) {
        const min = finite.reduce((a, b) => (b.loss < a.loss ? b : a))
        const max = finite.reduce((a, b) => (b.loss > a.loss ? b : a))
        expect(sum.loss.min).toBe(min.loss)
        expect(sum.loss.minStep).toBe(min.step)
        expect(sum.loss.max).toBe(max.loss)
        expect(sum.loss.maxStep).toBe(max.step)
        expect(sum.loss.lastFinite).toBe(finite[finite.length - 1].loss)
      }
    }
  })

  it('tick labels read back as the tick value and sit at the right pixel', () => {
    const run = load('run-09')
    const rnd = mulberry32(11)
    for (let t = 0; t < 100; t++) {
      const a = Math.floor(rnd() * 190_000)
      const b = a + 5 + Math.floor(rnd() * rnd() * 9_000)
      for (const log of [false, true]) {
        const m = model(run, a, b, 640, { log })
        expect(m.yTicks.length).toBeGreaterThanOrEqual(2)
        const labels = new Set(m.yTicks.map(k => k.label))
        expect(labels.size).toBe(m.yTicks.length)
        for (const k of m.yTicks) {
          expect(k.v).toBeGreaterThanOrEqual(m.yLo)
          expect(k.v).toBeLessThanOrEqual(m.yHi)
          expect(Math.abs(Number(k.label) - k.v)).toBeLessThanOrEqual(Math.abs(k.v) * 1e-9)
          expect(k.pos).toBeCloseTo(m.y(k.v), 9)
          expect(k.pos).toBeGreaterThanOrEqual(-1e-6)
          expect(k.pos).toBeLessThanOrEqual(PLOT_H + 1e-6)
        }
        for (const k of m.xTicks) {
          expect(Number(k.label.replace(/,/g, ''))).toBe(k.v)
          expect(Number.isInteger(k.v)).toBe(true)
          expect(k.pos).toBeCloseTo(((k.v - a) / (b - a)) * 640, 9)
        }
      }
    }
  })

  it('tick labels keep enough digits when the range is tiny compared to the values', () => {
    const { ticks, step } = niceTicks(1000.0011, 1000.0019, 5)
    const labels = ticks.map(v => formatTick(v, step))
    expect(new Set(labels).size).toBe(ticks.length)
    labels.forEach((l, i) => expect(Number(l)).toBeCloseTo(ticks[i], 6))
  })

  it('formatValue never rounds a number into a different-looking one', () => {
    const rnd = mulberry32(3)
    for (let t = 0; t < 5000; t++) {
      const v = (rnd() - 0.3) * Math.pow(10, Math.floor(rnd() * 16) - 8)
      if (v === 0) continue
      const back = Number(formatValue(v).replace(/,/g, ''))
      expect(Math.abs(back - v) / Math.abs(v)).toBeLessThan(1e-3)
    }
    expect(formatValue(NaN)).toBe('NaN')
    expect(formatValue(Infinity)).toBe('+Inf')
    expect(formatValue(-Infinity)).toBe('-Inf')
    expect(formatValue(123456)).toBe('123,456')
    expect(formatStep(1_000_000)).toBe('1,000,000')
  })

  it('log axis: zeros are counted and marked, not dropped and not drawn at some made-up position', () => {
    const run = load('run-13')
    const zeros = Array.from(run.loss).filter(v => v === 0).length
    expect(zeros).toBeGreaterThan(30)
    const lin = model(run, 0, 4999, 500)
    const log = model(run, 0, 4999, 500, { log: true })
    expect(lin.buckets.yMin).toBe(0)
    expect(log.buckets.clipped.reduce((a, b) => a + b, 0)).toBe(zeros)
    expect(log.raw.clippedCols.length).toBeGreaterThan(0)
    expect(log.yLo).toBeGreaterThan(0)
    expect(log.raw.ops.every(o => Number.isFinite(o.y))).toBe(true)
    const total = log.buckets.count.reduce((a, b) => a + b, 0) + zeros
    expect(total).toBe(5000)
  })
})

describe('5. log axis is labelled over its whole height', () => {
  it('run-13 on a log axis has tick labels below 1, where the run actually is', () => {
    const run = load('run-13')
    const m = model(run, 0, 4999, 1300, { log: true })
    const below = m.yTicks.filter(t => t.v < 1)
    expect(below.length).toBeGreaterThanOrEqual(1)
    // no stretch of the axis taller than 60% of the plot is left without a label
    const pos = [0, ...m.yTicks.map(t => t.pos).sort((a, b) => a - b), PLOT_H]
    for (let i = 1; i < pos.length; i++) expect(pos[i] - pos[i - 1]).toBeLessThan(PLOT_H * 0.6)
    for (const t of m.yTicks) expect(Number(t.label)).toBe(t.v)
  })
})
