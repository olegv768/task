import type { ChartModel, DrawList } from '../lib/model'
import type { Gap } from '../lib/types'

export const MARGIN = { l: 64, r: 12, t: 10, b: 24 }
export const CHART_H = 220
export const PLOT_H = CHART_H - MARGIN.t - MARGIN.b

const INK = '#1c1c1a'
const GRID = '#e3e1da'
const BAD = '#b3001b'
const CLIP = '#8a4b00'
const FONT = '11px ui-monospace, "Cascadia Mono", Consolas, Menlo, monospace'

function stroke(ctx: CanvasRenderingContext2D, d: DrawList, color: string, alpha: number, lineWidth: number) {
  ctx.globalAlpha = alpha
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = lineWidth
  ctx.lineJoin = 'round'
  ctx.beginPath()
  for (const o of d.ops) {
    if (o.move) ctx.moveTo(o.x, o.y)
    else ctx.lineTo(o.x, o.y)
  }
  ctx.stroke()
  for (const p of d.dots) {
    ctx.beginPath()
    ctx.arc(p.x, p.y, 2.5, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.globalAlpha = 1
}

export function paint(
  ctx: CanvasRenderingContext2D,
  m: ChartModel,
  width: number,
  color: string,
  gaps: Gap[],
) {
  const plotW = m.buckets.width
  const { x0, x1 } = m.buckets
  const span = x1 - x0 || 1

  ctx.clearRect(0, 0, width, CHART_H)
  ctx.fillStyle = '#fff'
  ctx.fillRect(MARGIN.l, MARGIN.t, plotW, PLOT_H)

  ctx.font = FONT
  ctx.fillStyle = INK
  ctx.strokeStyle = GRID
  ctx.lineWidth = 1

  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  for (const t of m.yTicks) {
    const y = Math.round(MARGIN.t + t.pos) + 0.5
    ctx.beginPath()
    ctx.moveTo(MARGIN.l, y)
    ctx.lineTo(MARGIN.l + plotW, y)
    ctx.stroke()
    ctx.fillText(t.label, MARGIN.l - 6, y)
  }
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  for (const t of m.xTicks) {
    const x = Math.round(MARGIN.l + t.pos) + 0.5
    ctx.beginPath()
    ctx.moveTo(x, MARGIN.t + PLOT_H)
    ctx.lineTo(x, MARGIN.t + PLOT_H + 4)
    ctx.stroke()
    // keep the first and last label inside the canvas
    const half = ctx.measureText(t.label).width / 2
    const tx = Math.min(width - half - 1, Math.max(half + 1, x))
    ctx.fillText(t.label, tx, MARGIN.t + PLOT_H + 7)
  }

  ctx.save()
  ctx.beginPath()
  ctx.rect(MARGIN.l, MARGIN.t, plotW, PLOT_H)
  ctx.clip()
  ctx.translate(MARGIN.l, MARGIN.t)

  // stretches where nothing was logged
  ctx.fillStyle = 'rgba(28,28,26,0.07)'
  for (const g of gaps) {
    if (g.to < x0 || g.from > x1) continue
    const a = ((Math.max(g.from, x0) - x0) / span) * plotW
    const b = ((Math.min(g.to, x1) - x0) / span) * plotW
    if (b - a >= 2) ctx.fillRect(a + 1, 0, b - a - 2, PLOT_H)
  }

  // non-finite values: a faint full-height stripe plus a solid cap at the top
  ctx.fillStyle = 'rgba(179,0,27,0.13)'
  for (const c of m.raw.badCols) ctx.fillRect(c, 0, 1, PLOT_H)
  ctx.fillStyle = BAD
  for (const c of m.raw.badCols) ctx.fillRect(c, 0, 1, 6)

  // values that cannot exist on a log axis: a cap at the bottom
  ctx.fillStyle = CLIP
  for (const c of m.raw.clippedCols) ctx.fillRect(c, PLOT_H - 6, 1, 6)

  if (m.smoothed) {
    // Raw keeps its full colour. It used to be faded to 38% here, which turned
    // a one-pixel spike into a hairline nobody would notice next to the bold
    // smoothed line. The smoothed line is the one that changes colour instead.
    stroke(ctx, m.raw, color, 1, 1)
    stroke(ctx, m.smoothed, INK, 1, 2)
  } else {
    stroke(ctx, m.raw, color, 1, 1.2)
  }
  ctx.restore()

  ctx.strokeStyle = '#8b897f'
  ctx.lineWidth = 1
  ctx.strokeRect(MARGIN.l + 0.5, MARGIN.t + 0.5, plotW - 1, PLOT_H - 1)
}
