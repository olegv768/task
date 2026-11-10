import { formatStep, formatValue } from '../lib/format'
import type { Metric, RawRun } from '../lib/types'
import { CHART_H, MARGIN, PLOT_H } from './paint'

// The "before" in the performance comparison (open any run with ?naive=1).
// It is the straightforward first version on purpose: one object per point,
// one lineTo per point, everything redrawn on every mouse move. It also has
// the truthfulness bugs the real chart is tested against: canvas ignores
// lineTo(NaN), so the line silently bridges over missing values.

export interface NaivePoint {
  step: number
  loss: number
  lr: number
  grad_norm: number
}

export function toNaivePoints(run: RawRun): NaivePoint[] {
  const out: NaivePoint[] = []
  for (let i = 0; i < run.steps.length; i++) {
    out.push({ step: run.steps[i], loss: run.loss[i], lr: run.lr[i], grad_norm: run.grad_norm[i] })
  }
  return out
}

export function paintNaive(
  ctx: CanvasRenderingContext2D,
  points: NaivePoint[],
  metric: Metric,
  x0: number,
  x1: number,
  width: number,
  color: string,
  cursor: number | null,
): string {
  const plotW = width - MARGIN.l - MARGIN.r
  const span = x1 - x0 || 1
  const visible = points.filter(p => p.step >= x0 && p.step <= x1)
  const finite = visible.map(p => p[metric]).filter(Number.isFinite)
  let lo = Infinity
  let hi = -Infinity
  for (const v of finite) {
    if (v < lo) lo = v
    if (v > hi) hi = v
  }
  if (!(hi > lo)) {
    lo -= 1
    hi += 1
  }

  ctx.clearRect(0, 0, width, CHART_H)
  ctx.fillStyle = '#fff'
  ctx.fillRect(MARGIN.l, MARGIN.t, plotW, PLOT_H)
  ctx.strokeStyle = color
  ctx.lineWidth = 1.2
  ctx.beginPath()
  visible.forEach((p, i) => {
    const x = MARGIN.l + ((p.step - x0) / span) * plotW
    const y = MARGIN.t + PLOT_H - ((p[metric] - lo) / (hi - lo)) * PLOT_H
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  })
  ctx.stroke()
  ctx.strokeStyle = '#8b897f'
  ctx.strokeRect(MARGIN.l + 0.5, MARGIN.t + 0.5, plotW - 1, PLOT_H - 1)

  if (cursor === null) return 'naive renderer (comparison baseline)'
  const x = MARGIN.l + ((cursor - x0) / span) * plotW
  ctx.strokeStyle = '#1c1c1a'
  ctx.beginPath()
  ctx.moveTo(x, MARGIN.t)
  ctx.lineTo(x, MARGIN.t + PLOT_H)
  ctx.stroke()
  let best: NaivePoint | null = null
  for (const p of visible) {
    if (!best || Math.abs(p.step - cursor) < Math.abs(best.step - cursor)) best = p
  }
  return best ? `step ${formatStep(best.step)}: ${formatValue(best[metric])} (naive renderer)` : ''
}
