export type LatestResult<T> =
  | { stale: true }
  | { stale: false; ok: true; value: T }
  | { stale: false; ok: false; error: string }

/**
 * Only the most recent request may deliver a result. An older request that
 * resolves late (slow run A after fast run B) is reported as stale and its
 * network call is aborted.
 */
export function createLatest<T>() {
  let token = 0
  let controller: AbortController | null = null

  return {
    async run(fn: (signal: AbortSignal) => Promise<T>): Promise<LatestResult<T>> {
      const mine = ++token
      controller?.abort()
      const ctrl = new AbortController()
      controller = ctrl
      try {
        const value = await fn(ctrl.signal)
        if (mine !== token) return { stale: true }
        return { stale: false, ok: true, value }
      } catch (e) {
        if (mine !== token) return { stale: true }
        return { stale: false, ok: false, error: e instanceof Error ? e.message : String(e) }
      }
    },
    cancel() {
      token++
      controller?.abort()
      controller = null
    },
  }
}

export interface Freshness {
  fetchedAgoMs: number
  /** the copy on screen is old enough that a running run has moved on */
  stale: boolean
  /** the run says "running" but has not logged anything for a long time */
  silent: boolean
}

export const STALE_AFTER_MS = 60_000
export const SILENT_AFTER_MS = 30 * 60_000

export function freshness(now: number, fetchedAt: number, lastLoggedAt: number, status: string): Freshness {
  const running = status === 'running'
  return {
    fetchedAgoMs: now - fetchedAt,
    stale: running && now - fetchedAt > STALE_AFTER_MS,
    silent: running && now - lastLoggedAt > SILENT_AFTER_MS,
  }
}
