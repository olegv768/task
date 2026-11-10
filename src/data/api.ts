import { buildIssues } from '../lib/issues'
import { normalize, summarize } from '../lib/series'
import type { RawRun, RunListItem, RunMeta } from '../lib/types'
import { generate, SPECS, type Spec } from './generate'

// A stand-in for a backend. It behaves like one in the ways that matter for
// the UI: it is asynchronous, each run has a different latency (so a slow
// response can arrive after a fast one), requests can be aborted, and one run
// fails. `?latency=0` removes the artificial delay for measurements.

const params = new URLSearchParams(typeof location === 'undefined' ? '' : location.search)
const FIXED_LATENCY = params.has('latency') ? Number(params.get('latency')) : null
const LOADED_AT = Date.now()

const cache = new Map<string, RawRun>()
const CACHE_MAX_POINTS = 100_000

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException('Aborted', 'AbortError'))
    const t = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => {
      clearTimeout(t)
      reject(new DOMException('Aborted', 'AbortError'))
    })
  })
}

function metaOf(spec: Spec): RunMeta {
  const lastLoggedAt = LOADED_AT - spec.agoMin * 60_000
  return {
    id: spec.id,
    name: spec.name,
    status: spec.status,
    startedAt: lastLoggedAt - Math.max(1, spec.n / 200) * 60_000,
    lastLoggedAt,
    costUsd: spec.costUsd,
    note: spec.note,
  }
}

function rawOf(spec: Spec): RawRun {
  const hit = cache.get(spec.id)
  if (hit) return hit
  const raw = generate(spec)
  if (spec.n <= CACHE_MAX_POINTS) cache.set(spec.id, raw)
  return raw
}

export function latencyFor(id: string): number {
  if (FIXED_LATENCY !== null) return FIXED_LATENCY
  return 150 + ((Number(id.slice(4)) * 137) % 5) * 180
}

let listCache: RunListItem[] | null = null

export async function listRuns(signal: AbortSignal): Promise<RunListItem[]> {
  await delay(FIXED_LATENCY ?? 350, signal)
  if (params.get('fail') === 'list') throw new Error('HTTP 503: run index is unavailable')
  if (!listCache) {
    listCache = SPECS.map(spec => {
      const meta = metaOf(spec)
      if (spec.kind === 'fetch_error') return { meta, summary: null, issues: [] }
      const norm = normalize(rawOf(spec))
      const summary = summarize(norm)
      return { meta, summary, issues: buildIssues(summary, norm.report) }
    })
  }
  return listCache
}

export async function fetchRun(id: string, signal: AbortSignal): Promise<{ meta: RunMeta; raw: RawRun }> {
  await delay(latencyFor(id), signal)
  const spec = SPECS.find(s => s.id === id)
  if (!spec) throw new Error(`Run "${id}" does not exist`)
  if (spec.kind === 'fetch_error') throw new Error(`HTTP 500: metrics file for ${spec.name} is unreadable`)
  return { meta: metaOf(spec), raw: rawOf(spec) }
}
