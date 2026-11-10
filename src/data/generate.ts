import type { RawRun, RunStatus } from '../lib/types'

// All data is synthetic and deterministic: the same seed gives the same run on
// every machine, so tests and the deployed site look at identical numbers.

export type Kind =
  | 'healthy'
  | 'nan_tail'
  | 'nan_sporadic'
  | 'inf'
  | 'neg_inf'
  | 'dup'
  | 'unsorted'
  | 'gaps'
  | 'spike'
  | 'zeros'
  | 'slow_diverge'
  | 'empty'
  | 'fetch_error'

export interface Spec {
  id: string
  name: string
  kind: Kind
  n: number
  status: RunStatus
  costUsd: number
  /** minutes since the last logged step */
  agoMin: number
  logEvery?: number
  note: string
}

export const SPIKE_VALUE = 48
export const SPIKE_GRAD = 310

export const SPECS: Spec[] = [
  { id: 'run-01', name: 'baseline-lr3e-4', kind: 'healthy', n: 5000, status: 'finished', costUsd: 41, agoMin: 2900, note: 'Clean reference run.' },
  { id: 'run-02', name: 'baseline-lr1e-3', kind: 'healthy', n: 5000, status: 'finished', costUsd: 41, agoMin: 2700, note: 'Clean reference run.' },
  { id: 'run-03', name: 'wide-ffn-2x', kind: 'healthy', n: 12000, status: 'finished', costUsd: 118, agoMin: 1500, note: 'Clean, longer.' },
  { id: 'run-04', name: 'warmup-2k', kind: 'healthy', n: 8000, status: 'stopped', costUsd: 77, agoMin: 1300, note: 'Stopped by hand.' },
  { id: 'run-05', name: 'lr3e-3-no-clip', kind: 'nan_tail', n: 6000, status: 'running', costUsd: 500, agoMin: 2, note: 'Loss turns NaN at 62% and never comes back, while the job keeps running.' },
  { id: 'run-06', name: 'fp16-amp', kind: 'nan_sporadic', n: 8000, status: 'finished', costUsd: 64, agoMin: 900, note: 'A dozen isolated NaN losses.' },
  { id: 'run-07', name: 'fp16-no-scaler', kind: 'inf', n: 4000, status: 'failed', costUsd: 35, agoMin: 800, note: '+Infinity in loss and grad_norm.' },
  { id: 'run-08', name: 'long-context-1m', kind: 'spike', n: 1_000_000, status: 'running', costUsd: 486, agoMin: 1, note: '1,000,000 points, one outlier at step 500,000.' },
  { id: 'run-09', name: 'bs256-accum4', kind: 'spike', n: 200_000, status: 'finished', costUsd: 240, agoMin: 700, note: '200,000 points, one outlier in the middle.' },
  { id: 'run-10', name: 'resume-from-ckpt-4k', kind: 'dup', n: 10000, status: 'finished', costUsd: 96, agoMin: 600, note: 'Resumed from a checkpoint: steps 4,000–4,999 were logged twice with different values.' },
  { id: 'run-11', name: 'ddp-4-workers', kind: 'unsorted', n: 6000, status: 'finished', costUsd: 58, agoMin: 500, note: 'Workers flushed their logs in the wrong order.' },
  { id: 'run-12', name: 'preempted-spot', kind: 'gaps', n: 9000, status: 'stopped', costUsd: 52, agoMin: 400, note: 'Two stretches of steps were never logged.' },
  { id: 'run-13', name: 'label-smoothing-0', kind: 'zeros', n: 5000, status: 'finished', costUsd: 44, agoMin: 300, note: 'Loss is exactly 0 on some steps (log-scale trap).' },
  { id: 'run-14', name: 'corrupted-shard', kind: 'fetch_error', n: 0, status: 'failed', costUsd: 12, agoMin: 250, note: 'The metrics file cannot be read: the run page shows the error state.' },
  { id: 'run-15', name: 'queued-big-sweep', kind: 'empty', n: 0, status: 'running', costUsd: 0, agoMin: 0, note: 'Started, nothing logged yet: the empty state.' },
  { id: 'run-16', name: 'smoke-test', kind: 'healthy', n: 1, status: 'finished', costUsd: 1, agoMin: 200, note: 'A single point.' },
  { id: 'run-17', name: 'lr-oscillation', kind: 'slow_diverge', n: 7000, status: 'running', costUsd: 320, agoMin: 3, note: 'Loss oscillates wider and wider; a smoothed line stays flat.' },
  { id: 'run-18', name: 'log-of-zero-loss', kind: 'neg_inf', n: 4000, status: 'failed', costUsd: 30, agoMin: 150, note: '-Infinity in loss.' },
  { id: 'run-19', name: 'eval-every-50', kind: 'healthy', n: 400, logEvery: 50, status: 'finished', costUsd: 150, agoMin: 100, note: 'Logged every 50 steps.' },
  { id: 'run-20', name: 'stuck-dataloader', kind: 'healthy', n: 3000, status: 'running', costUsd: 210, agoMin: 190, note: 'Says "running" but has logged nothing for over three hours.' },
]

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function alloc(n: number): RawRun {
  return {
    steps: new Float64Array(n),
    loss: new Float64Array(n),
    lr: new Float64Array(n),
    grad_norm: new Float64Array(n),
  }
}

function base(n: number, seed: number, logEvery = 1): RawRun {
  const rnd = mulberry32(seed)
  const run = alloc(n)
  const amp = 2 + rnd() * 2
  const floor = 0.15 + rnd() * 0.2
  const tau = Math.max(1, n * (0.08 + rnd() * 0.1))
  const peakLr = [1e-4, 3e-4, 1e-3][seed % 3]
  const warm = Math.max(1, Math.floor(n * 0.03))
  for (let i = 0; i < n; i++) {
    const decay = Math.exp(-i / tau)
    run.steps[i] = i * logEvery
    run.loss[i] = floor + amp * decay + (rnd() - 0.5) * 0.08 * (0.3 + decay)
    run.lr[i] =
      i < warm ? (peakLr * (i + 1)) / warm : peakLr * 0.5 * (1 + Math.cos((Math.PI * (i - warm)) / Math.max(1, n - warm)))
    run.grad_norm[i] = 0.4 + 2.5 * Math.exp(-i / (tau * 0.6)) + rnd() * 0.3
  }
  return run
}

function pick(run: RawRun, idx: number[]): RawRun {
  const out = alloc(idx.length)
  idx.forEach((i, k) => {
    out.steps[k] = run.steps[i]
    out.loss[k] = run.loss[i]
    out.lr[k] = run.lr[i]
    out.grad_norm[k] = run.grad_norm[i]
  })
  return out
}

export function generate(spec: Spec): RawRun {
  const seed = Number(spec.id.slice(4)) * 7919
  const n = spec.n
  const run = base(n, seed, spec.logEvery ?? 1)
  const rnd = mulberry32(seed + 1)
  const randIdx = (count: number, from = 0.1, to = 0.95) =>
    Array.from({ length: count }, () => Math.floor(n * (from + rnd() * (to - from))))

  switch (spec.kind) {
    case 'healthy':
    case 'empty':
    case 'fetch_error':
      return run

    case 'nan_tail': {
      const k = Math.floor(n * 0.62)
      for (let i = k - 60; i < k; i++) {
        const g = Math.exp((i - (k - 60)) / 9)
        run.grad_norm[i] *= g
        run.loss[i] *= 1 + g / 40
      }
      for (let i = k; i < n; i++) {
        run.loss[i] = NaN
        run.grad_norm[i] = NaN
      }
      return run
    }

    case 'nan_sporadic':
      for (const i of randIdx(12)) run.loss[i] = NaN
      return run

    case 'inf':
      for (const i of randIdx(5)) {
        run.loss[i] = Infinity
        run.grad_norm[i] = Infinity
      }
      return run

    case 'neg_inf':
      for (const i of randIdx(3)) run.loss[i] = -Infinity
      return run

    case 'zeros':
      for (const i of randIdx(40)) run.loss[i] = 0
      return run

    case 'spike': {
      const mid = n >> 1
      run.loss[mid] = SPIKE_VALUE
      run.grad_norm[mid] = SPIKE_GRAD
      return run
    }

    case 'slow_diverge': {
      const from = Math.floor(n * 0.45)
      for (let i = from; i < n; i++) {
        const g = 0.9 * ((i - from) / (n - from))
        run.loss[i] *= 1 + (i % 2 ? g : -g)
      }
      return run
    }

    case 'gaps': {
      const idx: number[] = []
      for (let i = 0; i < n; i++) {
        const t = i / n
        if ((t >= 0.3 && t < 0.42) || (t >= 0.7 && t < 0.73)) continue
        idx.push(i)
      }
      return pick(run, idx)
    }

    case 'dup': {
      // rows 0 .. 50% as first logged, then the job restarts from the 40%
      // checkpoint and logs 40% .. 100% again with a different trajectory
      const a = Math.floor(n * 0.4)
      const b = Math.floor(n * 0.5)
      const idx: number[] = []
      for (let i = 0; i < b; i++) idx.push(i)
      for (let i = a; i < n; i++) idx.push(i)
      const out = pick(run, idx)
      for (let k = a; k < b; k++) {
        // the first, later-overwritten attempt was worse
        out.loss[k] = run.loss[k] * (1.25 + rnd() * 0.2)
        out.grad_norm[k] = run.grad_norm[k] * 1.4
      }
      return out
    }

    case 'unsorted': {
      const chunk = 250
      const starts: number[] = []
      for (let s = 0; s < n; s += chunk) starts.push(s)
      for (let k = 0; k + 1 < starts.length; k += 3) {
        const t = starts[k]
        starts[k] = starts[k + 1]
        starts[k + 1] = t
      }
      const idx: number[] = []
      for (const s of starts) for (let i = s; i < Math.min(n, s + chunk); i++) idx.push(i)
      return pick(run, idx)
    }
  }
}
