/**
 * One bucket per pixel column. Nothing is averaged: for every column we keep
 * the min, the max, the first and the last finite value, and we count what
 * could not be drawn. A 1-point spike survives because it is the max of its
 * column, at any zoom.
 */
export interface Buckets {
  width: number
  x0: number
  x1: number
  /** index range of visible rows: [i0, i1) */
  i0: number
  i1: number
  min: Float64Array
  max: Float64Array
  first: Float64Array
  last: Float64Array
  /** drawable points in the column */
  count: Uint32Array
  /** NaN / +Inf / -Inf in the column */
  bad: Uint32Array
  /** finite but <= 0 on a log axis */
  clipped: Uint32Array
  /** the line must not connect this column to the previous one */
  breakBefore: Uint8Array
  /** first and one-past-last row index that fell into the column */
  start: Uint32Array
  end: Uint32Array
  yMin: number
  yMax: number
}

export function lowerBound(a: Float64Array, x: number): number {
  let lo = 0
  let hi = a.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (a[mid] < x) lo = mid + 1
    else hi = mid
  }
  return lo
}

export function upperBound(a: Float64Array, x: number): number {
  let lo = 0
  let hi = a.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (a[mid] <= x) lo = mid + 1
    else hi = mid
  }
  return lo
}

export function downsample(
  steps: Float64Array,
  values: Float64Array,
  x0: number,
  x1: number,
  width: number,
  log = false,
  gapThreshold = Infinity,
): Buckets {
  const w = Math.max(1, Math.floor(width))
  const min = new Float64Array(w).fill(Infinity)
  const max = new Float64Array(w).fill(-Infinity)
  const first = new Float64Array(w).fill(NaN)
  const last = new Float64Array(w).fill(NaN)
  const count = new Uint32Array(w)
  const bad = new Uint32Array(w)
  const clipped = new Uint32Array(w)
  const breakBefore = new Uint8Array(w)
  const start = new Uint32Array(w)
  const end = new Uint32Array(w)

  const span = x1 - x0 || 1
  const i0 = lowerBound(steps, x0)
  const i1 = upperBound(steps, x1)
  const k = w / span

  let pendingBreak = true
  let yMin = Infinity
  let yMax = -Infinity

  for (let i = i0; i < i1; i++) {
    const s = steps[i]
    const v = values[i]
    let b = Math.floor((s - x0) * k)
    if (b >= w) b = w - 1
    else if (b < 0) b = 0

    if (end[b] === 0) start[b] = i
    end[b] = i + 1

    if (i > 0 && s - steps[i - 1] > gapThreshold) pendingBreak = true

    // v - v is NaN for NaN and for both infinities
    if (v - v !== 0) {
      bad[b]++
      pendingBreak = true
      continue
    }
    if (log && v <= 0) {
      clipped[b]++
      pendingBreak = true
      continue
    }

    if (count[b] === 0) {
      first[b] = v
      if (pendingBreak) breakBefore[b] = 1
    }
    pendingBreak = false
    count[b]++
    last[b] = v
    if (v < min[b]) min[b] = v
    if (v > max[b]) max[b] = v
    if (v < yMin) yMin = v
    if (v > yMax) yMax = v
  }

  return { width: w, x0, x1, i0, i1, min, max, first, last, count, bad, clipped, breakBefore, start, end, yMin, yMax }
}

export type BucketInfo =
  | { kind: 'empty' }
  | {
      kind: 'data'
      rows: number
      stepFrom: number
      stepTo: number
      finite: number
      min: number
      max: number
      nan: number
      posInf: number
      negInf: number
      clipped: number
    }

/** Exact contents of one pixel column, recomputed from the rows themselves. */
export function describeBucket(b: Buckets, col: number, steps: Float64Array, values: Float64Array): BucketInfo {
  if (col < 0 || col >= b.width || b.end[col] === 0) return { kind: 'empty' }
  const from = b.start[col]
  const to = b.end[col]
  let nan = 0
  let posInf = 0
  let negInf = 0
  let finite = 0
  let min = Infinity
  let max = -Infinity
  for (let i = from; i < to; i++) {
    const v = values[i]
    if (v !== v) nan++
    else if (v === Infinity) posInf++
    else if (v === -Infinity) negInf++
    else {
      finite++
      if (v < min) min = v
      if (v > max) max = v
    }
  }
  return {
    kind: 'data',
    rows: to - from,
    stepFrom: steps[from],
    stepTo: steps[to - 1],
    finite,
    min: finite ? min : NaN,
    max: finite ? max : NaN,
    nan,
    posInf,
    negInf,
    clipped: b.clipped[col],
  }
}
