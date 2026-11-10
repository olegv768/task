// Every formatter pins the locale and the time zone. The viewer's browser
// settings must not change what a number looks like: "1.234" is one point two
// in en-US and one thousand two hundred in de-DE.

const LOCALE = 'en-US'

export function formatValue(v: number): string {
  if (v !== v) return 'NaN'
  if (v === Infinity) return '+Inf'
  if (v === -Infinity) return '-Inf'
  if (v === 0) return '0'
  const a = Math.abs(v)
  if (a >= 1e6 || a < 1e-3) return v.toExponential(3)
  if (a >= 1000) return v.toLocaleString(LOCALE, { maximumFractionDigits: 1 })
  return Number(v.toPrecision(5)).toString()
}

export function formatStep(v: number): string {
  if (!Number.isFinite(v)) return '–'
  return Math.round(v).toLocaleString(LOCALE)
}

export function formatCount(v: number): string {
  return v.toLocaleString(LOCALE)
}

/** Label for an axis tick; `step` is the distance between ticks. */
export function formatTick(v: number, step: number): string {
  if (v === 0) return '0'
  const a = Math.abs(v)
  const stepExp = Math.floor(Math.log10(Math.abs(step)) + 1e-9)
  if (a >= 1e6 || a < 1e-4) {
    const sig = Math.min(15, Math.max(1, Math.floor(Math.log10(a) + 1e-9) - stepExp + 1))
    return v.toExponential(sig - 1)
  }
  return v.toFixed(Math.min(20, Math.max(0, -stepExp)))
}

const pad = (n: number) => String(n).padStart(2, '0')

/** Always UTC and always says so. */
export function formatUtc(ms: number): string {
  if (!Number.isFinite(ms)) return '–'
  const d = new Date(ms)
  return (
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())} UTC`
  )
}

export function formatAgo(ms: number): string {
  if (!Number.isFinite(ms)) return '–'
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s} s ago`
  if (s < 3600) return `${Math.floor(s / 60)} min ago`
  if (s < 86400) return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min ago`
  return `${Math.floor(s / 86400)} d ago`
}

export function formatUsd(v: number): string {
  return '$' + v.toLocaleString(LOCALE, { minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

/** Comparator that keeps NaN / missing values at the end in both directions. */
export function compareNumbers(a: number | null, b: number | null, dir: 1 | -1): number {
  const am = a === null || a !== a
  const bm = b === null || b !== b
  if (am && bm) return 0
  if (am) return 1
  if (bm) return -1
  if (a === b) return 0
  return (a! < b! ? -1 : 1) * dir
}
