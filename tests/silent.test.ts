import { describe, expect, it } from 'vitest'
import { generate, SPECS } from '../src/data/generate'
import { compareNumbers, formatAgo, formatStep, formatUtc, formatValue } from '../src/lib/format'
import { createLatest, freshness } from '../src/lib/latest'
import { buildModel } from '../src/lib/model'
import { ema, normalize } from '../src/lib/series'

const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))

describe('request race when switching runs quickly', () => {
  it('a slow response for run A cannot overwrite the fast response for run B', async () => {
    const latest = createLatest<string>()
    const shown: string[] = []
    let aborted = false
    const a = latest
      .run(async signal => {
        signal.addEventListener('abort', () => (aborted = true))
        await sleep(80)
        return 'A'
      })
      .then(r => {
        if (!r.stale && r.ok) shown.push(r.value)
        return r
      })
    const b = latest
      .run(async () => {
        await sleep(10)
        return 'B'
      })
      .then(r => {
        if (!r.stale && r.ok) shown.push(r.value)
        return r
      })
    const [ra, rb] = await Promise.all([a, b])
    expect(ra.stale).toBe(true)
    expect(rb).toEqual({ stale: false, ok: true, value: 'B' })
    expect(shown).toEqual(['B'])
    expect(aborted).toBe(true)
  })

  it('a late error from an old request is not shown either', async () => {
    const latest = createLatest<string>()
    const a = latest.run(async () => {
      await sleep(40)
      throw new Error('500 for run A')
    })
    const b = latest.run(async () => 'B')
    expect((await a).stale).toBe(true)
    expect(await b).toEqual({ stale: false, ok: true, value: 'B' })
  })

  it('30 rapid switches: only the last one is delivered', async () => {
    const latest = createLatest<number>()
    const delivered: number[] = []
    const all = Array.from({ length: 30 }, (_, i) =>
      latest
        .run(async () => {
          await sleep((i * 37) % 50)
          return i
        })
        .then(r => {
          if (!r.stale && r.ok) delivered.push(r.value)
        }),
    )
    await Promise.all(all)
    expect(delivered).toEqual([29])
  })

  it('after cancel (leaving the page) nothing is delivered', async () => {
    const latest = createLatest<string>()
    const p = latest.run(async () => {
      await sleep(10)
      return 'late'
    })
    latest.cancel()
    expect((await p).stale).toBe(true)
  })
})

describe('stale data', () => {
  const t0 = Date.UTC(2026, 10, 10, 12, 0, 0)
  it('a running run fetched more than a minute ago is flagged', () => {
    expect(freshness(t0 + 59_000, t0, t0, 'running').stale).toBe(false)
    expect(freshness(t0 + 61_000, t0, t0, 'running').stale).toBe(true)
  })
  it('a finished run does not go stale', () => {
    expect(freshness(t0 + 3_600_000, t0, t0, 'finished').stale).toBe(false)
  })
  it('"running" with no new step for 30+ minutes is flagged as silent', () => {
    expect(freshness(t0, t0, t0 - 29 * 60_000, 'running').silent).toBe(false)
    expect(freshness(t0, t0, t0 - 190 * 60_000, 'running').silent).toBe(true)
  })
})

describe('locale and time zone', () => {
  it('times are printed in UTC and say so', () => {
    expect(formatUtc(Date.UTC(2026, 10, 10, 23, 59, 5))).toBe('2026-11-10 23:59:05 UTC')
    // around midnight a local-time formatter would show a different date in most zones
    expect(formatUtc(Date.UTC(2026, 0, 1, 0, 0, 0))).toBe('2026-01-01 00:00:00 UTC')
  })
  it('numbers use one fixed notation, whatever the browser locale is', () => {
    expect(formatStep(1234567)).toBe('1,234,567')
    expect(formatValue(1234.5)).toBe('1,234.5')
    expect(formatValue(0.5)).toBe('0.5')
    // what a locale-dependent formatter would have produced for a German user
    expect((1234.5).toLocaleString('de-DE')).not.toBe(formatValue(1234.5))
  })
  it('relative time', () => {
    expect(formatAgo(5_000)).toBe('5 s ago')
    expect(formatAgo(190 * 60_000)).toBe('3 h 10 min ago')
  })
})

describe('smoothing that hides divergence', () => {
  it('on the oscillating run the smoothed line stays flat while raw swings widen; the axis follows raw', () => {
    const run = normalize(generate(SPECS.find(s => s.id === 'run-17')!))
    const n = run.steps.length
    const smoothed = ema(run.loss, 0.98)
    const range = (a: Float64Array, from: number, to: number) => {
      let lo = Infinity
      let hi = -Infinity
      for (let i = from; i < to; i++) {
        lo = Math.min(lo, a[i])
        hi = Math.max(hi, a[i])
      }
      return hi - lo
    }
    const tail = Math.floor(n * 0.9)
    const rawSwing = range(run.loss, tail, n)
    const smoothSwing = range(smoothed, tail, n)
    expect(rawSwing).toBeGreaterThan(smoothSwing * 10)

    const m = buildModel({
      steps: run.steps,
      values: run.loss,
      smoothed,
      x0: run.steps[tail],
      x1: run.steps[n - 1],
      plotW: 600,
      plotH: 186,
      log: false,
      gapThreshold: run.report.gapThreshold,
    })
    // y range is the raw range, and the raw envelope is still in the draw list
    expect(m.buckets.yMax - m.buckets.yMin).toBeCloseTo(rawSwing, 9)
    const ys = m.raw.ops.map(o => o.y)
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(186 * 0.8)
  })
})

describe('sorting the run list with NaN in the column', () => {
  it('NaN and missing values go last in both directions and the order is stable', () => {
    const v = [0.3, NaN, 0.1, null, 2, NaN, 0.2]
    const asc = [...v].sort((a, b) => compareNumbers(a, b, 1))
    const desc = [...v].sort((a, b) => compareNumbers(a, b, -1))
    expect(asc.slice(0, 4)).toEqual([0.1, 0.2, 0.3, 2])
    expect(desc.slice(0, 4)).toEqual([2, 0.3, 0.2, 0.1])
    expect(asc.slice(4).every(x => x === null || Number.isNaN(x))).toBe(true)
    expect(desc.slice(4).every(x => x === null || Number.isNaN(x))).toBe(true)
  })
  it('control: the naive comparator leaves the list in a wrong order', () => {
    const v = [3, NaN, 1, 2]
    const naive = [...v].sort((a, b) => a - b)
    expect(naive.slice(0, 3)).not.toEqual([1, 2, 3])
  })
})
