import type { Gap, Metric, MetricSummary, NormalizedRun, RawRun, Summary } from './types'

const same = (a: number, b: number) => Object.is(a, b)

/**
 * Sort by step, keep one row per step (the last one written wins), drop rows
 * whose step is not a finite number. Everything that was changed is counted in
 * the report so the UI can say so instead of fixing it quietly.
 */
export function normalize(raw: RawRun): NormalizedRun {
  const s = raw.steps
  const n = s.length

  // A shorter column would read as undefined and be stored as NaN, i.e. the
  // chart would show "the model produced NaN" for what is a broken file.
  if (raw.loss.length !== n || raw.lr.length !== n || raw.grad_norm.length !== n) {
    throw new Error(
      `Malformed run: ${n} steps but ${raw.loss.length} loss, ${raw.lr.length} lr and ${raw.grad_norm.length} grad_norm values`,
    )
  }

  let clean = true
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(s[i]) || (i > 0 && !(s[i] > s[i - 1]))) {
      clean = false
      break
    }
  }

  if (clean) {
    const gapInfo = findGaps(s)
    return {
      ...raw,
      report: {
        rawCount: n,
        count: n,
        droppedInvalidSteps: 0,
        outOfOrder: 0,
        duplicates: 0,
        conflictingDuplicates: 0,
        ...gapInfo,
      },
    }
  }

  const valid: number[] = []
  let outOfOrder = 0
  let prev = -Infinity
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(s[i])) continue
    if (s[i] < prev) outOfOrder++
    prev = s[i]
    valid.push(i)
  }
  const idx = Uint32Array.from(valid)
  // ties are broken by original position, so "last in the group" = last written
  idx.sort((a, b) => s[a] - s[b] || a - b)

  const keep: number[] = []
  let duplicates = 0
  let conflicting = 0
  // One pass over groups of equal steps. An earlier version looked for the end
  // of the group again for every row in it, which is quadratic: 80,000 rows
  // with the same step took 4 seconds.
  let k = 0
  while (k < idx.length) {
    let end = k
    while (end + 1 < idx.length && s[idx[end + 1]] === s[idx[k]]) end++
    const w = idx[end]
    keep.push(w)
    for (let j = k; j < end; j++) {
      const i = idx[j]
      duplicates++
      if (
        !same(raw.loss[i], raw.loss[w]) ||
        !same(raw.lr[i], raw.lr[w]) ||
        !same(raw.grad_norm[i], raw.grad_norm[w])
      ) {
        conflicting++
      }
    }
    k = end + 1
  }

  const m = keep.length
  const steps = new Float64Array(m)
  const loss = new Float64Array(m)
  const lr = new Float64Array(m)
  const grad_norm = new Float64Array(m)
  for (let k = 0; k < m; k++) {
    const i = keep[k]
    steps[k] = s[i]
    loss[k] = raw.loss[i]
    lr[k] = raw.lr[i]
    grad_norm[k] = raw.grad_norm[i]
  }

  return {
    steps,
    loss,
    lr,
    grad_norm,
    report: {
      rawCount: n,
      count: m,
      droppedInvalidSteps: n - valid.length,
      outOfOrder,
      duplicates,
      conflictingDuplicates: conflicting,
      ...findGaps(steps),
    },
  }
}

/** A gap is a jump in step more than twice the usual logging interval. */
function findGaps(steps: Float64Array): { typicalDelta: number; gapThreshold: number; gaps: Gap[] } {
  const n = steps.length
  if (n < 3) return { typicalDelta: NaN, gapThreshold: Infinity, gaps: [] }

  const sampleSize = Math.min(n - 1, 20001)
  const sample = new Float64Array(sampleSize)
  for (let k = 0; k < sampleSize; k++) {
    const i = 1 + Math.floor((k * (n - 1)) / sampleSize)
    sample[k] = steps[i] - steps[i - 1]
  }
  sample.sort()
  const typicalDelta = sample[sampleSize >> 1]
  const gapThreshold = 2 * typicalDelta

  const gaps: Gap[] = []
  for (let i = 1; i < n; i++) {
    const d = steps[i] - steps[i - 1]
    if (d > gapThreshold) {
      gaps.push({ from: steps[i - 1], to: steps[i], missing: Math.round(d / typicalDelta) - 1 })
    }
  }
  return { typicalDelta, gapThreshold, gaps }
}

function summarizeMetric(steps: Float64Array, v: Float64Array): MetricSummary {
  const n = v.length
  const out: MetricSummary = {
    last: n ? v[n - 1] : NaN,
    lastFinite: NaN,
    lastFiniteStep: NaN,
    min: NaN,
    minStep: NaN,
    max: NaN,
    maxStep: NaN,
    nan: 0,
    posInf: 0,
    negInf: 0,
    nonPositive: 0,
    firstNonFiniteStep: NaN,
    trailingNonFinite: 0,
  }
  let min = Infinity
  let max = -Infinity
  let lastFiniteIdx = -1
  for (let i = 0; i < n; i++) {
    const x = v[i]
    if (x !== x) out.nan++
    else if (x === Infinity) out.posInf++
    else if (x === -Infinity) out.negInf++
    else {
      lastFiniteIdx = i
      if (x <= 0) out.nonPositive++
      if (x < min) {
        min = x
        out.minStep = steps[i]
      }
      if (x > max) {
        max = x
        out.maxStep = steps[i]
      }
      continue
    }
    if (Number.isNaN(out.firstNonFiniteStep)) out.firstNonFiniteStep = steps[i]
  }
  if (lastFiniteIdx >= 0) {
    out.min = min
    out.max = max
    out.lastFinite = v[lastFiniteIdx]
    out.lastFiniteStep = steps[lastFiniteIdx]
  }
  out.trailingNonFinite = n - 1 - lastFiniteIdx
  return out
}

export function summarize(run: NormalizedRun): Summary {
  const n = run.steps.length
  return {
    points: n,
    firstStep: n ? run.steps[0] : NaN,
    lastStep: n ? run.steps[n - 1] : NaN,
    loss: summarizeMetric(run.steps, run.loss),
    lr: summarizeMetric(run.steps, run.lr),
    grad_norm: summarizeMetric(run.steps, run.grad_norm),
  }
}

/**
 * Exponential moving average with bias correction. A non-finite input gives a
 * NaN output at that index: the smoothed line breaks there too, it never
 * bridges over missing data.
 */
export function ema(values: Float64Array, alpha: number): Float64Array {
  const out = new Float64Array(values.length)
  let s = 0
  let w = 0
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (!Number.isFinite(v)) {
      out[i] = NaN
      continue
    }
    s = alpha * s + (1 - alpha) * v
    w = alpha * w + (1 - alpha)
    out[i] = s / w
  }
  return out
}

export const metricOf = (run: RawRun, m: Metric): Float64Array => run[m]
