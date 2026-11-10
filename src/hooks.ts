import { useCallback, useEffect, useRef, useState } from 'react'
import { createLatest } from './lib/latest'

export type Async<T> =
  | { status: 'loading' }
  | { status: 'error'; error: string }
  | { status: 'ready'; data: T }

type Stored<T> = Async<T> & { key: string }

/**
 * Loads data for `key`. Two guards against showing the wrong thing:
 * - createLatest drops (and aborts) every request except the newest one;
 * - a result is only returned while it belongs to the current key, so for the
 *   one render between "key changed" and "effect ran" the old run's data is
 *   not shown under the new run's title.
 */
export function useAsync<T>(key: string, fn: (signal: AbortSignal) => Promise<T>): [Async<T>, () => void] {
  const [stored, setStored] = useState<Stored<T>>({ key, status: 'loading' })
  const [nonce, setNonce] = useState(0)
  const latest = useRef(createLatest<T>()).current
  const fnRef = useRef(fn)
  fnRef.current = fn

  useEffect(() => {
    setStored({ key, status: 'loading' })
    latest.run(signal => fnRef.current(signal)).then(r => {
      if (r.stale) return
      setStored(r.ok ? { key, status: 'ready', data: r.value } : { key, status: 'error', error: r.error })
    })
    return () => latest.cancel()
  }, [key, nonce, latest])

  const reload = useCallback(() => setNonce(n => n + 1), [])
  return [stored.key === key ? stored : { status: 'loading' }, reload]
}

export function useHashRoute(): string {
  const [hash, setHash] = useState(() => location.hash)
  useEffect(() => {
    const on = () => setHash(location.hash)
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return hash.replace(/^#/, '') || '/'
}

/** Re-renders every `ms` so "fetched N s ago" keeps counting. */
export function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(t)
  }, [ms])
  return now
}
