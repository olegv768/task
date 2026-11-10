export type Metric = 'loss' | 'lr' | 'grad_norm'
export const METRICS: Metric[] = ['loss', 'lr', 'grad_norm']

export type RunStatus = 'running' | 'finished' | 'failed' | 'stopped'

/** Rows exactly as they were logged: may be unsorted, duplicated, non-finite. */
export interface RawRun {
  steps: Float64Array
  loss: Float64Array
  lr: Float64Array
  grad_norm: Float64Array
}

export interface RunMeta {
  id: string
  name: string
  status: RunStatus
  startedAt: number
  lastLoggedAt: number
  costUsd: number
  note: string
}

export interface Gap {
  from: number
  to: number
  missing: number
}

export interface NormalizeReport {
  rawCount: number
  count: number
  droppedInvalidSteps: number
  outOfOrder: number
  duplicates: number
  conflictingDuplicates: number
  typicalDelta: number
  gapThreshold: number
  gaps: Gap[]
}

/** Sorted by step, one row per step. */
export interface NormalizedRun extends RawRun {
  report: NormalizeReport
}

export interface MetricSummary {
  last: number
  lastFinite: number
  lastFiniteStep: number
  min: number
  minStep: number
  max: number
  maxStep: number
  nan: number
  posInf: number
  negInf: number
  nonPositive: number
  firstNonFiniteStep: number
  /** how many of the most recent rows are non-finite */
  trailingNonFinite: number
}

export interface Summary {
  points: number
  firstStep: number
  lastStep: number
  loss: MetricSummary
  lr: MetricSummary
  grad_norm: MetricSummary
}

export interface Issue {
  level: 'bad' | 'warn'
  tag: string
  text: string
}

export interface RunListItem {
  meta: RunMeta
  /** null when the server could not read the metrics */
  summary: Summary | null
  issues: Issue[]
}
